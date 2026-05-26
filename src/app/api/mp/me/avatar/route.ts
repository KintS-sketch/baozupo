/**
 * POST /api/mp/me/avatar
 *
 * 上传当前用户的头像。
 *
 * 调用方：mp 端 chooseAvatar 拿到临时路径后，前端读成 base64 POST 过来。
 *
 * Body: { data_url: string }  // "data:image/png;base64,xxx..."
 *                              // 或者纯 base64（不带 data:image 前缀）+ mime 字段
 *       或 { base64: string, mime: "image/png" | "image/jpeg" | "image/webp" }
 *
 * Auth: Authorization: Bearer <supabase access_token>
 * Returns: { success: true, avatar_url: string }
 *
 * 流程：
 *   1. 解 base64 → Buffer
 *   2. 上传到 supabase storage avatars/{user_id}/{timestamp}.{ext}
 *   3. 获取 public URL 写入 user_profiles.avatar_url
 *   4. 返回新 URL 给前端
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/** 解析 data URL 或 { base64, mime }，返回 { buffer, mime } */
function parsePayload(body: {
  data_url?: string;
  base64?: string;
  mime?: string;
}): { buffer: Buffer; mime: string } | { error: string } {
  if (body.data_url) {
    const m = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(body.data_url);
    if (!m) return { error: "data_url 格式不正确" };
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    try {
      return { buffer: Buffer.from(b64, "base64"), mime };
    } catch {
      return { error: "base64 解码失败" };
    }
  }
  if (body.base64 && body.mime) {
    try {
      return { buffer: Buffer.from(body.base64, "base64"), mime: body.mime.toLowerCase() };
    } catch {
      return { error: "base64 解码失败" };
    }
  }
  return { error: "缺少 data_url 或 base64+mime 字段" };
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { data_url?: string; base64?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const parsed = parsePayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!ALLOWED_MIMES.has(parsed.mime)) {
    return NextResponse.json(
      { error: `不支持的图片格式：${parsed.mime}` },
      { status: 400 }
    );
  }

  if (parsed.buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `头像太大（${(parsed.buffer.length / 1024).toFixed(0)} KB），最大 2 MB` },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ext = mimeToExt(parsed.mime);
  const objectName = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await admin.storage
    .from("avatars")
    .upload(objectName, parsed.buffer, {
      contentType: parsed.mime,
      upsert: false,
    });

  if (uploadErr) {
    console.error("[api/mp/me/avatar] upload fail", uploadErr);
    return NextResponse.json(
      { error: "上传失败：" + uploadErr.message },
      { status: 500 }
    );
  }

  const { data: publicUrlData } = admin.storage
    .from("avatars")
    .getPublicUrl(objectName);
  const publicUrl = publicUrlData?.publicUrl;
  if (!publicUrl) {
    return NextResponse.json({ error: "获取头像 URL 失败" }, { status: 500 });
  }

  const { error: updateErr } = await admin
    .from("user_profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);

  if (updateErr) {
    console.error("[api/mp/me/avatar] update profile fail", updateErr);
    return NextResponse.json(
      { error: "保存头像失败：" + updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, avatar_url: publicUrl });
}
