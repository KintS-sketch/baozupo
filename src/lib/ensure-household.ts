/**
 * ensureHousehold(admin, userId)
 *
 * 防御性函数：保证给定 userId 在 household_members 中有一行（role=owner），
 * 返回 household_id。
 *
 * 背景：
 *   - 0017_auto_household_on_signup.sql 的 trigger 应该在 auth.users 插入时
 *     自动创建 household + household_members
 *   - 但实际生产 RDS 上 0017 是否跑过/触发器是否生效不确定（前期种子用户出现
 *     新登录就 household_id=null 的问题）
 *   - wechat-mp-login / verify-sms-otp / verify-email-otp 等路由各自有
 *     创建逻辑，但都是 console.warn 静默失败，不健壮
 *
 * 本函数取代各路由里的"建 household + member"散逻辑，提供单点防御：
 *   1. 先查 household_members 是否已有 → 有则直接返回
 *   2. 没有：查 households 是否有 owner_id = userId 的（孤儿 household） → 有则补 member
 *   3. 都没有：新建 household（"我的家庭组" / owner_id = userId） + member
 *   4. 任何异常都抛出 Error，调用方决定怎么处理
 *
 * 必须用 service_role 客户端（绕过 RLS）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_HOUSEHOLD_NAME = "我的家庭组";

export async function ensureHousehold(
  admin: SupabaseClient,
  userId: string
): Promise<string> {
  // 1) 已是某家庭组成员？
  // 注意：一个 user 可能在多个 household 里（0009 的 unique 是 (user_id, household_id) 复合键）
  // 所以这里用 limit(1) 取第一个，而不是 maybeSingle()（多行会报错 "JSON object requested, multiple..."）
  const { data: memberRows, error: memErr } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .limit(1);

  if (memErr) {
    console.error("[ensureHousehold] query members fail", memErr, { userId });
    throw new Error(`查询家庭组成员失败：${memErr.message}`);
  }
  if (memberRows && memberRows.length > 0 && memberRows[0].household_id) {
    return memberRows[0].household_id;
  }

  // 2) 有孤儿 household？（owner_id = userId 但没建 member）
  const { data: hhRows, error: orphanErr } = await admin
    .from("households")
    .select("id")
    .eq("owner_id", userId)
    .limit(1);

  if (orphanErr) {
    console.error("[ensureHousehold] query orphan household fail", orphanErr, {
      userId,
    });
    throw new Error(`查询家庭组失败：${orphanErr.message}`);
  }
  const orphanHh = hhRows && hhRows.length > 0 ? hhRows[0] : null;

  let householdId: string;
  if (orphanHh?.id) {
    householdId = orphanHh.id;
  } else {
    // 3) 新建 household
    const { data: created, error: createErr } = await admin
      .from("households")
      .insert({ name: DEFAULT_HOUSEHOLD_NAME, owner_id: userId })
      .select("id")
      .single();

    if (createErr || !created) {
      // 可能并发竞争（trigger 同时建了）→ 再查一次孤儿
      const { data: retryRows } = await admin
        .from("households")
        .select("id")
        .eq("owner_id", userId)
        .limit(1);
      const retry = retryRows && retryRows.length > 0 ? retryRows[0] : null;
      if (!retry?.id) {
        console.error("[ensureHousehold] create household fail", createErr, {
          userId,
        });
        throw new Error(
          `创建家庭组失败：${createErr?.message ?? "未知"}`
        );
      }
      householdId = retry.id;
    } else {
      householdId = created.id;
    }
  }

  // 4) 补建 household_members
  const { error: insMemErr } = await admin
    .from("household_members")
    .insert({ household_id: householdId, user_id: userId, role: "owner" });

  if (insMemErr) {
    // 可能 trigger 已建（household_members_user_household_unique 冲突）— 当成功处理
    // 再查一次确认确实存在
    const { data: confirmRows } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .limit(1);
    const confirmMember =
      confirmRows && confirmRows.length > 0 ? confirmRows[0] : null;
    if (!confirmMember?.household_id) {
      console.error("[ensureHousehold] insert member fail", insMemErr, {
        userId,
        householdId,
      });
      throw new Error(`绑定家庭组成员失败：${insMemErr.message}`);
    }
    return confirmMember.household_id;
  }

  return householdId;
}
