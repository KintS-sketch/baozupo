import { NextResponse } from "next/server";
import type {
  AiPaymentRecognitionResult,
  AiRecognizePaymentResponse,
} from "@/types/ai";
import { getVisionProvider, VisionProviderError, VisionMediaType } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES: VisionMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const SYSTEM_PROMPT = `你是一个识别中国大陆收付款截图的助手。用户会上传微信支付、支付宝、银行转账等收付款凭证截图。请提取以下字段，并以严格的 JSON 格式返回，不要包含任何解释文字、不要使用 markdown 代码块包裹：

{
  "amount": <number, 收款金额，单位为元，必填>,
  "paid_at": <string, ISO 8601 格式（YYYY-MM-DDTHH:mm:ss），如截图未显示秒数则补 :00>,
  "from_name": <string | null, 付款方姓名（脱敏的也保留，如"张*"）>,
  "to_name": <string | null, 收款方姓名>,
  "method": <"wechat" | "alipay" | "bank" | "cash" | "other">,
  "confidence": <number, 0-1，整体识别置信度>
}

要求：
- 如果截图不是收付款凭证，返回 {"error": "not_a_payment_screenshot"}
- 如果截图模糊无法识别金额，amount 设为 0，confidence 设低（<0.3）
- method 推断：微信/微信支付 → wechat；支付宝 → alipay；银行/转账/借记卡 → bank；其他 → other
- 只输出 JSON，不要任何额外文字`;

const USER_PROMPT = "请识别这张收付款截图。";

interface RequestBody {
  bill_id?: string;
  image_base64?: string;
  media_type?: string;
}

export async function POST(request: Request): Promise<NextResponse<AiRecognizePaymentResponse>> {
  let provider;
  try {
    provider = getVisionProvider();
  } catch (err) {
    const e = err as VisionProviderError;
    return NextResponse.json({ success: false, error: e.friendly }, { status: e.httpStatus });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const { image_base64, media_type } = body;

  if (!image_base64) {
    return NextResponse.json({ success: false, error: "缺少 image_base64 字段" }, { status: 400 });
  }
  if (!media_type || !ALLOWED_MEDIA_TYPES.includes(media_type as VisionMediaType)) {
    return NextResponse.json(
      { success: false, error: `media_type 必须是 ${ALLOWED_MEDIA_TYPES.join(" / ")}` },
      { status: 400 }
    );
  }

  const approxBytes = (image_base64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: "图片过大，请上传 5MB 以内的截图" },
      { status: 413 }
    );
  }

  let recognition;
  try {
    recognition = await provider.recognize({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      imageBase64: image_base64,
      mediaType: media_type as VisionMediaType,
      maxTokens: 512,
    });
  } catch (err) {
    const e = err as VisionProviderError;
    console.error("[ai/recognize-payment] provider error:", e.message);
    return NextResponse.json(
      { success: false, error: e.friendly },
      { status: e.httpStatus }
    );
  }

  const cleaned = recognition.rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { success: false, error: "AI 返回内容无法解析，请重试或手动填写" },
      { status: 502 }
    );
  }

  if (parsed.error === "not_a_payment_screenshot") {
    return NextResponse.json(
      { success: false, error: "未识别到收付款信息，请上传支付/转账截图" },
      { status: 422 }
    );
  }

  const result: AiPaymentRecognitionResult = {
    amount: typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount) || 0,
    paid_at: typeof parsed.paid_at === "string" ? parsed.paid_at : new Date().toISOString(),
    from_name: typeof parsed.from_name === "string" ? parsed.from_name : null,
    to_name: typeof parsed.to_name === "string" ? parsed.to_name : null,
    method: normalizeMethod(parsed.method),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };

  return NextResponse.json({
    success: true,
    data: result,
    model: recognition.model,
    tokens_used: recognition.tokensUsed,
  });
}

function normalizeMethod(value: unknown): AiPaymentRecognitionResult["method"] {
  const allowed = ["wechat", "alipay", "bank", "cash", "other"] as const;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as AiPaymentRecognitionResult["method"];
  }
  return "other";
}
