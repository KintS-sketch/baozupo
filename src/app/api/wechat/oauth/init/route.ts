import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, isWechatConfigured } from "@/lib/wechat";
import { encodeState } from "@/lib/wechat/state";

export const runtime = "nodejs";

/**
 * GET /api/wechat/oauth/init
 *
 * 用户点"绑定微信"按钮时跳转到此 URL：
 * 1. 校验当前 session（必须已登录养房 Tend 账号）
 * 2. 生成签名 state（绑定到当前 user_id）
 * 3. 构造微信授权 URL → 302 跳转
 *
 * 用户在微信内打开后，微信会自动授权并回调到 /api/wechat/oauth/callback
 */
export async function GET(request: Request) {
  if (!isWechatConfigured()) {
    return NextResponse.json(
      { error: "服务端未配置微信公众号，请联系管理员" },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = new URL(request.url);
    return NextResponse.redirect(`${url.origin}/login?next=/settings`);
  }

  const { origin } = new URL(request.url);
  const state = encodeState(user.id);
  const authorizeUrl = buildAuthorizeUrl({
    redirectUri: `${origin}/api/wechat/oauth/callback`,
    state,
    scope: "snsapi_userinfo",
  });

  return NextResponse.redirect(authorizeUrl);
}
