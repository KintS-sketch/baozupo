import { NextResponse } from "next/server";
import { getAnonClient } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { getPrimaryHouseholdId } from "@/lib/get-primary-household";

export const runtime = "nodejs";

/**
 * POST /api/auth/email-login
 *
 * 邮箱密码登录（小程序 baozupo-mp 端用）。
 * 返回 Supabase 颁发的 access_token + refresh_token，
 * 客户端存进 storage，后续请求带 Authorization: Bearer <access_token>。
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
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    const msg = error.message.includes("Invalid login credentials")
      ? "邮箱或密码错误"
      : error.message;
    return NextResponse.json({ success: false, error: msg }, { status: 401 });
  }
  if (!data.session || !data.user) {
    return NextResponse.json(
      { success: false, error: "登录失败：未返回 session" },
      { status: 500 }
    );
  }

  // 查 household_id（service_role 绕开 RLS）
  const admin = createServiceClient();
  const household_id = await getPrimaryHouseholdId(admin, data.user.id);

  return NextResponse.json({
    success: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id: data.user.id,
      email: data.user.email,
      phone: data.user.phone,
    },
    household_id,
  });
}
