import { NextResponse } from "next/server";
import { getAnonClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/refresh
 *
 * 用 refresh_token 换新的 access_token。
 * 客户端发现 access_token 过期时（401 + token_expired）调这个 API。
 */
export async function POST(req: Request) {
  let body: { refresh_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }

  const refresh_token = body.refresh_token;
  if (!refresh_token) {
    return NextResponse.json(
      { success: false, error: "缺少 refresh_token" },
      { status: 400 }
    );
  }

  const supabase = getAnonClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error || !data.session) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "刷新失败" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
}
