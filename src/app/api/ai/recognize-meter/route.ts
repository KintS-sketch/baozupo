import { NextResponse } from "next/server";
import type {
  AiMeterRecognitionResult,
  AiRecognizeMeterResponse,
} from "@/types/ai";
import { getVisionProvider, VisionProviderError, VisionMediaType } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES: VisionMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_TYPES = ["water", "electricity", "gas"] as const;

const SYSTEM_PROMPT = `你是一个识别中国大陆民用水表、电表、燃气表照片的助手。用户会上传表盘照片，请提取以下字段，以严格的 JSON 格式返回，不要包含任何解释文字、不要使用 markdown 代码块包裹：

{
  "type": <"water" | "electricity" | "gas" | "unknown">,
  "value": <number, 当前累计读数（不含小数点后的红色字位）>,
  "unit": <string | null, 推断的单位，如 "kWh"、"吨"、"m³">,
  "display_value": <string | null, 表盘上显示的原始字符串，含小数点>,
  "confidence": <number, 0-1，整体识别置信度>
}

判断要点：
- 水表通常字轮黑色背景白字，单位 m³ 或"吨"，刻度盘较多（机械表）
- 电表通常数显屏，显示 kWh 或度，单位通常印在表盘上
- 燃气表通常字轮，单位 m³，外壳金属
- 表盘最右侧 1-2 位通常是红色 / 黑色的小数位，**不要计入整数读数**，只填到 value（小数点前）
- 如完全无法判断表类型，type 设 "unknown"，confidence < 0.4
- 如照片模糊看不清数字，value 设 0，confidence 设 < 0.3
- 如照片不是表盘（如其他物品），返回 {"error": "not_a_meter_photo"}
- 只输出 JSON，不要任何额外文字`;

interface RequestBody {
  image_base64?: string;
  media_type?: string;
  hint_type?: string;
}

export async function POST(request: Request): Promise<NextResponse<AiRecognizeMeterResponse>> {
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

  const { image_base64, media_type, hint_type } = body;

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
      { success: false, error: "图片过大，请上传 5MB 以内的照片" },
      { status: 413 }
    );
  }

  const userPrompt = hint_type && (ALLOWED_TYPES as readonly string[]).includes(hint_type)
    ? `请识别这张表盘照片，用户提示这是${labelOf(hint_type)}表。`
    : "请识别这张表盘照片。";

  let recognition;
  try {
    recognition = await provider.recognize({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      imageBase64: image_base64,
      mediaType: media_type as VisionMediaType,
      maxTokens: 256,
    });
  } catch (err) {
    const e = err as VisionProviderError;
    console.error("[ai/recognize-meter] provider error:", e.message);
    return NextResponse.json({ success: false, error: e.friendly }, { status: e.httpStatus });
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

  if (parsed.error === "not_a_meter_photo") {
    return NextResponse.json(
      { success: false, error: "未识别到表盘，请上传水表/电表/燃气表的清晰照片" },
      { status: 422 }
    );
  }

  const result: AiMeterRecognitionResult = {
    type: normalizeType(parsed.type),
    value: typeof parsed.value === "number" ? parsed.value : Number(parsed.value) || 0,
    unit: typeof parsed.unit === "string" ? parsed.unit : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    display_value: typeof parsed.display_value === "string" ? parsed.display_value : null,
  };

  return NextResponse.json({
    success: true,
    data: result,
    model: recognition.model,
    tokens_used: recognition.tokensUsed,
  });
}

function normalizeType(value: unknown): AiMeterRecognitionResult["type"] {
  if (typeof value === "string" && (["water", "electricity", "gas"] as const).includes(value as never)) {
    return value as AiMeterRecognitionResult["type"];
  }
  return "unknown";
}

function labelOf(t: string): string {
  if (t === "water") return "水";
  if (t === "electricity") return "电";
  if (t === "gas") return "燃气";
  return "";
}
