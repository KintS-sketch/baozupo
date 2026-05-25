/**
 * GET /api/mp/tax?year=YYYY
 *
 * 年度租金汇总（个税助手）。
 *
 * 返回：
 *   year, available_years
 *   累计已收 = SUM(payments.amount WHERE paid_at IN year)
 *   年度预计 = SUM(每个租约在该年的活跃月数 × monthly_rent)
 *   房源数 / 租客数（活跃）
 *   monthly[12]：每月已收金额
 *   by_property[]：每个房源的已收+预计
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({
      year: new Date().getFullYear(),
      available_years: [new Date().getFullYear()],
      received_total: 0,
      projected_total: 0,
      property_count: 0,
      tenant_count: 0,
      monthly: Array(12).fill(0),
      by_property: [],
    });
  }

  const yearStr = req.nextUrl.searchParams.get("year");
  const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
  if (!year || year < 2000 || year > 2100)
    return NextResponse.json({ error: "year 参数无效" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 拉 leases + properties + bills + payments
  const { data: leases } = await admin
    .from("leases")
    .select(
      "id, property_id, start_date, end_date, monthly_rent, status, deleted_at"
    )
    .eq("household_id", user.household_id);
  const validLeases = (leases ?? []).filter(
    (l: { deleted_at: string | null }) => !l.deleted_at
  );

  const { data: props } = await admin
    .from("properties")
    .select("id, name, address")
    .eq("household_id", user.household_id)
    .is("deleted_at", null);
  const propMap = new Map<string, { name: string; address: string | null }>();
  (props ?? []).forEach((p: { id: string; name: string; address: string | null }) =>
    propMap.set(p.id, { name: p.name, address: p.address })
  );

  const leaseIds = validLeases.map((l: { id: string }) => l.id);
  let bills: { id: string; lease_id: string }[] = [];
  if (leaseIds.length > 0) {
    const { data: bs } = await admin
      .from("bills")
      .select("id, lease_id")
      .in("lease_id", leaseIds);
    bills = bs ?? [];
  }
  const billLeaseMap = new Map<string, string>();
  bills.forEach((b) => billLeaseMap.set(b.id, b.lease_id));
  const billIds = bills.map((b) => b.id);

  let payments: { amount: number; paid_at: string; bill_id: string }[] = [];
  if (billIds.length > 0) {
    const { data: ps } = await admin
      .from("payments")
      .select("amount, paid_at, bill_id")
      .in("bill_id", billIds);
    payments = ps ?? [];
  }

  // 计算 available_years（所有 payments 年份 + 当年）
  const yearSet = new Set<number>();
  yearSet.add(new Date().getFullYear());
  payments.forEach((p) => {
    const y = new Date(p.paid_at).getFullYear();
    if (!Number.isNaN(y)) yearSet.add(y);
  });
  const availableYears = [...yearSet].sort((a, b) => b - a);

  // 已收 total + monthly
  const monthly = Array(12).fill(0) as number[];
  let receivedTotal = 0;
  const byPropertyReceived = new Map<string, number>();
  payments.forEach((p) => {
    const d = new Date(p.paid_at);
    if (d.getFullYear() !== year) return;
    const amount = Number(p.amount);
    receivedTotal += amount;
    monthly[d.getMonth()] += amount;
    const leaseId = billLeaseMap.get(p.bill_id);
    const lease = validLeases.find((l: { id: string }) => l.id === leaseId);
    if (lease) {
      const pid = (lease as { property_id: string }).property_id;
      byPropertyReceived.set(pid, (byPropertyReceived.get(pid) ?? 0) + amount);
    }
  });

  // 年度预计：每个租约在该年的活跃月数 × monthly_rent
  let projectedTotal = 0;
  const byPropertyProjected = new Map<string, number>();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  validLeases.forEach(
    (l: {
      property_id: string;
      start_date: string;
      end_date: string;
      monthly_rent: number;
      status: string;
    }) => {
      const s = new Date(l.start_date);
      const e = new Date(l.end_date);
      const start = s > yearStart ? s : yearStart;
      const end = e < yearEnd ? e : yearEnd;
      if (start > end) return;
      // 月数（粗略：按天数 / 30.44）
      const months = Math.max(
        0,
        Math.round(
          (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        )
      );
      const rent = Number(l.monthly_rent) * months;
      projectedTotal += rent;
      byPropertyProjected.set(
        l.property_id,
        (byPropertyProjected.get(l.property_id) ?? 0) + rent
      );
    }
  );

  // 房源数 / 租客数（year 内活跃过的）
  const activePropertyIds = new Set<string>();
  const activeLeaseIds: string[] = [];
  validLeases.forEach(
    (l: { id: string; property_id: string; start_date: string; end_date: string }) => {
      const s = new Date(l.start_date);
      const e = new Date(l.end_date);
      if (s <= yearEnd && e >= yearStart) {
        activePropertyIds.add(l.property_id);
        activeLeaseIds.push(l.id);
      }
    }
  );

  let tenantCount = 0;
  if (activeLeaseIds.length > 0) {
    const { data: lts } = await admin
      .from("lease_tenants")
      .select("tenant_id")
      .in("lease_id", activeLeaseIds);
    const tenantSet = new Set<string>();
    (lts ?? []).forEach((r: { tenant_id: string }) => tenantSet.add(r.tenant_id));
    tenantCount = tenantSet.size;
  }

  const byProperty = [...new Set([...byPropertyReceived.keys(), ...byPropertyProjected.keys()])].map(
    (pid) => ({
      property_id: pid,
      property_name: propMap.get(pid)?.name ?? "—",
      property_address: propMap.get(pid)?.address ?? null,
      received: Math.round((byPropertyReceived.get(pid) ?? 0) * 100) / 100,
      projected: Math.round((byPropertyProjected.get(pid) ?? 0) * 100) / 100,
    })
  );
  byProperty.sort((a, b) => b.received - a.received);

  return NextResponse.json({
    year,
    available_years: availableYears,
    received_total: Math.round(receivedTotal * 100) / 100,
    projected_total: Math.round(projectedTotal * 100) / 100,
    property_count: activePropertyIds.size,
    tenant_count: tenantCount,
    monthly: monthly.map((v) => Math.round(v * 100) / 100),
    by_property: byProperty,
  });
}
