/**
 * POST /api/mp/tenants/upload-id-card
 *
 * mp 端用：拍/选身份证照片后，上传到 supabase storage contracts bucket。
 * 返回 storage 内的相对路径，前端把它跟 LeaseForm 其他字段一起提交。
 *
 * 路径规范：<household_id>/tenant-pending/<timestamp>-<safename>
 * （pending 段是因为 tenant_id 在 LeaseForm 阶段还没有；保存租约时 leases/save
 *  会把路径写到新建 tenant 的 id_card_image_url 字段。）
 *
 * 表单字段（multipart）：file: File（图片，<= 5MB）
 *
 * Returns: { success, image_url }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求不是 multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `图片超过 ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 }
    );
  }
  const mime = file.type || "image/jpeg";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "仅支持 jpg/png/webp/gif" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const safeName = (file.name || "id-card.jpg").replace(/[^\w.\-一-龥]/g, "_");
  const objectPath = `${user.household_id}/tenant-pending/${Date.now()}-${safeName}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("contracts")
    .upload(objectPath, buf, { contentType: mime, upsert: false });
  if (upErr) {
    return NextResponse.json(
      { error: "上传失败：" + upErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, image_url: objectPath });
}
