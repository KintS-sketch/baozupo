/**
 * POST /api/auth/email-otp-register
 *
 * 邮箱 + 验证码 + 自定义密码 注册新账号
 *
 * Body: { email: string, code: string, password: string }
 * Returns:
 *   { success: true, access_token, refresh_token, expires_at, household_id, user }
 *
 * 流程：
 *   1. 校验 email/code/password 格式
 *   2. 找最新未消费 email_otp_verifications 记录，验 hash + 没过期 + 尝试次数没爆
 *   3. createUser({ email, password })
 *   4. signInWithPassword 颁发 session
 *
 * 跟 verify-email-otp 区别：这个让用户自定义密码（后续就用 email + 密码 登录），
 * verify-email-otp 是无密码 magic login（用派生密码）。
 *
 * 需要 .env：
 *   OTP_HASH_PEPPER（跟短信共享）
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getPrimaryHouseholdId } from "@/lib/get-primary-household";

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
  let body: { email?: string; code?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  const password = body.password ?? "";

  if (!isValidEmail(email)) {
    return NextResponse.json({ success: false, error: "邮箱格式不正确" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ success: false, error: "验证码需为 6 位数字" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ success: false, error: "密码至少 6 位" }, { status: 400 });
  }
  if (password.length > 72) {
    return NextResponse.json({ success: false, error: "密码不能超过 72 位" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pepper = process.env.OTP_HASH_PEPPER;

  if (!supabaseUrl || !serviceKey || !anonKey || !pepper) {
    return NextResponse.json(
      {
        success: false,
        error: "服务端配置缺失（OTP_HASH_PEPPER 未设置）",
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

  // 1. 找 OTP
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
    console.error("[email-otp-register] query fail", otpErr);
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

  // 2. 检查邮箱是否已注册
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    return NextResponse.json(
      { success: false, error: "该邮箱已注册，请直接登录" },
      { status: 400 }
    );
  }

  // 3. 标 consumed
  await admin
    .from("email_otp_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", otp.id);

  // 4. 创建用户
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "email_otp_register" },
  });
  if (createErr || !created.user) {
    console.error("[email-otp-register] createUser fail", createErr);
    return NextResponse.json(
      { success: false, error: "创建账号失败：" + (createErr?.message ?? "未知") },
      { status: 500 }
    );
  }
  const userId = created.user.id;

  // 5. 同步 email + display_name 到 profile（trigger 已建好这行）
  await admin
    .from("user_profiles")
    .update({ email, display_name: "房东" })
    .eq("id", userId);

  // 6. 颁发 session
  const { data: sessionData, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || !sessionData?.session) {
    console.error("[email-otp-register] signIn fail", signErr);
    return NextResponse.json(
      { success: false, error: "颁发会话失败：" + (signErr?.message ?? "未知") },
      { status: 500 }
    );
  }

  // 7. 查 household_id
  const household_id = await getPrimaryHouseholdId(admin, userId);

  return NextResponse.json({
    success: true,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at: sessionData.session.expires_at,
    household_id,
    user: {
      id: userId,
      email,
      display_name: "房东",
    },
  });
}
