import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { exchangeCodeForUserInfo } from "@/lib/wechat";
import { decodeState } from "@/lib/wechat/state";

export const runtime = "nodejs";

/**
 * GET /api/wechat/oauth/callback?code=xxx&state=yyy
 *
 * 微信授权完成后跳转到这里：
 * 1. 校验 state（防 CSRF）→ 得到 user_id
 * 2. 用 code 调微信接口换 openid + nickname
 * 3. 用 service_role 把 openid 写入 user_profiles
 * 4. 重定向回 /settings?wechat=bound
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const decoded = decodeState(state);
  if (!decoded) {
    return NextResponse.redirect(`${url.origin}/settings?wechat=state_invalid`);
  }
  if (!code) {
    return NextResponse.redirect(`${url.origin}/settings?wechat=code_missing`);
  }

  let userInfo;
  try {
    userInfo = await exchangeCodeForUserInfo(code);
  } catch (err) {
    console.error("[wechat/callback] exchange failed:", err);
    return NextResponse.redirect(`${url.origin}/settings?wechat=exchange_failed`);
  }

  // 用 service_role 写库（绕过 RLS，因为这是服务器侧操作）
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[wechat/callback] missing service role key");
    return NextResponse.redirect(`${url.origin}/settings?wechat=server_error`);
  }
  const admin = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 检查 OpenID 是否已被别的账号绑定（防止一个 openid 同时绑两个账号）
  const { data: existing } = await admin
    .from("user_profiles")
    .select("id")
    .eq("wechat_openid", userInfo.openid)
    .neq("id", decoded.userId)
    .maybeSingle();
  if (existing) {
    return NextResponse.redirect(`${url.origin}/settings?wechat=already_bound_other`);
  }

  const { error: updateErr } = await admin
    .from("user_profiles")
    .update({
      wechat_openid:   userInfo.openid,
      wechat_nickname: userInfo.nickname ?? null,
      wechat_bound_at: new Date().toISOString(),
    })
    .eq("id", decoded.userId);

  if (updateErr) {
    console.error("[wechat/callback] update failed:", updateErr);
    return NextResponse.redirect(`${url.origin}/settings?wechat=db_error`);
  }

  // 同步登录态（callback 是无 cookies 状态，需重定向到设置页让用户重新进入）
  // 这里返回成功状态，前端读取 query 参数后 toast 提示
  const supabase = await createServerSupabase();
  // 触发一次 getUser 让 cookie 刷新（如有需要）
  await supabase.auth.getUser();

  return NextResponse.redirect(`${url.origin}/settings?wechat=bound`);
}
