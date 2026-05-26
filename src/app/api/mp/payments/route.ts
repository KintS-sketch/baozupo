/**
 * GET /api/mp/payments
 *
 * 返回当前 household 所有收款记录（按 paid_at 倒序），含房源/主租客信息。
 * 等价于 PWA src/app/payments/page.tsx 的查询。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface PaymentRow {
  id: string;
  bill_id: string;
  amount: number;
  paid_at: string;
  method: string;
  notes: string | null;
  ai_recognized: boolean;
  /** 转账截图 signed URL（1 小时有效），无则为 null */
  screenshot_signed_url: string | null;
  property_name: string;
  property_address: string | null;
  primary_tenant_name: string | null;
  period_start: string | null;
  period_end: string | null;
}

const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
  !v ? [] : Array.isArray(v) ? v : [v];

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ payments: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 先拿所有 bill_id（通过 leases.household_id 过滤）
  const { data: leaseRows } = await admin
    .from("leases")
    .select("id")
    .eq("household_id", user.household_id)
    .is("deleted_at", null);
  const leaseIds = (leaseRows ?? []).map((r: { id: string }) => r.id);
  if (leaseIds.length === 0) return NextResponse.json({ payments: [] });

  const { data: billRows } = await admin
    .from("bills")
    .select("id")
    .in("lease_id", leaseIds);
  const billIds = (billRows ?? []).map((b: { id: string }) => b.id);
  if (billIds.length === 0) return NextResponse.json({ payments: [] });

  const { data: rows, error } = await admin
    .from("payments")
    .select(
      `id, bill_id, amount, paid_at, method, notes, ai_recognized, screenshot_url,
       bill:bills(
         period_start, period_end,
         lease:leases(
           property:properties(name, address),
           lease_tenants(is_primary, tenant:tenants(name))
         )
       )`
    )
    .in("bill_id", billIds)
    .order("paid_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: "查询失败：" + error.message },
      { status: 500 }
    );
  }

  type Row = {
    id: string;
    bill_id: string;
    amount: number;
    paid_at: string;
    method: string;
    notes: string | null;
    ai_recognized: boolean | null;
    screenshot_url: string | null;
    bill:
      | {
          period_start: string;
          period_end: string;
          lease:
            | {
                property: { name: string } | { name: string }[] | null;
                lease_tenants?: {
                  is_primary: boolean;
                  tenant: { name: string } | { name: string }[] | null;
                }[];
              }
            | Array<{
                property: { name: string } | { name: string }[] | null;
                lease_tenants?: {
                  is_primary: boolean;
                  tenant: { name: string } | { name: string }[] | null;
                }[];
              }>
            | null;
        }
      | Array<{
          period_start: string;
          period_end: string;
          lease: unknown;
        }>
      | null;
  };

  // 先收集所有非空 screenshot_url 一次性批量签名（contracts bucket 是 private）
  const screenshotPaths = (rows ?? [])
    .map((r) => (r as { screenshot_url?: string | null }).screenshot_url)
    .filter((p): p is string => !!p && typeof p === "string");
  const signedMap: Record<string, string> = {};
  if (screenshotPaths.length > 0) {
    const signResults = await Promise.all(
      screenshotPaths.map(async (p) => {
        const { data: s } = await admin.storage
          .from("contracts")
          .createSignedUrl(p, 3600);
        return { path: p, url: s?.signedUrl ?? null };
      })
    );
    for (const sr of signResults) {
      if (sr.url) signedMap[sr.path] = sr.url;
    }
  }

  const payments: PaymentRow[] = (rows ?? []).map((r) => {
    const row = r as unknown as Row;
    const bill = asArr(row.bill)[0] as
      | {
          period_start: string;
          period_end: string;
          lease: unknown;
        }
      | undefined;
    const lease = bill ? asArr(bill.lease)[0] : undefined;
    const propRow = asArr((lease as { property?: unknown } | undefined)?.property)[0] as
      | { name: string; address: string | null }
      | undefined;
    const lts = (lease as { lease_tenants?: { is_primary: boolean; tenant: unknown }[] } | undefined)
      ?.lease_tenants ?? [];
    const primaryName =
      lts
        .filter((t) => t.is_primary)
        .flatMap((t) => asArr(t.tenant))[0] ??
      lts.flatMap((t) => asArr(t.tenant))[0];
    return {
      id: row.id,
      bill_id: row.bill_id,
      amount: Number(row.amount),
      paid_at: row.paid_at,
      method: row.method,
      notes: row.notes,
      ai_recognized: !!row.ai_recognized,
      screenshot_signed_url: row.screenshot_url ? signedMap[row.screenshot_url] ?? null : null,
      property_name: propRow?.name ?? "—",
      property_address: propRow?.address ?? null,
      primary_tenant_name: (primaryName as { name?: string } | undefined)?.name ?? null,
      period_start: bill?.period_start ?? null,
      period_end: bill?.period_end ?? null,
    };
  });

  return NextResponse.json({ payments });
}
