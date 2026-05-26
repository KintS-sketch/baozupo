/**
 * POST /api/mp/wechat/gen-bind-link
 *
 * mp 端用：生成一个"在微信内打开即可绑定服务号"的授权链接，5 分钟有效。
 * 用户点 mp 端「绑定微信，开启自动提醒」时：
 *   1. mp 调本接口拿一条 https://open.weixin.qq.com/... 的链接
 *   2. mp 弹窗 + 一键复制 + 一键转发卡片
 *   3. 用户在微信内打开链接 → 微信弹原生公众号授权窗
 *   4. 授权后回到 /api/wechat/oauth/callback → 用 state 拿 user_id 绑 wechat_openid
 *
 * Returns: { success, bind_url, expires_in }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getUserFromBearer } from "@/lib/api-auth";
import { buildAuthorizeUrl, isWechatConfigured } from "@/lib/wechat";
import { encodeState } from "@/lib/wechat/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL = "https://tendapp.cn";

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  if (!isWechatConfigured()) {
    return NextResponse.json(
      {
        error: "服务端未配置微信公众号，请联系管理员",
        needs_config: true,
      },
      { status: 503 }
    );
  }

  let bindUrl: string;
  try {
    const state = encodeState(user.id);
    bindUrl = buildAuthorizeUrl({
      redirectUri: `${BASE_URL}/api/wechat/oauth/callback`,
      state,
      scope: "snsapi_userinfo",
    });
  } catch (err) {
    console.error("[api/mp/wechat/gen-bind-link] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成绑定链接失败" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    bind_url: bindUrl,
    expires_in: 10 * 60, // 10 分钟（跟 state TTL 一致）
  });
}
