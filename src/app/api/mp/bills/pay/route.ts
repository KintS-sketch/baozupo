/**
 * POST /api/mp/bills/pay
 *
 * 记录账单收款。复刻 PWA bills/page.tsx 的 handlePayment：
 *   1. INSERT payments 表（金额/时间/方式/备注）
 *   2. UPDATE bills SET paid_amount += amount, status = 重算
 *
 * 重算状态规则（跟 lib/billing.ts calculateBillStatus 一致）：
 *   - paid_amount >= total_amount → paid
 *   - paid_amount > 0  且 dueDate < today → overdue
 *   - paid_amount > 0  且 dueDate >= today → partial
 *   - paid_amount == 0 且 dueDate < today → overdue
 *   - paid_amount == 0 且 dueDate >= today → pending
 *
 * Body: { bill_id, amount, paid_at (ISO), method, notes? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type BillStatus = "pending" | "partial" | "paid" | "overdue";

function calcStatus(total: number, paid: number, dueDate: Date): BillStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const isOverdue = due.getTime() < today.getTime();
  if (paid >= total) return "paid";
  if (paid > 0) return isOverdue ? "overdue" : "partial";
  return isOverdue ? "overdue" : "pending";
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: {
    bill_id?: string;
    amount?: number;
    paid_at?: string;
    method?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const { bill_id, amount, paid_at, method, notes } = body;
  if (!bill_id) return NextResponse.json({ error: "bill_id 不能为空" }, { status: 400 });
  if (!amount || amount <= 0)
    return NextResponse.json({ error: "amount 必须 > 0" }, { status: 400 });
  if (!paid_at) return NextResponse.json({ error: "paid_at 不能为空" }, { status: 400 });
  if (!method) return NextResponse.json({ error: "method 不能为空" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 校验账单归属当前 household
    const { data: bill } = await admin
      .from("bills")
      .select(
        "id, total_amount, paid_amount, due_date, lease:leases(household_id)"
      )
      .eq("id", bill_id)
      .maybeSingle();
    if (!bill) return NextResponse.json({ error: "账单不存在" }, { status: 404 });
    const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
      !v ? [] : Array.isArray(v) ? v : [v];
    const leaseRow = asArr(
      (bill as { lease: { household_id: string } | { household_id: string }[] | null }).lease
    )[0];
    if (!leaseRow || leaseRow.household_id !== user.household_id) {
      return NextResponse.json({ error: "账单不属于你" }, { status: 403 });
    }

    const billRow = bill as { total_amount: number; paid_amount: number; due_date: string };
    const total = Number(billRow.total_amount);
    const newPaid = Number(billRow.paid_amount) + Number(amount);
    const newStatus = calcStatus(total, newPaid, new Date(billRow.due_date));

    // INSERT payment
    const { error: payErr } = await admin.from("payments").insert({
      bill_id,
      amount: Number(amount),
      paid_at,
      method,
      notes: notes || null,
    });
    if (payErr) throw payErr;

    // UPDATE bill
    const { error: updErr } = await admin
      .from("bills")
      .update({ paid_amount: newPaid, status: newStatus })
      .eq("id", bill_id);
    if (updErr) throw updErr;

    return NextResponse.json({
      success: true,
      paid_amount: newPaid,
      status: newStatus,
    });
  } catch (err) {
    console.error("[api/mp/bills/pay] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "记录收款失败" },
      { status: 500 }
    );
  }
}
