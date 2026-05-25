import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/auth/wechat-mp-login
 *
 * 微信小程序「一键登录」完整实现。
 *
 * 流程：
 *   1. 小程序前端 wx.login() 拿 code → POST 给本接口
 *   2. 本接口调 jscode2session(appid, secret, code) 拿 openid + unionid?
 *   3. 用 service_role 查 user_profiles.wechat_mp_openid = openid
 *      - 找到 → 用该 user 颁发 session
 *      - 没找到 → 创建新 auth.user + user_profile.wechat_mp_openid + household + member
 *   4. 颁发 supabase session（用 deterministic password + signInWithPassword）
 *
 * 必需环境变量（ECS .env.production 加）：
 *   WX_MP_APPID         = wxbdd517be83947ba4
 *   WX_MP_APPSECRET     = （用户在 mp 后台生成）
 *   WX_MP_USER_SECRET   = （随机 32 字节字符串，用于派生用户密码；一旦设定不能改！）
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 安全说明：
 *   - 不存任何明文密码到数据库
 *   - 每个微信用户的"虚拟密码" = HMAC(openid, WX_MP_USER_SECRET)
 *     只要 WX_MP_USER_SECRET 不泄露就无法反推
 *   - 虚拟邮箱 `mp_${openid}@tend.internal` 不可达外部，仅用于 supabase auth
 */

interface JsCode2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

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
  const userSecret = process.env.WX_MP_USER_SECRET;
  if (!appid || !secret || !userSecret) {
    console.error("[wechat-mp-login] missing env", {
      hasAppid: !!appid,
      hasSecret: !!secret,
      hasUserSecret: !!userSecret,
    });
    return NextResponse.json(
      {
        success: false,
        error: "微信小程序登录未启用（服务端配置缺失）",
        needs_config: true,
      },
      { status: 501 }
    );
  }

  // 1. jscode2session 换 openid
  let wxData: JsCode2SessionResponse;
  try {
    const wxResp = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${body.code}&grant_type=authorization_code`,
      { cache: "no-store" }
    );
    wxData = (await wxResp.json()) as JsCode2SessionResponse;
  } catch (err) {
    console.error("[wechat-mp-login] jscode2session fetch fail", err);
    return NextResponse.json(
      { success: false, error: "无法连接微信服务器，请重试" },
      { status: 502 }
    );
  }

  if (!wxData.openid) {
    return NextResponse.json(
      {
        success: false,
        error: `微信换 openid 失败：${wxData.errmsg ?? "未知"} (code=${wxData.errcode ?? "?"})`,
      },
      { status: 500 }
    );
  }

  const openid = wxData.openid;
  const unionid = wxData.unionid ?? null;

  // 2. 建 supabase 客户端
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return NextResponse.json(
      { success: false, error: "Supabase 配置缺失" },
      { status: 500 }
    );
  }

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createSupabaseClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 派生虚拟邮箱 + 确定性密码
  const fakeEmail = `mp_${openid}@tend.internal`.toLowerCase();
  const fakePassword = createHmac("sha256", userSecret)
    .update(openid)
    .digest("hex")
    .slice(0, 32); // 32 字符够 Supabase 密码要求

  // 3. 查现有用户
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id")
    .eq("wechat_mp_openid", openid)
    .maybeSingle();

  let userId: string;

  if (existingProfile) {
    userId = existingProfile.id;
    // 顺手更新 unionid（如果之前没存）
    if (unionid) {
      await admin
        .from("user_profiles")
        .update({ wechat_unionid: unionid })
        .eq("id", userId);
    }
  } else {
    // 4. 创建新 auth 用户
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: fakeEmail,
      password: fakePassword,
      email_confirm: true,
      user_metadata: { source: "wechat_mp", openid },
    });
    if (createErr || !created.user) {
      console.error("[wechat-mp-login] createUser fail", createErr);
      return NextResponse.json(
        {
          success: false,
          error: "创建账号失败：" + (createErr?.message ?? "未知"),
        },
        { status: 500 }
      );
    }
    userId = created.user.id;

    // 5. user_profiles 触发器自动建了一行，update 加 openid
    const { error: updateProfErr } = await admin
      .from("user_profiles")
      .update({ wechat_mp_openid: openid, wechat_unionid: unionid })
      .eq("id", userId);
    if (updateProfErr) {
      console.warn("[wechat-mp-login] update profile fail", updateProfErr);
    }

    // 6. 自动建 household + member（首次登录就有家庭组可用）
    const { data: household, error: hhErr } = await admin
      .from("households")
      .insert({ name: "我的家庭组", owner_id: userId })
      .select("id")
      .single();
    if (hhErr || !household) {
      console.warn("[wechat-mp-login] create household fail", hhErr);
    } else {
      await admin.from("household_members").insert({
        household_id: household.id,
        user_id: userId,
        role: "owner",
      });
    }
  }

  // 7. 颁发 session（signInWithPassword）
  const { data: sessionData, error: signErr } = await anon.auth.signInWithPassword({
    email: fakeEmail,
    password: fakePassword,
  });
  if (signErr || !sessionData?.session) {
    console.error("[wechat-mp-login] signIn fail", signErr);
    return NextResponse.json(
      {
        success: false,
        error: "颁发会话失败：" + (signErr?.message ?? "未知"),
      },
      { status: 500 }
    );
  }

  // 8. 查 household_id 返回给前端
  const { data: member } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at: sessionData.session.expires_at,
    household_id: member?.household_id ?? null,
    user: {
      id: userId,
      email: sessionData.user?.email ?? fakeEmail,
      phone: null,
    },
  });
}
