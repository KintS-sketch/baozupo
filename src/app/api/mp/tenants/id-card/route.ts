/**
 * GET /api/mp/tenants/id-card?tenant_id=XXX
 *
 * 给 mp 端「查看租客身份证」用：拿一个 1 小时有效的 signed URL，
 * 客户端 <image src=...> 直接显示。
 *
 * 校验：tenant 必须属于当前 household。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 3600; // 1 小时

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  const tenantId = req.nextUrl.searchParams.get("tenant_id");
  if (!tenantId)
    return NextResponse.json({ error: "缺少 tenant_id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, household_id, id_card_image_url")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "租客不存在" }, { status: 404 });
  if (tenant.household_id !== user.household_id)
    return NextResponse.json({ error: "无权查看" }, { status: 403 });
  if (!tenant.id_card_image_url)
    return NextResponse.json({ image_url: null });

  const { data: signed, error } = await admin.storage
    .from("contracts")
    .createSignedUrl(tenant.id_card_image_url, SIGNED_URL_TTL);
  if (error || !signed) {
    return NextResponse.json(
      { error: "生成临时链接失败：" + (error?.message ?? "未知") },
      { status: 500 }
    );
  }

  return NextResponse.json({
    image_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL,
  });
}
