import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

/** 12 字符 base32-ish 短码：URL 友好 + 不易冲突（avoiding易混字符 0/O/1/I/l） */
function generateToken(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

interface CreateInviteBody {
  purpose?: "tenant_register" | "agent_register";
  prefilled_data?: Record<string, unknown> | null;
  expires_in_days?: number;
}

export async function POST(req: Request) {
  const supabase = await createClient();

  // 必须登录
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 取 household_id
  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member?.household_id) {
    return NextResponse.json({ error: "未加入任何家庭组" }, { status: 400 });
  }

  let body: CreateInviteBody = {};
  try {
    body = (await req.json()) as CreateInviteBody;
  } catch {
    // body 可选，忽略解析失败
  }

  const expiresInDays = Math.min(Math.max(body.expires_in_days ?? 7, 1), 30);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  // 重试 5 次防 token 冲突（概率极低，但保险）
  let token = "";
  let lastError: unknown = null;
  for (let i = 0; i < 5; i++) {
    token = generateToken();
    const { data, error } = await supabase
      .from("form_invites")
      .insert({
        household_id: member.household_id,
        created_by: user.id,
        token,
        purpose: body.purpose ?? "tenant_register",
        prefilled_data: body.prefilled_data ?? null,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, token, expires_at")
      .single();

    if (!error && data) {
      return NextResponse.json({
        success: true,
        token: data.token,
        expires_at: data.expires_at,
      });
    }
    lastError = error;
    // 23505 = unique_violation
    if (error && (error as { code?: string }).code !== "23505") break;
  }

  return NextResponse.json(
    { error: "创建邀请失败：" + ((lastError as { message?: string })?.message ?? "未知") },
    { status: 500 }
  );
}
