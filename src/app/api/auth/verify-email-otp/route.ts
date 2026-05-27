/**
 * POST /api/auth/verify-email-otp
 *
 * 校验邮箱验证码 → 注册（新邮箱）或登录（已注册邮箱），无密码。
 *
 * Body: { email: string, code: string }
 * Returns:
 *   { success: true, access_token, refresh_token, expires_at, household_id, user, is_new_user }
 *
 * 流程跟 verify-sms-otp 完全一致，只是改用邮箱作主键：
 *   - 用 email 当虚拟用户的真实邮箱（不需要虚拟邮箱）
 *   - 用 HMAC(email, OTP_USER_SECRET) 当虚拟密码
 *
 * 设计：
 *   - 虚拟密码: HMAC(email, OTP_USER_SECRET) — 跟 phone 用同一个 secret
 *   - 注册触发器会自动建 household + user_profiles
 *
 * 需要 .env.production:
 *   OTP_HASH_PEPPER（跟短信共享）
 *   OTP_USER_SECRET（跟短信共享，永久不能改）
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "crypto";
import { ensureHousehold } from "@/lib/ensure-household";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function hashCode(email: string, code: string, pepper: string): string {
  return createHash("sha256").update(`${email}|${code}|${pepper}`).digest("hex");
}

export async function POST(req: Request) {
  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();

  if (!isValidEmail(email)) {
    return NextResponse.json({ success: false, error: "邮箱格式不正确" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ success: false, error: "验证码需为 6 位数字" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pepper = process.env.OTP_HASH_PEPPER;
  const userSecret = process.env.OTP_USER_SECRET;

  if (!supabaseUrl || !serviceKey || !anonKey || !pepper || !userSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "服务端配置缺失（OTP_HASH_PEPPER / OTP_USER_SECRET 未设置）",
        needs_config: true,
      },
      { status: 501 }
    );
  }

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createSupabaseClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 找最新未消费 OTP
  const codeHash = hashCode(email, code, pepper);
  const { data: otp, error: otpErr } = await admin
    .from("email_otp_verifications")
    .select("id, code_hash, attempts, expires_at, consumed_at")
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpErr) {
    console.error("[verify-email-otp] query fail", otpErr);
    return NextResponse.json({ success: false, error: "校验失败" }, { status: 500 });
  }
  if (!otp) {
    return NextResponse.json({ success: false, error: "请先获取验证码" }, { status: 400 });
  }
  if (new Date(otp.expires_at) < new Date()) {
    return NextResponse.json(
      { success: false, error: "验证码已过期，请重新获取" },
      { status: 400 }
    );
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { success: false, error: "尝试次数过多，请重新获取验证码" },
      { status: 429 }
    );
  }
  if (otp.code_hash !== codeHash) {
    await admin
      .from("email_otp_verifications")
      .update({ attempts: otp.attempts + 1 })
      .eq("id", otp.id);
    return NextResponse.json({ success: false, error: "验证码错误" }, { status: 400 });
  }

  // 标 consumed
  await admin
    .from("email_otp_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", otp.id);

  // 派生虚拟密码（跟 phone 复用同一个 secret）
  const fakePassword = createHmac("sha256", userSecret).update(email).digest("hex").slice(0, 32);

  // 查现有用户（按真邮箱）
  // 注意：auth.users 表无法直接 select 邮箱，得用 admin.listUsers 或者 profile
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .eq("email", email)
    .maybeSingle();

  let userId: string;
  let isNewUser = false;

  if (existingProfile) {
    userId = existingProfile.id;
    // 老用户有可能没设密码（早期邮箱密码用户），需要强制 reset 一下
    // 简化：直接 updateUser 让密码跟我们派生的一致，之后 signInWithPassword 总能过
    await admin.auth.admin.updateUserById(userId, { password: fakePassword });
  } else {
    // 新用户
    isNewUser = true;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: fakePassword,
      email_confirm: true,
      user_metadata: { source: "email_otp" },
    });
    if (createErr || !created.user) {
      console.error("[verify-email-otp] createUser fail", createErr);
      return NextResponse.json(
        { success: false, error: "创建账号失败：" + (createErr?.message ?? "未知") },
        { status: 500 }
      );
    }
    userId = created.user.id;

    // 同步 email + display_name 到 profile（触发器已建好这行）
    const { error: updProfErr } = await admin
      .from("user_profiles")
      .update({ email, display_name: "房东" })
      .eq("id", userId);
    if (updProfErr) {
      console.warn("[verify-email-otp] update profile fail", updProfErr);
    }
  }

  // 兜底：保证用户一定有 household_id（防御 0017 trigger 未生效）
  let householdId: string;
  try {
    householdId = await ensureHousehold(admin, userId);
  } catch (err) {
    console.error("[verify-email-otp] ensureHousehold fail", err, { userId });
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? `家庭组初始化失败：${err.message}`
            : "家庭组初始化失败",
      },
      { status: 500 }
    );
  }

  // 颁发 session
  const { data: sessionData, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password: fakePassword,
  });
  if (signErr || !sessionData?.session) {
    console.error("[verify-email-otp] signIn fail", signErr);
    return NextResponse.json(
      { success: false, error: "颁发会话失败：" + (signErr?.message ?? "未知") },
      { status: 500 }
    );
  }

  // 查 profile 返回（household_id 已由 ensureHousehold 保证）
  const { data: profile } = await admin
    .from("user_profiles")
    .select("display_name, phone, email")
    .eq("id", userId)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    is_new_user: isNewUser,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at: sessionData.session.expires_at,
    household_id: householdId,
    user: {
      id: userId,
      email: profile?.email ?? email,
      phone: profile?.phone ?? undefined,
      display_name: profile?.display_name ?? "房东",
    },
  });
}
