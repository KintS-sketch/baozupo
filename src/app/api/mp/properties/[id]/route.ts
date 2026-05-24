/**
 * GET /api/mp/properties/[id]
 *
 * 单个房源详情。1:1 复刻 PWA src/app/properties/[id]/page.tsx 的数据需求：
 *  - 基本信息（name/address/city/district/layout/area/notes/status）
 *  - 当前 active 租约（含主租客）
 *  - 抄表记录（最近 5 条）
 *  - 当期账单（period 含今天 OR 已过期未付清）
 *
 * 认证：Bearer
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: property, error: pErr } = await admin
      .from("properties")
      .select("*")
      .eq("id", id)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!property) {
      return NextResponse.json({ error: "房源不存在或不属于你" }, { status: 404 });
    }

    const [{ data: leases }, { data: meterReadings }, { data: bills }] =
      await Promise.all([
        admin
          .from("leases")
          .select(
            "id, start_date, end_date, monthly_rent, status, lease_tenants(is_primary, tenant:tenants(name, phone))"
          )
          .eq("property_id", id)
          .is("deleted_at", null)
          .order("start_date", { ascending: false }),
        admin
          .from("meter_readings")
          .select(
            "id, type, reading_date, value, previous_value, usage, amount, unit_price, notes"
          )
          .eq("property_id", id)
          .order("reading_date", { ascending: false })
          .limit(10),
        admin
          .from("bills")
          .select("id, lease_id, period_start, period_end, due_date, total_amount, paid_amount, status")
          .in(
            "lease_id",
            (
              await admin.from("leases").select("id").eq("property_id", id).is("deleted_at", null)
            ).data?.map((l: { id: string }) => l.id) ?? []
          )
          .order("due_date", { ascending: false })
          .limit(100),
      ]);

    const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
      !v ? [] : Array.isArray(v) ? v : [v];

    // 找当前 active 租约（取第一条，按 start_date desc 排好序）
    type TenantLite = { name: string; phone: string };
    type LeaseRow = {
      id: string;
      start_date: string;
      end_date: string;
      monthly_rent: number;
      status: string;
      lease_tenants?: { is_primary: boolean; tenant: TenantLite | TenantLite[] | null }[];
    };
    const leaseList = (leases ?? []) as unknown as LeaseRow[];
    const activeRow = leaseList.find((l) => l.status === "active");
    const formatTenant = (l: LeaseRow): { name: string; phone: string } | null => {
      const lts = l.lease_tenants ?? [];
      const t =
        lts.filter((lt) => lt.is_primary).flatMap((lt) => asArr(lt.tenant))[0] ??
        lts.flatMap((lt) => asArr(lt.tenant))[0] ??
        null;
      return t ?? null;
    };
    const activeLease = activeRow
      ? {
          id: activeRow.id,
          start_date: activeRow.start_date,
          end_date: activeRow.end_date,
          monthly_rent: Number(activeRow.monthly_rent),
          status: activeRow.status,
          primary_tenant: formatTenant(activeRow),
        }
      : null;

    // 当期账单 filter（跟 dashboard 一致）
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    type Bill = {
      id: string;
      lease_id: string;
      period_start: string;
      period_end: string;
      due_date: string;
      total_amount: number | string;
      paid_amount: number | string;
      status: string;
    };
    const allBills: Bill[] = (bills ?? []) as Bill[];
    const currentBills = allBills.filter((b) => {
      const start = new Date(b.period_start);
      const end = new Date(b.period_end);
      if (todayDate >= start && todayDate <= end) return true;
      if (todayDate > end && b.status !== "paid") return true;
      return false;
    });

    return NextResponse.json({
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        district: property.district,
        city: property.city,
        layout: property.layout,
        area: property.area,
        status: property.status,
        notes: property.notes,
      },
      active_lease: activeLease,
      lease_count: leaseList.length,
      meter_readings: (meterReadings ?? []).slice(0, 5).map((r: { value: number | string; previous_value?: number | string | null; usage?: number | string | null; amount?: number | string | null; unit_price?: number | string | null } & Record<string, unknown>) => ({
        ...r,
        value: Number(r.value),
        previous_value: r.previous_value != null ? Number(r.previous_value) : null,
        usage: r.usage != null ? Number(r.usage) : null,
        amount: r.amount != null ? Number(r.amount) : null,
        unit_price: r.unit_price != null ? Number(r.unit_price) : null,
      })),
      current_bills: currentBills.map((b) => ({
        ...b,
        total_amount: Number(b.total_amount),
        paid_amount: Number(b.paid_amount),
      })),
      total_bills: allBills.length,
    });
  } catch (err) {
    console.error("[api/mp/properties/[id]] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
