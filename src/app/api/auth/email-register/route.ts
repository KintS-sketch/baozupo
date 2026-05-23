import { NextResponse } from "next/server";
import { getAnonClient } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * POST /api/auth/email-register
 *
 * 邮箱注册（小程序端用）。注册成功后自动登录返回 access_token。
 * 如果 Supabase 开启了邮箱确认，会返回 needs_email_confirmation = true。
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: "请填写邮箱和密码" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { success: false, error: "密码至少需要 6 位" },
      { status: 400 }
    );
  }

  const supabase = getAnonClient();
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
  });
  if (signUpErr) {
    const msg = signUpErr.message.includes("User already registered")
      ? "该邮箱已注册，请直接登录"
      : signUpErr.message;
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }

  // 尝试自动登录
  const { data: loginData } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (!loginData?.session) {
    return NextResponse.json({
      success: true,
      needs_email_confirmation: true,
      message: "注册成功！请到邮箱完成验证后回来登录",
    });
  }

  const admin = createServiceClient();
  const { data: member } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", loginData.user!.id)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    access_token: loginData.session.access_token,
    refresh_token: loginData.session.refresh_token,
    expires_at: loginData.session.expires_at,
    user: {
      id: loginData.user!.id,
      email: loginData.user!.email,
      phone: loginData.user!.phone,
    },
    household_id: member?.household_id ?? null,
    signup_user_id: signUpData.user?.id ?? null,
  });
}
