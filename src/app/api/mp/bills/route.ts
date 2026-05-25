/**
 * GET /api/mp/bills
 *
 * 给小程序「账单」tab 用的账单列表端点。
 * 复刻 PWA src/app/bills/page.tsx 的查询 + 状态计数。
 *
 * 返回所有账单（含房源/主租客），客户端按 tab 自己过滤；同时返回 counts 给 tab 角标。
 * 「当期」过滤逻辑也在客户端做（要用 today 和 period_start/end 比较）。
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ bills: BillWithLease[], counts: { overdue, pending, partial, paid } }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export interface BillWithLease {
  id: string;
  lease_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  rent_amount: number;
  utility_amount: number;
  other_amount: number;
  total_amount: number;
  paid_amount: number;
  status: "pending" | "partial" | "paid" | "overdue";
  bill_type: "rent" | "deposit";
  notes: string | null;
  property_name: string;
  property_address: string | null;
  primary_tenant_name: string | null;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({
      bills: [],
      counts: { overdue: 0, pending: 0, partial: 0, paid: 0 },
    });
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
    // 先拿这个 household 所有未删除租约 id
    const { data: leaseIdRows } = await admin
      .from("leases")
      .select("id")
      .eq("household_id", user.household_id)
      .is("deleted_at", null);
    const leaseIds = (leaseIdRows ?? []).map((r: { id: string }) => r.id);

    if (leaseIds.length === 0) {
      return NextResponse.json({
        bills: [],
        counts: { overdue: 0, pending: 0, partial: 0, paid: 0 },
      });
    }

    const { data: rows, error } = await admin
      .from("bills")
      .select(
        `id, lease_id, period_start, period_end, due_date,
         rent_amount, utility_amount, other_amount, total_amount, paid_amount,
         status, bill_type, notes,
         lease:leases(
           property:properties(name, address),
           lease_tenants(is_primary, tenant:tenants(name))
         )`
      )
      .in("lease_id", leaseIds)
      .order("due_date", { ascending: false });
    if (error) throw error;

    // supabase 嵌套 join 可能返回数组也可能单对象，兜底
    const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
      !v ? [] : Array.isArray(v) ? v : [v];

    type Row = {
      id: string;
      lease_id: string;
      period_start: string;
      period_end: string;
      due_date: string;
      rent_amount: number;
      utility_amount: number;
      other_amount: number;
      total_amount: number;
      paid_amount: number;
      status: string;
      bill_type: "rent" | "deposit" | null;
      notes: string | null;
      lease:
        | {
            property:
              | { name: string; address: string | null }
              | { name: string; address: string | null }[]
              | null;
            lease_tenants?: {
              is_primary: boolean;
              tenant: { name: string } | { name: string }[] | null;
            }[];
          }
        | Array<{
            property:
              | { name: string; address: string | null }
              | { name: string; address: string | null }[]
              | null;
            lease_tenants?: {
              is_primary: boolean;
              tenant: { name: string } | { name: string }[] | null;
            }[];
          }>
        | null;
    };

    const bills: BillWithLease[] = (rows ?? []).map((r) => {
      const row = r as unknown as Row;
      const lease = asArr(row.lease)[0];
      const propRow = asArr(lease?.property)[0];
      const propName = propRow?.name ?? "—";
      const propAddress = propRow?.address ?? null;
      const lts = lease?.lease_tenants ?? [];
      const primaryName =
        lts
          .filter((t) => t.is_primary)
          .flatMap((t) => asArr(t.tenant))[0]?.name ??
        lts.flatMap((t) => asArr(t.tenant))[0]?.name ??
        null;
      return {
        id: row.id,
        lease_id: row.lease_id,
        period_start: row.period_start,
        period_end: row.period_end,
        due_date: row.due_date,
        rent_amount: Number(row.rent_amount),
        utility_amount: Number(row.utility_amount),
        other_amount: Number(row.other_amount),
        total_amount: Number(row.total_amount),
        paid_amount: Number(row.paid_amount),
        status: row.status as BillWithLease["status"],
        bill_type: (row.bill_type ?? "rent") as BillWithLease["bill_type"],
        notes: row.notes,
        property_name: propName,
        property_address: propAddress,
        primary_tenant_name: primaryName,
      };
    });

    const counts = bills.reduce(
      (acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1;
        return acc;
      },
      { overdue: 0, pending: 0, partial: 0, paid: 0 } as Record<string, number>
    );

    return NextResponse.json({ bills, counts });
  } catch (err) {
    console.error("[api/mp/bills] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
