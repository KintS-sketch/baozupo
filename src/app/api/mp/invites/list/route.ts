/**
 * GET /api/mp/invites/list
 *
 * mp 端「邀请箱」列表接口。返回当前 household 全部 form_invites（按创建时间倒序），
 * 客户端自己按 submitted_at / accepted_at / expires_at 分三组：
 *   - 等你处理：submitted_at 有 && accepted_at 无
 *   - 等对方填：submitted_at 无 && accepted_at 无 && expires_at > now
 *   - 历史：accepted_at 有 || (submitted_at 无 && expires_at <= now)
 *
 * 等价于 PWA src/app/invites/page.tsx 里的 supabase.from("form_invites").select("*").eq("household_id", ...)。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ invites: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from("form_invites")
    .select(
      "id, token, purpose, prefilled_data, submitted_data, submitted_at, accepted_at, accepted_tenant_id, expires_at, created_at"
    )
    .eq("household_id", user.household_id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "加载邀请失败：" + error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    invites: data ?? [],
    share_base_url: "https://tendapp.cn",
  });
}
