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
import { generateBillPeriods, calculateBillStatus } from "@/lib/billing";

export const dynamic = "force-dynamic";

interface AcceptBody {
  /** 仅标记 accepted_at 不建租客 */
  dismiss?: boolean;
  /** 已采纳过也允许重新执行（生成新 tenant + 新租约） */
  reaccept?: boolean;
  /** 同时创建租约（无需房东再去租约页确认） */
  create_lease?: boolean;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
  // 租约信息（租客在邀请页填的，采纳后回传给前端预填新建租约）
  start_date?: string;
  duration_months?: number;
  monthly_rent?: number;
  deposit?: number;
  payment_cycle?: "monthly" | "quarterly" | "semiannual" | "annual";
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

  // 拉这条邀请并校验归属（顺带把 prefilled_data 也拿出来给 create_lease 用）
  const { data: invite, error: fetchErr } = await admin
    .from("form_invites")
    .select("id, household_id, submitted_data, submitted_at, accepted_at, purpose, prefilled_data")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !invite) {
    return NextResponse.json({ error: "邀请不存在" }, { status: 404 });
  }
  if (invite.household_id !== user.household_id) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }
  // 已经处理过的，只有 reaccept=true 才允许继续（再次采纳走相同逻辑生成新 tenant）
  if (invite.accepted_at && !body.reaccept) {
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

  // 租约预填字段（如果租客填了租约信息，回给前端用于预填新建租约弹窗）
  const lease_prefill =
    s.start_date && s.monthly_rent != null
      ? {
          start_date: s.start_date,
          duration_months: s.duration_months ?? 12,
          monthly_rent: s.monthly_rent,
          deposit: s.deposit ?? 0,
          payment_cycle: s.payment_cycle ?? "monthly",
        }
      : null;

  // ============================================================
  // create_lease=true：直接同步建租约 + 自动生成账单
  // 用 prefilled_data 拿房源/账单参数 + submitted_data 拿日期/租金
  // ============================================================
  let createdLeaseId: string | null = null;
  let createdLeaseError: string | null = null;
  let billsGenerated = 0;

  if (body.create_lease) {
    const pf = (invite.prefilled_data as Record<string, unknown> | null) ?? {};

    const property_id = (pf.property_id as string) || null;
    const start_date = (s.start_date as string) || (pf.start_date as string) || null;
    const monthly_rent = Number(
      s.monthly_rent ?? (pf.monthly_rent as number | undefined) ?? 0
    );
    const deposit = Number(
      s.deposit ?? (pf.deposit as number | undefined) ?? 0
    );
    const payment_cycle = (s.payment_cycle ??
      (pf.payment_cycle as string | undefined) ??
      "monthly") as "monthly" | "quarterly" | "biannual" | "annual";
    const billing_mode = ((pf.billing_mode as string | undefined) ?? "natural_month") as
      | "natural_month"
      | "rolling_month";
    const rent_due_day = Number(pf.rent_due_day ?? 1);
    const durationMonths = Number(s.duration_months ?? 12) || 12;
    const rental_source = isAgent ? "agent" : "direct";

    // end_date 优先用 prefilled，否则按 duration_months 算
    let end_date = (pf.end_date as string) || "";
    if (!end_date && start_date) {
      const start = new Date(start_date);
      const e = new Date(
        start.getFullYear(),
        start.getMonth() + durationMonths,
        start.getDate() - 1
      );
      if (!Number.isNaN(e.getTime())) end_date = toDateString(e);
    }

    // 把 cycle 名字归一化（accept 接口允许 semiannual 别名，租约表统一用 biannual）
    const cycleMap: Record<string, "monthly" | "quarterly" | "biannual" | "annual"> = {
      monthly: "monthly",
      quarterly: "quarterly",
      biannual: "biannual",
      semiannual: "biannual",
      annual: "annual",
    };
    const normalizedCycle = cycleMap[payment_cycle] ?? "monthly";

    if (!property_id) {
      createdLeaseError = "未指定房源，请到租约页手动建租约";
    } else if (!start_date || !end_date || !monthly_rent) {
      createdLeaseError = "起租日 / 结束日 / 月租金 不完整";
    } else {
      try {
        // 校验房源归属
        const { data: prop } = await admin
          .from("properties")
          .select("id")
          .eq("id", property_id)
          .eq("household_id", user.household_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!prop) {
          createdLeaseError = "房源不存在或不属于你";
        } else {
          const { data: newLease, error: lErr } = await admin
            .from("leases")
            .insert({
              household_id: user.household_id,
              property_id,
              start_date,
              end_date,
              monthly_rent,
              deposit,
              payment_cycle: normalizedCycle,
              billing_mode,
              rent_due_day,
              rental_source,
              agent_name: isAgent ? s.agent_name ?? null : null,
              agent_phone: isAgent ? s.agent_phone ?? null : null,
              notes: (s.notes ?? null) as string | null,
              status: "active",
            })
            .select("id")
            .single();

          if (lErr || !newLease) {
            createdLeaseError = "创建租约失败：" + (lErr?.message ?? "未知");
          } else {
            createdLeaseId = newLease.id;

            await admin.from("lease_tenants").insert({
              lease_id: newLease.id,
              tenant_id: tenant.id,
              is_primary: true,
            });
            await admin
              .from("properties")
              .update({ status: "rented" })
              .eq("id", property_id);

            // 生成账单
            try {
              const periods = generateBillPeriods(
                new Date(start_date),
                new Date(end_date),
                monthly_rent,
                billing_mode,
                rent_due_day,
                normalizedCycle
              );
              const today = new Date();
              const billRows = periods.map((p) => ({
                lease_id: newLease.id,
                period_start: toDateString(p.periodStart),
                period_end: toDateString(p.periodEnd),
                days_in_period: p.daysInPeriod,
                ratio: p.ratio,
                due_date: toDateString(p.dueDate),
                rent_amount: p.rentAmount,
                utility_amount: 0,
                other_amount: 0,
                total_amount: p.rentAmount,
                paid_amount: 0,
                status: calculateBillStatus(p.rentAmount, 0, p.dueDate, today),
              }));
              const { error: billsErr } = await admin.from("bills").insert(billRows);
              if (!billsErr) {
                billsGenerated = billRows.length;
              } else {
                console.error("[invites/accept] bills insert fail", billsErr);
              }

              // 押金账单
              if (deposit > 0) {
                await admin.from("bills").insert({
                  lease_id: newLease.id,
                  period_start: start_date,
                  period_end: start_date,
                  days_in_period: 0,
                  ratio: 0,
                  due_date: start_date,
                  rent_amount: 0,
                  utility_amount: 0,
                  other_amount: deposit,
                  total_amount: deposit,
                  paid_amount: 0,
                  status: calculateBillStatus(deposit, 0, new Date(start_date), today),
                  bill_type: "deposit",
                  notes: "押金（采纳邀请时自动生成）",
                });
              }
            } catch (billsErr) {
              console.error("[invites/accept] generate bills throw", billsErr);
            }
          }
        }
      } catch (err) {
        console.error("[invites/accept] create_lease throw", err);
        createdLeaseError = err instanceof Error ? err.message : "建租约失败";
      }
    }
  }

  return NextResponse.json({
    success: true,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    rental_source: isAgent ? "agent" : "direct",
    agent_name: isAgent ? s.agent_name ?? null : null,
    agent_phone: isAgent ? s.agent_phone ?? null : null,
    lease_prefill,
    // 若 create_lease=true 同步建了租约
    lease_id: createdLeaseId,
    lease_error: createdLeaseError,
    bills_generated: billsGenerated,
  });
}
