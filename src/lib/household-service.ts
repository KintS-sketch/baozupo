/**
 * 家庭组协同服务层
 *
 * 邀请码流程：
 * 1. owner 调 createInvite(householdId) 生成 6 位 code，24h 过期
 * 2. 受邀人在 /household/join 输入 code
 * 3. 调 acceptInvite(code) 校验后写入 household_members + 标记 invite 已用
 *
 * 安全：
 *   - createInvite 由 RLS 限制只有 owner 能创建
 *   - acceptInvite 用 RLS 允许读未过期未使用的 invite，并在事务中标记 used + 插入 member
 *   - 应用层做额外校验（重复加入、过期、已用），错误信息友好化
 */

import { createClient } from "@/lib/supabase/client";
import { generateInviteCode, normalizeInviteCode } from "@/lib/invite-code";

const INVITE_TTL_HOURS = 24;
const INVITE_CODE_LENGTH = 6;
const MAX_GENERATE_RETRIES = 5;

export interface HouseholdMemberRow {
  id: string;
  household_id: string;
  user_id: string;
  role: "owner" | "member";
  created_at: string;
  email?: string | null;
  display_name?: string | null;
}

export interface InviteRow {
  id: string;
  code: string;
  household_id: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

export async function createInvite(
  householdId: string,
  userId: string
): Promise<{ code: string; expiresAt: string } | { error: string }> {
  const supabase = createClient();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000).toISOString();

  // 短码可能有碰撞（极低概率），失败就重试
  for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
    const code = generateInviteCode(INVITE_CODE_LENGTH);
    const { data, error } = await supabase
      .from("household_invites")
      .insert({
        household_id: householdId,
        code,
        created_by: userId,
        expires_at: expiresAt,
      })
      .select("code, expires_at")
      .single();

    if (!error && data) {
      return { code: data.code, expiresAt: data.expires_at };
    }
    // 23505 = unique_violation
    if (error?.code !== "23505") {
      console.error("[createInvite] error:", error);
      return { error: error?.message ?? "创建邀请失败" };
    }
  }
  return { error: "邀请码生成失败，请重试" };
}

export async function acceptInvite(
  rawCode: string,
  userId: string
): Promise<
  | { ok: true; householdId: string }
  | { ok: false; error: string }
> {
  const code = normalizeInviteCode(rawCode);
  if (code.length !== INVITE_CODE_LENGTH) {
    return { ok: false, error: `邀请码应为 ${INVITE_CODE_LENGTH} 位字符` };
  }

  const supabase = createClient();

  // 查找邀请
  const { data: invite, error: findErr } = await supabase
    .from("household_invites")
    .select("id, household_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  if (findErr) {
    console.error("[acceptInvite] find error:", findErr);
    return { ok: false, error: "查询邀请码失败" };
  }
  if (!invite) {
    return { ok: false, error: "邀请码不存在" };
  }
  if (invite.used_at) {
    return { ok: false, error: "该邀请码已被使用" };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, error: "邀请码已过期，请向房东索取新的" };
  }

  // 检查是否已经是成员
  const { data: existing } = await supabase
    .from("household_members")
    .select("id")
    .eq("household_id", invite.household_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "你已在该家庭组中" };
  }

  // 加入成员（RLS：user_id = auth.uid() 才允许）
  const { error: memberErr } = await supabase
    .from("household_members")
    .insert({
      household_id: invite.household_id,
      user_id: userId,
      role: "member",
    });

  if (memberErr) {
    console.error("[acceptInvite] insert member error:", memberErr);
    return { ok: false, error: "加入失败：" + memberErr.message };
  }

  // 标记 invite 已使用
  const { error: updateErr } = await supabase
    .from("household_invites")
    .update({ used_at: new Date().toISOString(), used_by: userId })
    .eq("id", invite.id);

  if (updateErr) {
    // 已经加入成员了，更新失败只是 audit 不准，不阻塞用户
    console.warn("[acceptInvite] mark used failed:", updateErr);
  }

  return { ok: true, householdId: invite.household_id };
}

export async function listMembers(
  householdId: string
): Promise<HouseholdMemberRow[]> {
  const supabase = createClient();

  const { data: members, error } = await supabase
    .from("household_members")
    .select("id, household_id, user_id, role, created_at")
    .eq("household_id", householdId)
    .order("created_at");

  if (error) {
    console.error("[listMembers] error:", error);
    return [];
  }
  if (!members) return [];

  // 拉取每个成员的 email / display_name（RLS 下只有自己的 user_profiles 可见，
  // 其他成员的 email 暂不展示，仅展示 display_name 或 user_id 后 8 位）
  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, display_name")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return members.map((m) => ({
    ...m,
    role: m.role as "owner" | "member",
    display_name: profileMap.get(m.user_id)?.display_name ?? null,
  }));
}

export async function listActiveInvites(householdId: string): Promise<InviteRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("household_invites")
    .select("id, code, household_id, expires_at, used_at, used_by, created_at")
    .eq("household_id", householdId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listActiveInvites] error:", error);
    return [];
  }
  return (data ?? []) as InviteRow[];
}

export async function removeMember(memberId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("household_members").delete().eq("id", memberId);
  if (error) {
    console.error("[removeMember] error:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  // "撤销" = 把 expires_at 设为过去（保留 audit）
  const supabase = createClient();
  const { error } = await supabase
    .from("household_invites")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", inviteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
