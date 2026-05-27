/**
 * Bearer Token 鉴权工具（给小程序客户端 baozupo-mp 用）
 *
 * 小程序前端拿到 access_token（Supabase 颁发的 JWT）后，
 * 每次请求带在 Authorization: Bearer <token> header 里。
 * 服务端用 supabase.auth.getUser(token) 验证。
 *
 * PWA 浏览器端继续走 cookie session（@supabase/ssr）。这两条路径并存。
 */

import type { NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPrimaryHouseholdId } from "@/lib/get-primary-household";

export interface ApiUser {
  id: string;
  email?: string;
  phone?: string;
  household_id: string;
}

/** 从 Authorization header 拿 Bearer token。没有返回 null。 */
export function extractBearerToken(req: NextRequest | Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m ? m[1].trim() : null;
}

/**
 * 验证 Bearer Token，返回 user + household_id。
 * 失败返回 null（调用方应返回 401）。
 */
export async function getUserFromBearer(
  req: NextRequest | Request
): Promise<ApiUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[api-auth] Supabase env not configured");
    return null;
  }

  // 用 anon key + 显式传 token 调 getUser，supabase 内部会验签 + 检查 exp
  const supabase = createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  // 查 household_id（用 service_role 绕过 RLS，确保拿得到）
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("[api-auth] SUPABASE_SERVICE_ROLE_KEY 未配置");
    return null;
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // 用 getPrimaryHouseholdId 取主家庭组（owner 优先），不会被多行查询报错
  const household_id = await getPrimaryHouseholdId(admin, data.user.id);

  if (!household_id) {
    console.warn("[api-auth] user has no household", data.user.id);
    // 返回 user 但 household_id 为空字符串，调用方按需处理
    return {
      id: data.user.id,
      email: data.user.email,
      phone: data.user.phone,
      household_id: "",
    };
  }

  return {
    id: data.user.id,
    email: data.user.email,
    phone: data.user.phone,
    household_id,
  };
}

/** 拿一个无状态的 supabase client（用 anon key），用于 auth 路由 */
export function getAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
