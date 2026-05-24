/**
 * POST /api/mp/leases/upload-contract
 *
 * mp 端用的合同附件上传端点。uni.uploadFile 走 multipart/form-data，
 * Next.js 服务端用 request.formData() 解析。
 *
 * 上传到 supabase storage 的 `contracts` bucket，路径 `<household_id>/<lease_id>/<ts>-<safename>`，
 * 然后写一条 attachments 记录关联到 lease。
 *
 * 表单字段（multipart）：
 *   - lease_id: string
 *   - file: File（PDF / 图片）
 *
 * 大小限制：10MB
 *
 * Returns: { success, file_url, attachment_id }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

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

  const leaseId = formData.get("lease_id");
  const file = formData.get("file");
  if (typeof leaseId !== "string" || !leaseId) {
    return NextResponse.json({ error: "缺少 lease_id" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `文件超过 ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 }
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

  try {
    // 校验租约归属
    const { data: lease } = await admin
      .from("leases")
      .select("id")
      .eq("id", leaseId)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lease) {
      return NextResponse.json({ error: "租约不存在或不属于你" }, { status: 404 });
    }

    // 路径与 PWA 一致：household_id/lease_id/timestamp-safename
    const safeName = (file.name || "file").replace(/[^\w.\-一-龥]/g, "_");
    const objectPath = `${user.household_id}/${leaseId}/${Date.now()}-${safeName}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from("contracts").upload(objectPath, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) {
      return NextResponse.json(
        { error: "上传失败：" + upErr.message },
        { status: 500 }
      );
    }

    const { data: att, error: attErr } = await admin
      .from("attachments")
      .insert({
        household_id: user.household_id,
        entity_type: "lease",
        entity_id: leaseId,
        file_name: file.name,
        file_url: objectPath,
        mime_type: file.type || null,
        file_size: file.size,
      })
      .select("id")
      .single();

    if (attErr) {
      // 文件已传成功，attachment 表插入失败 — 删掉文件回滚
      await admin.storage.from("contracts").remove([objectPath]).catch(() => {});
      return NextResponse.json(
        { error: "保存附件记录失败：" + attErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      file_url: objectPath,
      attachment_id: att.id,
    });
  } catch (err) {
    console.error("[api/mp/leases/upload-contract] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "上传失败" },
      { status: 500 }
    );
  }
}
