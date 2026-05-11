import {
  VisionProvider,
  VisionProviderError,
  VisionRecognitionRequest,
  VisionRecognitionResponse,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AnthropicProvider implements VisionProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL
  ) {}

  async recognize(req: VisionRecognitionRequest): Promise<VisionRecognitionResponse> {
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 512,
          system: req.systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: req.mediaType, data: req.imageBase64 },
                },
                { type: "text", text: req.userPrompt },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      throw new VisionProviderError(
        `Anthropic fetch failed: ${(err as Error).message}`,
        502,
        "调用 AI 服务失败，请稍后重试"
      );
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      const lower = errText.toLowerCase();
      let friendly = `AI 服务返回错误：${resp.status}`;
      if (lower.includes("credit balance is too low") || lower.includes("billing")) {
        friendly = "Anthropic 账户余额不足，请前往 console.anthropic.com 充值后再试";
      } else if (resp.status === 401) {
        friendly = "ANTHROPIC_API_KEY 无效，请检查后台配置";
      } else if (resp.status === 403) {
        friendly = "AI 服务拒绝请求，可能是账户计划不支持或余额不足";
      } else if (resp.status === 429) {
        friendly = "AI 调用过于频繁，请稍后再试";
      }
      throw new VisionProviderError(`Anthropic ${resp.status}: ${errText}`, 502, friendly);
    }

    const json = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
    const tokensUsed = json.usage ? json.usage.input_tokens + json.usage.output_tokens : undefined;

    return {
      rawText: text,
      model: this.model,
      tokensUsed,
      providerName: this.name,
    };
  }
}
