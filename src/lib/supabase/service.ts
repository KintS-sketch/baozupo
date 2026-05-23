/**
 * Service-role Supabase client — 绕开 RLS 用。
 *
 * 仅在需要从匿名上下文（如公开签字页 /sign/[token]）访问受 RLS 保护的数据时使用。
 * 永远不要在客户端 / 浏览器中使用此 client。
 *
 * 需要环境变量 SUPABASE_SERVICE_ROLE_KEY（在 Supabase Studio → Settings → API 找）。
 */

/* eslint-disable */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 项目暂无生成的 Database 类型，用 any 让 .from(...).select(...) 返回宽松类型。
// 调用方需自行 cast 返回值。仅此 service 文件用 any，其他模块继续严格类型。
type AnySupabase = SupabaseClient<any, "public", any>;

let cached: AnySupabase | null = null;

export function createServiceClient(): AnySupabase {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY 未设置。请到 Supabase Studio → Settings → API 复制 service_role key 到 .env"
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AnySupabase;
  return cached;
}
