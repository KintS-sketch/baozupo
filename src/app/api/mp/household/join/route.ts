/**
 * POST /api/mp/household/join
 *
 * 用 6 位邀请码加入别人的家庭组。
 * Body: { code: string }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface JoinBody {
  code?: string;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: JoinBody;
  try {
    body = (await req.json()) as JoinBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const code = (body.code ?? "").trim().toUpperCase();
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: "请输入 6 位邀请码" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 找邀请码
  const { data: invite } = await admin
    .from("household_invites")
    .select("id, household_id, used_at, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: "邀请码无效" }, { status: 404 });
  if (invite.used_at) return NextResponse.json({ error: "邀请码已被使用" }, { status: 410 });
  if (new Date(invite.expires_at) < new Date())
    return NextResponse.json({ error: "邀请码已过期" }, { status: 410 });

  // 校验：用户当前不在这个 household
  const { data: existing } = await admin
    .from("household_members")
    .select("id")
    .eq("household_id", invite.household_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "你已经是该家庭组的成员" }, { status: 409 });
  }

  // 检查用户是否已经是别的 household 的成员（每个用户当前只能在一个 household）
  // 用 limit(1) 而不是 maybeSingle（多行会报 JSON 错）
  const { data: anyMembers } = await admin
    .from("household_members")
    .select("id, household_id")
    .eq("user_id", user.id)
    .limit(1);
  const anyMember = anyMembers && anyMembers.length > 0 ? anyMembers[0] : null;
  if (anyMember) {
    return NextResponse.json(
      { error: "你当前已在其他家庭组，无法加入新组（请先在网页版退出当前组）" },
      { status: 409 }
    );
  }

  // 加入 household
  const { error: insErr } = await admin.from("household_members").insert({
    household_id: invite.household_id,
    user_id: user.id,
    role: "member",
  });
  if (insErr) {
    return NextResponse.json(
      { error: "加入失败：" + insErr.message },
      { status: 500 }
    );
  }

  // 标记邀请码已用
  await admin
    .from("household_invites")
    .update({ used_at: new Date().toISOString(), used_by: user.id })
    .eq("id", invite.id);

  return NextResponse.json({
    success: true,
    household_id: invite.household_id,
  });
}
