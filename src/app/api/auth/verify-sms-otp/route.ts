/**
 * POST /api/auth/verify-sms-otp
 *
 * 校验手机验证码 → 注册（新手机号）或登录（已注册手机号），无密码。
 *
 * Body: { phone: string, code: string }
 * Returns:
 *   { success: true, access_token, refresh_token, expires_at, household_id, user, is_new_user }
 *
 * 流程：
 *   1. 校验手机号 + 验证码格式
 *   2. 在 sms_otp_verifications 找 phone 匹配的最新未使用记录
 *   3. 验证 hash 匹配 + 没过期 + attempts < 5
 *   4. 标 consumed_at
 *   5. 找 user_profiles.phone = phone：
 *      - 找到 → 用对应虚拟邮箱 signInWithPassword 颁发 session
 *      - 没找到 → admin.createUser(虚拟邮箱 + 派生密码) → 触发器自动建 household
 *               → signInWithPassword 颁发 session
 *   6. 把 phone 同步到 user_profiles.phone
 *
 * 设计：
 *   - 虚拟邮箱：phone_<phone>@tend.internal （注：phone 也用 mp_xxx 的同套虚拟邮箱方案）
 *   - 虚拟密码：HMAC(phone, OTP_USER_SECRET) — 跟 mp openid 类似
 *
 * 需要 .env.production 配置（除现有的）：
 *   OTP_USER_SECRET=<32 字节随机串，永久不能改>
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

function hashCode(phone: string, code: string, pepper: string): string {
  return createHash("sha256").update(`${phone}|${code}|${pepper}`).digest("hex");
}

export async function POST(req: Request) {
  let body: { phone?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const code = (body.code ?? "").trim();

  if (!isValidPhone(phone)) {
    return NextResponse.json({ success: false, error: "手机号格式不正确" }, { status: 400 });
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

  // 1. 找 phone 匹配的最新未消费 OTP
  const codeHash = hashCode(phone, code, pepper);
  const { data: otp, error: otpErr } = await admin
    .from("sms_otp_verifications")
    .select("id, code_hash, attempts, expires_at, consumed_at")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpErr) {
    console.error("[verify-sms-otp] query fail", otpErr);
    return NextResponse.json({ success: false, error: "校验失败" }, { status: 500 });
  }
  if (!otp) {
    return NextResponse.json(
      { success: false, error: "请先获取验证码" },
      { status: 400 }
    );
  }

  // 过期
  if (new Date(otp.expires_at) < new Date()) {
    return NextResponse.json(
      { success: false, error: "验证码已过期，请重新获取" },
      { status: 400 }
    );
  }
  // 尝试次数超限
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { success: false, error: "尝试次数过多，请重新获取验证码" },
      { status: 429 }
    );
  }

  // 验证 hash
  if (otp.code_hash !== codeHash) {
    // 失败 attempts +1
    await admin
      .from("sms_otp_verifications")
      .update({ attempts: otp.attempts + 1 })
      .eq("id", otp.id);
    return NextResponse.json(
      { success: false, error: "验证码错误" },
      { status: 400 }
    );
  }

  // 标 consumed
  await admin
    .from("sms_otp_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", otp.id);

  // 2. 派生虚拟邮箱 + 确定性密码
  const fakeEmail = `phone_${phone}@tend.internal`;
  const fakePassword = createHmac("sha256", userSecret).update(phone).digest("hex").slice(0, 32);

  // 3. 查现有用户
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  let userId: string;
  let isNewUser = false;

  if (existingProfile) {
    userId = existingProfile.id;
  } else {
    // 新用户：建 auth.user
    isNewUser = true;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: fakeEmail,
      password: fakePassword,
      email_confirm: true,
      phone,
      phone_confirm: true,
      user_metadata: { source: "sms_otp", phone },
    });
    if (createErr || !created.user) {
      console.error("[verify-sms-otp] createUser fail", createErr);
      return NextResponse.json(
        { success: false, error: "创建账号失败：" + (createErr?.message ?? "未知") },
        { status: 500 }
      );
    }
    userId = created.user.id;

    // 把 phone 同步到 user_profiles（trigger 已经建好这行 + household + member）
    const { error: updProfErr } = await admin
      .from("user_profiles")
      .update({ phone, display_name: "房东" })
      .eq("id", userId);
    if (updProfErr) {
      console.warn("[verify-sms-otp] update profile fail", updProfErr);
    }
  }

  // 4. 颁发 session（用 signInWithPassword）
  const { data: sessionData, error: signErr } = await anon.auth.signInWithPassword({
    email: fakeEmail,
    password: fakePassword,
  });
  if (signErr || !sessionData?.session) {
    console.error("[verify-sms-otp] signIn fail", signErr);
    return NextResponse.json(
      { success: false, error: "颁发会话失败：" + (signErr?.message ?? "未知") },
      { status: 500 }
    );
  }

  // 5. 查 household_id + display_name
  const [{ data: member }, { data: profile }] = await Promise.all([
    admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("user_profiles")
      .select("display_name, phone")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    success: true,
    is_new_user: isNewUser,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at: sessionData.session.expires_at,
    household_id: member?.household_id ?? null,
    user: {
      id: userId,
      email: sessionData.user?.email ?? fakeEmail,
      phone: profile?.phone ?? phone,
      display_name: profile?.display_name ?? "房东",
    },
  });
}
