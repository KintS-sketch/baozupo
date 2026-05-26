/**
 * POST /api/mp/invites/[id]/delete
 *
 * mp 端「邀请箱」删除一条邀请（不可恢复，仅前端历史区使用）。
 *
 * 鉴权：用户必须是邀请所属 household 的成员。
 *
 * 注意：若 accepted_tenant_id 已绑定到具体租约/账单，不会做级联清理——
 *      只删 form_invites 这一行（避免误删租客记录）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "未加入任何家庭组" }, { status: 400 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "邀请 id 缺失" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 校验归属
  const { data: invite } = await admin
    .from("form_invites")
    .select("id, household_id")
    .eq("id", id)
    .maybeSingle();
  if (!invite) return NextResponse.json({ error: "邀请不存在" }, { status: 404 });
  if (invite.household_id !== user.household_id) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  const { error: delErr } = await admin.from("form_invites").delete().eq("id", id);
  if (delErr) {
    console.error("[api/mp/invites/delete] delete fail", delErr);
    return NextResponse.json({ error: "删除失败：" + delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
