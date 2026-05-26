/**
 * POST /api/auth/send-email-otp
 *
 * 给用户的邮箱发 6 位数字验证码，注册登录通用。
 *
 * Body: { email: string, purpose?: "register" | "login" | "bind" }
 * Returns: { success: true, expires_in: 600 }
 *
 * 限频：
 *   - 同一邮箱 60 秒内只能发 1 封
 *   - 同一邮箱 24 小时内最多 10 封
 *
 * 安全：不存明文，存 sha256(email||code||PEPPER)。复用 OTP_HASH_PEPPER（跟短信共享）。
 *
 * 需要 .env.production 配置：
 *   OTP_HASH_PEPPER=<跟短信共享>
 *   ALIYUN_DM_ACCESS_KEY_ID / SECRET / ACCOUNT_NAME（见 lib/email/aliyun-dm.ts）
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash, randomInt } from "crypto";
import { sendLoginEmailOtp } from "@/lib/email/aliyun-dm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = 1;
const RATE_LIMIT_PER_DAY = 10;
const OTP_TTL_SECONDS = 600; // 邮件比短信慢，给 10 分钟

function isValidEmail(email: string): boolean {
  // 简单校验，业务侧再严格
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function hashCode(email: string, code: string, pepper: string): string {
  return createHash("sha256").update(`${email}|${code}|${pepper}`).digest("hex");
}

export async function POST(req: Request) {
  let body: { email?: string; purpose?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const purpose =
    body.purpose === "register" || body.purpose === "bind" ? body.purpose : "login";

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { success: false, error: "邮箱格式不正确" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pepper = process.env.OTP_HASH_PEPPER;
  if (!supabaseUrl || !serviceKey || !pepper) {
    return NextResponse.json(
      { success: false, error: "服务端配置缺失（OTP_HASH_PEPPER 未设置）", needs_config: true },
      { status: 501 }
    );
  }

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 限频：1 分钟
  const { data: recentMinute, error: cntErr1 } = await admin.rpc("count_recent_email_otp", {
    p_email: email,
    p_minutes: 1,
  });
  if (cntErr1) {
    console.error("[send-email-otp] count(1min) fail", cntErr1);
    return NextResponse.json({ success: false, error: "限频检查失败" }, { status: 500 });
  }
  if ((recentMinute as number) >= RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json(
      { success: false, error: "60 秒内只能获取一次验证码，请稍等" },
      { status: 429 }
    );
  }

  // 限频：24 小时
  const { data: recentDay, error: cntErr2 } = await admin.rpc("count_recent_email_otp", {
    p_email: email,
    p_minutes: 60 * 24,
  });
  if (cntErr2) {
    console.error("[send-email-otp] count(1d) fail", cntErr2);
    return NextResponse.json({ success: false, error: "限频检查失败" }, { status: 500 });
  }
  if ((recentDay as number) >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json(
      { success: false, error: "今天获取验证码次数已达上限，请明天再试" },
      { status: 429 }
    );
  }

  // 生成 6 位验证码 + hash
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = hashCode(email, code, pepper);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  // 调阿里云 DirectMail
  const mailResult = await sendLoginEmailOtp(email, code);
  if (!mailResult.ok) {
    console.error("[send-email-otp] mail send fail", mailResult);
    // 区分配置缺失 vs 真实失败
    if (mailResult.message?.includes("未配置")) {
      return NextResponse.json(
        {
          success: false,
          error: "邮箱验证码功能尚未启用，请用手机号登录",
          needs_config: true,
        },
        { status: 501 }
      );
    }
    return NextResponse.json(
      { success: false, error: "邮件发送失败：" + (mailResult.message ?? "未知") },
      { status: 502 }
    );
  }

  // 入库（发送成功才入库，避免发不出去还浪费限频额度）
  const { error: insertErr } = await admin.from("email_otp_verifications").insert({
    email,
    code_hash: codeHash,
    purpose,
    expires_at: expiresAt,
  });
  if (insertErr) {
    console.error("[send-email-otp] db insert fail", insertErr);
  }

  return NextResponse.json({
    success: true,
    expires_in: OTP_TTL_SECONDS,
    env_id: mailResult.envId ?? null,
  });
}
