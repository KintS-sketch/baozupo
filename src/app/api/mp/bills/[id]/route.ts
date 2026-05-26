/**
 * GET /api/mp/bills/[id]
 *
 * 单个账单详情。给 mp 端账单详情弹窗用：
 *  - 账单基础字段（同 /api/mp/bills 列表）
 *  - 房源 + 主租客信息
 *  - 该账单所有 payments（按 paid_at 倒序），含 screenshot 签名 URL
 *
 * 鉴权：Bearer token + 校验账单归属当前 household
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
  !v ? [] : Array.isArray(v) ? v : [v];

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
    // 拉账单 + 嵌套租约/房源/主租客信息
    const { data: bill, error: bErr } = await admin
      .from("bills")
      .select(
        `id, lease_id, period_start, period_end, due_date,
         rent_amount, utility_amount, other_amount, total_amount, paid_amount,
         status, bill_type, notes,
         lease:leases(
           household_id, deleted_at,
           property:properties(name, address),
           lease_tenants(is_primary, tenant:tenants(name, phone))
         )`
      )
      .eq("id", id)
      .maybeSingle();

    if (bErr) throw bErr;
    if (!bill) return NextResponse.json({ error: "账单不存在" }, { status: 404 });

    const leaseRow = asArr(
      (bill as { lease: unknown }).lease as
        | { household_id: string; deleted_at: string | null }
        | { household_id: string; deleted_at: string | null }[]
        | null
    )[0];

    if (!leaseRow || leaseRow.household_id !== user.household_id) {
      return NextResponse.json({ error: "账单不属于你" }, { status: 403 });
    }
    if (leaseRow.deleted_at) {
      return NextResponse.json({ error: "租约已归档" }, { status: 410 });
    }

    const propRow = asArr(
      (leaseRow as unknown as { property: unknown }).property as
        | { name: string; address: string | null }
        | { name: string; address: string | null }[]
        | null
    )[0];

    const lts =
      (leaseRow as unknown as {
        lease_tenants?: {
          is_primary: boolean;
          tenant: { name: string; phone: string } | { name: string; phone: string }[] | null;
        }[];
      }).lease_tenants ?? [];
    const primaryTenant =
      lts
        .filter((t) => t.is_primary)
        .flatMap((t) => asArr(t.tenant))[0] ??
      lts.flatMap((t) => asArr(t.tenant))[0] ??
      null;

    // 拉所有 payments
    const { data: paymentsRaw } = await admin
      .from("payments")
      .select("id, amount, paid_at, method, notes, screenshot_url, ai_recognized")
      .eq("bill_id", id)
      .order("paid_at", { ascending: false });

    // 批量签名 screenshot
    const screenshotPaths = (paymentsRaw ?? [])
      .map((p) => p.screenshot_url as string | null)
      .filter((p): p is string => !!p);
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

    const payments = (paymentsRaw ?? []).map((p) => ({
      id: p.id as string,
      amount: Number(p.amount),
      paid_at: p.paid_at as string,
      method: p.method as string,
      notes: (p.notes as string | null) ?? null,
      screenshot_signed_url: p.screenshot_url
        ? signedMap[p.screenshot_url as string] ?? null
        : null,
      ai_recognized: !!p.ai_recognized,
    }));

    return NextResponse.json({
      bill: {
        id: bill.id,
        lease_id: bill.lease_id,
        period_start: bill.period_start,
        period_end: bill.period_end,
        due_date: bill.due_date,
        rent_amount: Number(bill.rent_amount),
        utility_amount: Number(bill.utility_amount),
        other_amount: Number(bill.other_amount),
        total_amount: Number(bill.total_amount),
        paid_amount: Number(bill.paid_amount),
        status: bill.status,
        bill_type: bill.bill_type ?? "rent",
        notes: bill.notes,
        property_name: propRow?.name ?? "—",
        property_address: propRow?.address ?? null,
        primary_tenant_name: primaryTenant?.name ?? null,
        primary_tenant_phone: primaryTenant?.phone ?? null,
      },
      payments,
    });
  } catch (err) {
    console.error("[api/mp/bills/[id]] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
