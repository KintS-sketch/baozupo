/**
 * GET /api/mp/household
 *
 * 当前 household 详情 + 成员列表 + 活跃邀请码（未过期未使用）。
 * 当前用户是否 owner 由 households.owner_id 判断。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({
      household: null,
      is_owner: false,
      members: [],
      invites: [],
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: hh } = await admin
    .from("households")
    .select("id, name, owner_id, created_at")
    .eq("id", user.household_id)
    .maybeSingle();

  if (!hh) return NextResponse.json({ error: "家庭组不存在" }, { status: 404 });

  const isOwner = hh.owner_id === user.id;

  // 成员列表（join user_profiles 拿 display_name + auth.users 拿 email）
  const { data: members } = await admin
    .from("household_members")
    .select("id, user_id, role, created_at")
    .eq("household_id", user.household_id)
    .order("created_at", { ascending: true });

  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  let profiles: { id: string; display_name: string | null }[] = [];
  if (userIds.length > 0) {
    const { data } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", userIds);
    profiles = data ?? [];
  }
  const profMap = new Map(profiles.map((p) => [p.id, p.display_name]));

  // 拿 email（auth.users 在 supabase 里用 listUsers 比较麻烦，跳过 — 用 display_name 即可，没 display_name 显示 user_id 前 8 位）
  type Member = {
    id: string;
    user_id: string;
    role: string;
    created_at: string;
  };
  const memberList = (members ?? []).map((m: Member) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.user_id === hh.owner_id ? "owner" : m.role,
    display_name:
      profMap.get(m.user_id) ?? `用户 ${m.user_id.slice(0, 8)}`,
    is_self: m.user_id === user.id,
    created_at: m.created_at,
  }));

  // 活跃邀请码
  const { data: invites } = await admin
    .from("household_invites")
    .select("id, code, created_at, expires_at")
    .eq("household_id", user.household_id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  return NextResponse.json({
    household: { id: hh.id, name: hh.name, created_at: hh.created_at },
    is_owner: isOwner,
    members: memberList,
    invites: invites ?? [],
  });
}
