/**
 * DELETE /api/mp/household/members/[id]
 *
 * 移除家庭组成员：
 * - owner 可移除任何 member（但不能移除自己）
 * - 任何 member 可移除自己（= 退出家庭组）
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "成员 id 缺失" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 拿这条 member 记录
  const { data: member } = await admin
    .from("household_members")
    .select("id, household_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "成员不存在" }, { status: 404 });

  // 拿对应 household 的 owner_id
  const { data: hh } = await admin
    .from("households")
    .select("owner_id")
    .eq("id", member.household_id)
    .maybeSingle();
  if (!hh) return NextResponse.json({ error: "家庭组不存在" }, { status: 404 });

  const isOwner = hh.owner_id === user.id;
  const isSelf = member.user_id === user.id;

  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }
  if (isOwner && isSelf) {
    return NextResponse.json(
      { error: "房主不能退出自己的家庭组（请到网页版解散）" },
      { status: 400 }
    );
  }
  if (member.user_id === hh.owner_id) {
    return NextResponse.json({ error: "不能移除房主" }, { status: 400 });
  }

  const { error: delErr } = await admin
    .from("household_members")
    .delete()
    .eq("id", id);
  if (delErr) {
    return NextResponse.json(
      { error: "移除失败：" + delErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
