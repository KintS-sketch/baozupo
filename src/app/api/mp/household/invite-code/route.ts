/**
 * POST /api/mp/household/invite-code
 *
 * Owner 生成 6 位邀请码，24 小时过期。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// 6 位字母数字（避开易混 0/O/1/I/l）
function generateCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "未加入家庭组" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 校验 owner
  const { data: hh } = await admin
    .from("households")
    .select("id, owner_id")
    .eq("id", user.household_id)
    .maybeSingle();
  if (!hh || hh.owner_id !== user.id) {
    return NextResponse.json({ error: "只有房主可以生成邀请码" }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // 重试 5 次防 code 冲突
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await admin
      .from("household_invites")
      .insert({
        household_id: user.household_id,
        code,
        created_by: user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, code, expires_at")
      .single();
    if (!error && data) {
      return NextResponse.json({
        success: true,
        code: data.code,
        expires_at: data.expires_at,
      });
    }
    lastErr = error;
    if (error && (error as { code?: string }).code !== "23505") break;
  }

  return NextResponse.json(
    {
      error: "生成失败：" + ((lastErr as { message?: string })?.message ?? "未知"),
    },
    { status: 500 }
  );
}
