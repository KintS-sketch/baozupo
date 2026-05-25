/**
 * POST /api/mp/leases/save
 *
 * 新增 / 编辑租约。完整复刻 PWA src/app/leases/page.tsx handleSubmit：
 *   1. 校验字段（property/dates/rent/cycle/mode/due_day/source/agent）
 *   2. 新增模式：
 *      a. 若 tenant_mode=new → 先 insert tenants 表
 *      b. insert leases
 *      c. insert lease_tenants（关联主租客）
 *      d. update properties.status = 'rented'
 *      e. 若 generate_bills → 用 generateBillPeriods 生成 bills
 *   3. 编辑模式：
 *      a. update leases
 *      b. 若主租客换了，重建 lease_tenants
 *      c. 若 billing 字段变了：
 *         · 已有账单收过钱 → 不动账单，返回提示
 *         · 没收过钱 → 删旧账单，按新参数重新生成
 *
 * 不支持的（mp 端 v1 跳过）：合同附件上传、AI 拍身份证（PWA 那边 LeaseForm 处理）
 *
 * Body: { id?, property_id, start_date, end_date, monthly_rent, deposit,
 *         payment_cycle, billing_mode, rent_due_day, rental_source,
 *         agent_name?, agent_phone?, agent_fee?, notes?,
 *         tenant_mode: 'existing' | 'new',
 *         tenant_id?,                          // existing 必填
 *         new_tenant?: {...},                  // new 必填
 *         generate_bills?: boolean }           // 默认 true（仅新增）
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";
import { generateBillPeriods, calculateBillStatus } from "@/lib/billing";

export const dynamic = "force-dynamic";

interface NewTenantPayload {
  name: string;
  phone: string;
  id_number: string;
  wechat_id?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  /** 身份证图片在 contracts bucket 内的相对路径（mp 端 scanIdCard 上传后取得） */
  id_card_image_url?: string | null;
}

