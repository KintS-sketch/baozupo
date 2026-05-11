import {
  VisionProvider,
  VisionProviderError,
  VisionRecognitionRequest,
  VisionRecognitionResponse,
} from "./types";

const DEFAULT_MODEL = "qwen-vl-max";
const ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export class DashScopeProvider implements VisionProvider {
  readonly name = "dashscope";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL
  ) {}

  async recognize(req: VisionRecognitionRequest): Promise<VisionRecognitionResponse> {
    let resp: Response;
    try {
      resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: {
            messages: [
              {
                role: "system",
                content: [{ text: req.systemPrompt }],
              },
              {
                role: "user",
                content: [
                  { image: `data:${req.mediaType};base64,${req.imageBase64}` },
                  { text: req.userPrompt },
                ],
              },
            ],
          },
          parameters: {
            max_tokens: req.maxTokens ?? 512,
            result_format: "message",
          },
        }),
      });
    } catch (err) {
      throw new VisionProviderError(
        `DashScope fetch failed: ${(err as Error).message}`,
        502,
        "调用通义千问失败，请稍后重试"
      );
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      const lower = errText.toLowerCase();
      let friendly = `通义千问返回错误：${resp.status}`;
      if (resp.status === 401) {
        friendly = "DASHSCOPE_API_KEY 无效，请检查 .env.local 配置";
      } else if (resp.status === 403) {
        friendly = "通义千问拒绝请求：账户欠费、模型未开通或被风控，请检查阿里云百炼控制台";
      } else if (resp.status === 429) {
        friendly = "通义千问调用过于频繁，请稍后再试";
      } else if (lower.includes("insufficient") || lower.includes("balance")) {
        friendly = "阿里云账户余额不足，请前往百炼控制台充值";
      } else if (lower.includes("model not found") || lower.includes("model is not enabled")) {
        friendly = "模型 qwen-vl-max 未在百炼控制台开通，请前往模型广场开通";
      }
      throw new VisionProviderError(`DashScope ${resp.status}: ${errText}`, 502, friendly);
    }

    const json = (await resp.json()) as {
      output?: {
        choices?: Array<{
          message?: {
            content?: Array<{ text?: string }>;
          };
        }>;
      };
      usage?: { input_tokens?: number; output_tokens?: number; image_tokens?: number };
      code?: string;
      message?: string;
    };

    if (json.code) {
      throw new VisionProviderError(
        `DashScope error code: ${json.code} - ${json.message ?? ""}`,
        502,
        `通义千问错误：${json.message ?? json.code}`
      );
    }

    const message = json.output?.choices?.[0]?.message;
    const text =
      message?.content
        ?.map((c) => c.text ?? "")
        .filter(Boolean)
        .join("")
        .trim() ?? "";

    const tokensUsed = json.usage
      ? (json.usage.input_tokens ?? 0) +
        (json.usage.output_tokens ?? 0) +
        (json.usage.image_tokens ?? 0)
      : undefined;

    return {
      rawText: text,
      model: this.model,
      tokensUsed,
      providerName: this.name,
    };
  }
}
