/**
 * POST /api/mp/invites/[id]/accept
 *
 * mp 端「邀请箱」采纳/忽略接口，等价于 PWA src/app/invites/page.tsx 里的 handleAccept / handleDismiss。
 *
 * Body:
 *   { dismiss?: boolean }
 *     - dismiss=true：只标 accepted_at，不创建租客（房东选择忽略这条提交）
 *     - 否则：从 submitted_data 创建 tenant 记录，再标 accepted_at + accepted_tenant_id
 *
 * 与 PWA 的差别：mp 端采纳后不跳 /leases?prefill_tenant=...，
 * 由 mp 客户端 toast 提示「已加入租客库，请到租约页新建租约时选 TA」。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface AcceptBody {
  dismiss?: boolean;
}

interface SubmittedData {
  name?: string;
  phone?: string;
  id_number?: string;
  wechat_id?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
  agent_name?: string;
  agent_phone?: string;
  chosen_role?: "tenant" | "agent";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "未加入任何家庭组" }, { status: 400 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "邀请 id 缺失" }, { status: 400 });

  let body: AcceptBody = {};
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    // body 可选
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 拉这条邀请并校验归属
  const { data: invite, error: fetchErr } = await admin
    .from("form_invites")
    .select("id, household_id, submitted_data, submitted_at, accepted_at, purpose")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !invite) {
    return NextResponse.json({ error: "邀请不存在" }, { status: 404 });
  }
  if (invite.household_id !== user.household_id) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "该邀请已处理过" }, { status: 409 });
  }

  // 忽略：只标 accepted_at（让链接失效，不建租客）
  if (body.dismiss) {
    const { error: updErr } = await admin
      .from("form_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) {
      return NextResponse.json(
        { error: "忽略失败：" + updErr.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, dismissed: true });
  }

  // 采纳：建 tenant + 标记
  if (!invite.submitted_at || !invite.submitted_data) {
    return NextResponse.json(
      { error: "对方还没提交，无法采纳" },
      { status: 400 }
    );
  }

  const s = invite.submitted_data as SubmittedData;
  if (!s.name || !s.phone) {
    return NextResponse.json({ error: "提交数据不完整" }, { status: 400 });
  }

  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({
      household_id: user.household_id,
      name: s.name,
      phone: s.phone,
      id_type: "id_card",
      id_number: s.id_number ?? null,
      wechat_id: s.wechat_id ?? null,
      emergency_contact_name: s.emergency_contact_name ?? null,
      emergency_contact_phone: s.emergency_contact_phone ?? null,
      notes: s.notes ?? null,
    })
    .select("id, name")
    .single();

  if (tErr || !tenant) {
    return NextResponse.json(
      { error: "创建租客失败：" + (tErr?.message ?? "未知") },
      { status: 500 }
    );
  }

  const { error: updErr } = await admin
    .from("form_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_tenant_id: tenant.id,
    })
    .eq("id", id);

  if (updErr) {
    // tenant 已建好，invite 标记失败只 warn，不回滚
    console.warn("[invites/accept] tenant 建好但 invite 标记失败", updErr);
  }

  const isAgent =
    s.chosen_role === "agent" || invite.purpose === "agent_register";

  return NextResponse.json({
    success: true,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    rental_source: isAgent ? "agent" : "direct",
    agent_name: isAgent ? s.agent_name ?? null : null,
    agent_phone: isAgent ? s.agent_phone ?? null : null,
  });
}
