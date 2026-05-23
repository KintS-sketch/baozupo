import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/wechat-mp-login
 *
 * 微信小程序一键登录。
 *
 * 流程：
 *   1. 小程序前端 wx.login() 拿到 code
 *   2. 调本 API：{ code }
 *   3. 后端用 code + WX_MP_APPID + WX_MP_APPSECRET 调 jscode2session 拿 openid
 *   4. 查 user_profile WHERE wechat_openid = openid
 *      - 有 → 用 service_role 颁发 supabase session 给该 user_id
 *      - 没 → 创建匿名 user + user_profile + household → 颁发 session
 *
 * ⚠️ v0.1 骨架版：等用户提供以下信息后实现：
 *   - WX_MP_APPID（已知 wxbdd517be83947ba4）
 *   - WX_MP_APPSECRET（去微信公众平台「开发管理 → 开发设置 → AppSecret」生成）
 *   - migration: ALTER TABLE user_profile ADD COLUMN wechat_openid TEXT UNIQUE
 */
export async function POST(req: Request) {
  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  if (!body.code) {
    return NextResponse.json(
      { success: false, error: "缺少 code 参数" },
      { status: 400 }
    );
  }

  const appid = process.env.WX_MP_APPID;
  const secret = process.env.WX_MP_APPSECRET;
  if (!appid || !secret) {
    return NextResponse.json(
      {
        success: false,
        error: "微信小程序登录还未启用，请用邮箱登录",
        needs_config: true,
      },
      { status: 501 }
    );
  }

  // TODO: 实现完整流程
  // const wxResp = await fetch(
  //   `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${body.code}&grant_type=authorization_code`
  // );
  // const wxData = await wxResp.json() as { openid?: string; errcode?: number; errmsg?: string };
  // ...
  return NextResponse.json(
    { success: false, error: "微信登录功能开发中" },
    { status: 501 }
  );
}
