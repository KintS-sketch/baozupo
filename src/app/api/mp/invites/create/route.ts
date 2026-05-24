/**
 * POST /api/mp/invites/create
 *
 * mp 端用的「邀请租客/中介填表」端点。
 * 等价于 PWA src/app/api/invites/create/route.ts，区别是用 Bearer auth 而非 cookie。
 *
 * Body: { purpose?: 'tenant_register' | 'agent_register', prefilled_data?, expires_in_days? }
 * Returns: { success, token, expires_at, share_url }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const BASE_URL = "https://tendapp.cn";

// URL 友好 + 不易混（避开 0/O/1/I/l）
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

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "未加入任何家庭组" }, { status: 400 });

  let body: CreateInviteBody = {};
  try {
    body = (await req.json()) as CreateInviteBody;
  } catch {
    // body 可选
  }

  const expiresInDays = Math.min(Math.max(body.expires_in_days ?? 7, 1), 30);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 重试 5 次防 token 冲突
  let lastError: unknown = null;
  for (let i = 0; i < 5; i++) {
    const token = generateToken();
    const { data, error } = await admin
      .from("form_invites")
      .insert({
        household_id: user.household_id,
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
        share_url: `${BASE_URL}/invite/${data.token}`,
      });
    }
    lastError = error;
    if (error && (error as { code?: string }).code !== "23505") break;
  }

  return NextResponse.json(
    {
      error: "创建邀请失败：" + ((lastError as { message?: string })?.message ?? "未知"),
    },
    { status: 500 }
  );
}