interface SaveBody {
  id?: string;
  property_id?: string;
  start_date?: string;
  end_date?: string;
  monthly_rent?: number | string;
  deposit?: number | string;
  payment_cycle?: "monthly" | "quarterly" | "biannual" | "annual";
  billing_mode?: "natural_month" | "rolling_month";
  rent_due_day?: number | string;
  rental_source?: "direct" | "agent";
  agent_name?: string | null;
  agent_phone?: string | null;
  agent_fee?: number | string | null;
  notes?: string | null;
  tenant_mode?: "existing" | "new";
  tenant_id?: string;
  new_tenant?: NewTenantPayload;
  generate_bills?: boolean;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const ID_CARD_RE = /^\d{17}[\dXx]$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }

  // === 基础字段校验 ===
  const property_id = body.property_id;
  if (!property_id) return NextResponse.json({ error: "请选择房源" }, { status: 400 });
  const start_date = body.start_date;
  const end_date = body.end_date;
  if (!start_date) return NextResponse.json({ error: "请选择起租日期" }, { status: 400 });
  if (!end_date) return NextResponse.json({ error: "请选择结束日期" }, { status: 400 });
  if (new Date(end_date) <= new Date(start_date)) {
    return NextResponse.json({ error: "结束日期必须晚于起租日期" }, { status: 400 });
  }
  const monthly_rent = Number(body.monthly_rent);
  if (!monthly_rent || monthly_rent <= 0) {
    return NextResponse.json({ error: "月租金必须大于 0" }, { status: 400 });
  }
  const deposit = Number(body.deposit ?? 0);
  if (deposit < 0) return NextResponse.json({ error: "押金不能为负数" }, { status: 400 });
  const payment_cycle = body.payment_cycle ?? "monthly";
  if (!["monthly", "quarterly", "biannual", "annual"].includes(payment_cycle)) {
    return NextResponse.json({ error: "付款周期不合法" }, { status: 400 });
  }
  const billing_mode = body.billing_mode ?? "natural_month";
  if (!["natural_month", "rolling_month"].includes(billing_mode)) {
    return NextResponse.json({ error: "账单模式不合法" }, { status: 400 });
  }
  const rent_due_day = Number(body.rent_due_day ?? 1);
  if (rent_due_day < 1 || rent_due_day > 31) {
    return NextResponse.json({ error: "收租日必须在 1-31 之间" }, { status: 400 });
  }
  const rental_source = body.rental_source ?? "direct";
  if (!["direct", "agent"].includes(rental_source)) {
    return NextResponse.json({ error: "租约来源不合法" }, { status: 400 });
  }

  // 中介模式校验
  let agent_name: string | null = null;
  let agent_phone: string | null = null;
  let agent_fee: number | null = null;
  if (rental_source === "agent") {
    agent_name = (body.agent_name ?? "").trim() || null;
    if (!agent_name) return NextResponse.json({ error: "请填写中介姓名" }, { status: 400 });
    agent_phone = (body.agent_phone ?? "").trim() || null;
    if (agent_phone && !PHONE_RE.test(agent_phone)) {
      return NextResponse.json({ error: "请输入正确的中介手机号" }, { status: 400 });
    }
    if (body.agent_fee != null && body.agent_fee !== "") {
      const f = Number(body.agent_fee);
      if (Number.isNaN(f) || f < 0) {
        return NextResponse.json({ error: "中介费不能为负数" }, { status: 400 });
      }
      agent_fee = f;
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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
      return NextResponse.json({ error: "房源不存在或不属于你" }, { status: 404 });
    }

    const leasePayload = {
      household_id: user.household_id,
      property_id,
      start_date,
      end_date,
      monthly_rent,
      deposit,
      payment_cycle,
      billing_mode,
      rent_due_day,
      rental_source,
      agent_name,
      agent_phone,
      agent_fee,
      notes: (body.notes ?? "").trim() || null,
    };

    // ============================================================
    // 编辑模式
    // ============================================================
    if (body.id) {
      const { data: existing } = await admin
        .from("leases")
        .select(
          "id, start_date, end_date, monthly_rent, billing_mode, rent_due_day, lease_tenants(is_primary, tenant_id)"
        )
        .eq("id", body.id)
        .eq("household_id", user.household_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json({ error: "租约不存在或不属于你" }, { status: 404 });
      }

      const billingChanged =
        (existing as { start_date: string }).start_date !== start_date ||
        (existing as { end_date: string }).end_date !== end_date ||
        Number((existing as { monthly_rent: number }).monthly_rent) !== monthly_rent ||
        (existing as { billing_mode: string }).billing_mode !== billing_mode ||
        Number((existing as { rent_due_day: number }).rent_due_day) !== rent_due_day;

      const { error: updErr } = await admin.from("leases").update(leasePayload).eq("id", body.id);
      if (updErr) throw updErr;

      // 主租客切换
      if (body.tenant_mode === "existing" && body.tenant_id) {
        const lts = (
          existing as {
            lease_tenants?: { is_primary: boolean; tenant_id: string }[];
          }
        ).lease_tenants;
        const currentPrimary = lts?.find((lt) => lt.is_primary)?.tenant_id;
        if (currentPrimary !== body.tenant_id) {
          await admin.from("lease_tenants").delete().eq("lease_id", body.id);
          await admin.from("lease_tenants").insert({
            lease_id: body.id,
            tenant_id: body.tenant_id,
            is_primary: true,
          });
        }
      }

      // 账单重算
      let rebuiltCount = 0;
      let billingWarn: string | null = null;
      if (billingChanged) {
        const { data: oldBills } = await admin
          .from("bills")
          .select("id, paid_amount")
          .eq("lease_id", body.id);
        const hasPaid = (oldBills ?? []).some(
          (b: { paid_amount: number | string }) => Number(b.paid_amount ?? 0) > 0
        );
        if (hasPaid) {
          billingWarn = "租期/租金已改，但已有账单收过款，账单未自动重算，请手动核对";
        } else {
          if (oldBills && oldBills.length > 0) {
            await admin.from("bills").delete().eq("lease_id", body.id);
          }
          const periods = generateBillPeriods(
            new Date(start_date),
            new Date(end_date),
            monthly_rent,
            billing_mode,
            rent_due_day,
            payment_cycle
          );
          const today = new Date();
          const billRows = periods.map((p) => ({
            lease_id: body.id,
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
          if (billsErr) throw billsErr;
          rebuiltCount = billRows.length;
        }
      }

      return NextResponse.json({
        success: true,
        id: body.id,
        mode: "update",
        rebuilt_bills: rebuiltCount,
        warning: billingWarn,
      });
    }

    // ============================================================
    // 新增模式
    // ============================================================
    let tenant_id = body.tenant_id ?? "";

    if (body.tenant_mode === "new") {
      if (!body.new_tenant) {
        return NextResponse.json({ error: "缺少新租客信息" }, { status: 400 });
      }
      const t = body.new_tenant;
      const tName = (t.name ?? "").trim();
      const tPhone = (t.phone ?? "").trim();
      const tIdNumber = (t.id_number ?? "").trim();
      if (!tName) return NextResponse.json({ error: "请填写租客姓名" }, { status: 400 });
      if (!tPhone || !PHONE_RE.test(tPhone)) {
        return NextResponse.json(
          { error: "请输入正确的 11 位中国大陆手机号" },
          { status: 400 }
        );
      }
      if (!tIdNumber || !ID_CARD_RE.test(tIdNumber)) {
        return NextResponse.json(
          { error: "请输入完整的 18 位身份证号" },
          { status: 400 }
        );
      }
      const { data: newTenant, error: tErr } = await admin
        .from("tenants")
        .insert({
          household_id: user.household_id,
          name: tName,
          phone: tPhone,
          id_type: "id_card",
          id_number: tIdNumber,
          wechat_id: (t.wechat_id ?? "").trim() || null,
          emergency_contact_name:
            (t.emergency_contact_name ?? "").trim() || null,
          emergency_contact_phone:
            (t.emergency_contact_phone ?? "").trim() || null,
          id_card_image_url: (t.id_card_image_url ?? "")?.toString().trim() || null,
        })
        .select("id")
        .single();
      if (tErr || !newTenant) {
        return NextResponse.json(
          { error: "创建租客失败：" + (tErr?.message ?? "未知") },
          { status: 500 }
        );
      }
      tenant_id = newTenant.id;
    }

    if (!tenant_id) {
      return NextResponse.json({ error: "请选择或填写主租客" }, { status: 400 });
    }

    const { data: newLease, error: lErr } = await admin
      .from("leases")
      .insert({ ...leasePayload, status: "active" })
      .select("id")
      .single();
    if (lErr || !newLease) {
      return NextResponse.json(
        { error: "创建租约失败：" + (lErr?.message ?? "未知") },
        { status: 500 }
      );
    }

    await admin.from("lease_tenants").insert({
      lease_id: newLease.id,
      tenant_id,
      is_primary: true,
    });
    await admin.from("properties").update({ status: "rented" }).eq("id", property_id);

    // 生成账单
    let billCount = 0;
    if (body.generate_bills !== false) {
      const periods = generateBillPeriods(
        new Date(start_date),
        new Date(end_date),
        monthly_rent,
        billing_mode,
        rent_due_day,
        payment_cycle
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
      if (billsErr) {
        console.error("[api/mp/leases/save] bills insert fail", billsErr);
      } else {
        billCount = billRows.length;
      }

      // 押金单独一张账单（#5 反馈）
      if (deposit > 0) {
        const { error: depErr } = await admin.from("bills").insert({
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
          notes: "押金（创建租约时自动生成）",
        });
        if (depErr) {
          console.error("[api/mp/leases/save] deposit bill insert fail", depErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      id: newLease.id,
      mode: "create",
      bills_generated: billCount,
    });
  } catch (err) {
    console.error("[api/mp/leases/save] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}
