import { NextResponse } from "next/server";
import type {
  AiIdCardRecognitionResult,
  AiRecognizeIdCardResponse,
} from "@/types/ai";
import { getVisionProvider, VisionProviderError, VisionMediaType } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES: VisionMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const SYSTEM_PROMPT = `你是一个识别中国大陆居民身份证照片的助手。用户会上传身份证照片，请提取以下字段，以严格的 JSON 格式返回，不要包含任何解释文字、不要使用 markdown 代码块包裹：

{
  "name": <string | null, 姓名>,
  "id_number": <string | null, 身份证号（18 位，最后一位可能是大写 X）>,
  "gender": <"male" | "female" | null>,
  "birthday": <string | null, 出生日期 YYYY-MM-DD 格式>,
  "address": <string | null, 户籍地址（完整地址）>,
  "confidence": <number, 0-1，整体识别置信度>
}

识别规则：
- 身份证**正面**（带人像那一面）：能拿到姓名、性别、民族、出生日期、住址、身份证号
- 身份证**背面**（带国徽那一面）：只有签发机关 + 有效期，**无法**提取上述字段
- 18 位身份证号最后一位可能是大写 "X"
- 身份证号第 7-14 位应该是出生日期 YYYYMMDD，第 17 位奇数=男，偶数=女
- 如果识别出的姓名/出生日期与身份证号校验不一致，**以身份证号推算为准**
- 出生日期严格用 YYYY-MM-DD 格式（如 1990-03-15）
- 性别用英文 "male" 或 "female"

⭐ 关键原则：
- 模糊但能猜出来：照常填，confidence 设 0.4-0.6 提示需复核
- 部分字符模糊（如 1 位地址模糊）：其他确定的照填，confidence 0.5-0.7
- 完全看不清（黑屏、严重失焦、完全反光）：所有字段设 null，confidence<0.2

异常情况返回（不要返回上面的 JSON 结构，返回 error）：
- 不是身份证照片（如人脸、风景、文字）：返回 {"error": "not_an_id_card"}
- 背面（带国徽，无人像）：返回 {"error": "back_side_not_supported"}

只输出 JSON，不要任何额外文字。`;

interface RequestBody {
  image_base64?: string;
  media_type?: string;
}

export async function POST(
  request: Request
): Promise<NextResponse<AiRecognizeIdCardResponse>> {
  let provider;
  try {
    provider = getVisionProvider();
  } catch (err) {
    const e = err as VisionProviderError;
    return NextResponse.json(
      { success: false, error: e.friendly },
      { status: e.httpStatus }
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体不是有效 JSON" },
      { status: 400 }
    );
  }

  const { image_base64, media_type } = body;

  if (!image_base64) {
    return NextResponse.json(
      { success: false, error: "缺少 image_base64 字段" },
      { status: 400 }
    );
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

  let recognition;
  try {
    recognition = await provider.recognize({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: "请识别这张身份证照片，并按 JSON 格式返回提取的字段。",
      imageBase64: image_base64,
      mediaType: media_type as VisionMediaType,
      maxTokens: 400,
    });
  } catch (err) {
    const e = err as VisionProviderError;
    console.error("[ai/recognize-id-card] provider error:", e.message);
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

  if (parsed.error === "not_an_id_card") {
    return NextResponse.json(
      { success: false, error: "未识别到身份证，请上传身份证正面清晰照片" },
      { status: 422 }
    );
  }
  if (parsed.error === "back_side_not_supported") {
    return NextResponse.json(
      { success: false, error: "请拍身份证正面（带人像那一面），背面无法提取信息" },
      { status: 422 }
    );
  }

  // 后端再做一次身份证号 → 出生日期/性别 校验兜底（AI 偶尔识别错位）
  const idNumber = typeof parsed.id_number === "string" ? parsed.id_number.trim().toUpperCase() : null;
  let birthday = typeof parsed.birthday === "string" ? parsed.birthday : null;
  let gender: "male" | "female" | null = null;
  if (parsed.gender === "male" || parsed.gender === "female") {
    gender = parsed.gender;
  }

  if (idNumber && /^\d{17}[\dX]$/.test(idNumber)) {
    // 用身份证号推算出生日期 + 性别（覆盖 AI 输出）
    const y = idNumber.slice(6, 10);
    const m = idNumber.slice(10, 12);
    const d = idNumber.slice(12, 14);
    const derivedBirthday = `${y}-${m}-${d}`;
    if (!birthday || birthday !== derivedBirthday) birthday = derivedBirthday;
    const lastDigit = idNumber[16];
    const derivedGender: "male" | "female" = parseInt(lastDigit, 10) % 2 === 1 ? "male" : "female";
    gender = derivedGender;
  }

  const result: AiIdCardRecognitionResult = {
    name: typeof parsed.name === "string" ? parsed.name : null,
    id_number: idNumber,
    gender,
    birthday,
    address: typeof parsed.address === "string" ? parsed.address : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };

  return NextResponse.json({
    success: true,
    data: result,
    model: recognition.model,
    tokens_used: recognition.tokensUsed,
  });
}
