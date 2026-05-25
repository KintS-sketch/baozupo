/**
 * POST /api/auth/send-sms-otp
 *
 * 给用户的手机号发 6 位数字验证码。
 *
 * Body: { phone: string, purpose?: "register" | "login" | "bind" }
 * Returns: { success: true, expires_in: 300 }
 *
 * 限频：
 *   - 同一手机号 60 秒内只能发 1 条
 *   - 同一手机号 24 小时内最多 5 条
 *
 * 安全：
 *   - 不暴露用户是否存在（register/login 都不返回 user_exists 标志）
 *   - 验证码不存明文，只存 sha256(phone || code || PEPPER)
 *   - PEPPER = OTP_HASH_PEPPER 环境变量（不公开）
 *
 * 需要 .env.production 配置：
 *   ALIYUN_SMS_TEMPLATE_LOGIN_OTP=SMS_506955201
 *   OTP_HASH_PEPPER=<32 字节随机串>
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash, randomInt } from "crypto";
import { sendLoginOtpSms } from "@/lib/econtract/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = 1;
const RATE_LIMIT_PER_DAY = 5;
const OTP_TTL_SECONDS = 300;

// 国大陆 11 位手机号
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

function hashCode(phone: string, code: string, pepper: string): string {
  return createHash("sha256").update(`${phone}|${code}|${pepper}`).digest("hex");
}

export async function POST(req: Request) {
  let body: { phone?: string; purpose?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const purpose = body.purpose === "register" || body.purpose === "bind" ? body.purpose : "login";

  if (!isValidPhone(phone)) {
    return NextResponse.json(
      { success: false, error: "手机号格式不正确" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pepper = process.env.OTP_HASH_PEPPER;
  if (!supabaseUrl || !serviceKey || !pepper) {
    console.error("[send-sms-otp] missing env", {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!serviceKey,
      hasPepper: !!pepper,
    });
    return NextResponse.json(
      { success: false, error: "服务端配置缺失（OTP_HASH_PEPPER 未设置）", needs_config: true },
      { status: 501 }
    );
  }

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 限频：1 分钟内
  const { data: recentMinute, error: cntErr1 } = await admin.rpc("count_recent_otp", {
    p_phone: phone,
    p_minutes: 1,
  });
  if (cntErr1) {
    console.error("[send-sms-otp] count_recent_otp(1min) fail", cntErr1);
    return NextResponse.json({ success: false, error: "限频检查失败" }, { status: 500 });
  }
  if ((recentMinute as number) >= RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json(
      { success: false, error: "60 秒内只能获取一次验证码，请稍等" },
      { status: 429 }
    );
  }

  // 限频：24 小时
  const { data: recentDay, error: cntErr2 } = await admin.rpc("count_recent_otp", {
    p_phone: phone,
    p_minutes: 60 * 24,
  });
  if (cntErr2) {
    console.error("[send-sms-otp] count_recent_otp(1d) fail", cntErr2);
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
  const codeHash = hashCode(phone, code, pepper);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  // 调阿里云发短信
  const smsResult = await sendLoginOtpSms(phone, code);
  if (!smsResult.ok) {
    console.error("[send-sms-otp] sms send fail", smsResult);
    return NextResponse.json(
      {
        success: false,
        error: "短信发送失败：" + (smsResult.message ?? "未知"),
      },
      { status: 502 }
    );
  }

  // 入库（发送成功后才入库，避免发不出去还浪费限频额度）
  const { error: insertErr } = await admin
    .from("sms_otp_verifications")
    .insert({
      phone,
      code_hash: codeHash,
      purpose,
      expires_at: expiresAt,
    });
  if (insertErr) {
    console.error("[send-sms-otp] db insert fail", insertErr);
    // 短信已发出，让用户继续，但记录异常
  }

  return NextResponse.json({
    success: true,
    expires_in: OTP_TTL_SECONDS,
    biz_id: smsResult.bizId ?? null,
  });
}
