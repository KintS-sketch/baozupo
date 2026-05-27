/**
 * getPrimaryHouseholdId(admin, userId)
 *
 * 查询用户的"主家庭组" ID。返回 null 表示用户没有任何家庭组。
 *
 * 选择规则（防御一个 user 在多个 household_members 行的场景）：
 *   1. 优先选 role = 'owner' 的（用户自己作为房东的家庭组）
 *   2. 如果没有 owner（用户只是被邀请加入了别人的家庭组），按 created_at 升序取最早一行
 *   3. 都没有返回 null
 *
 * 为什么不能简单 .eq('user_id').maybeSingle()？
 *   - household_members 表的 unique 约束是 (user_id, household_id) 复合键
 *   - 用户被邀请加入他人家庭组时会出现多行：
 *     ① 自己的家庭组（owner）
 *     ② 别人邀请进入的家庭组（member）
 *   - maybeSingle() 在多行时报 "JSON object requested, multiple..." 错误，
 *     导致 getUserFromBearer 返回 household_id=空，所有 /api/mp/* 接口报"无家庭组"
 *
 * 必须用 service_role 客户端（绕过 RLS）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getPrimaryHouseholdId(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  // 1) 优先 owner（"我自己的房东账户"）
  const { data: ownerRows, error: ownerErr } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1);

  if (ownerErr) {
    console.error("[getPrimaryHouseholdId] query owner fail", ownerErr, {
      userId,
    });
    // 不抛错，继续尝试 fallback 查询
  }
  if (ownerRows && ownerRows.length > 0) {
    return ownerRows[0].household_id;
  }

  // 2) 没 owner（用户只是被邀请进入了别人的家庭组）→ 取最早加入的
  const { data: anyRows, error: anyErr } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (anyErr) {
    console.error("[getPrimaryHouseholdId] query any fail", anyErr, { userId });
    return null;
  }

  return anyRows && anyRows.length > 0 ? anyRows[0].household_id : null;
}
