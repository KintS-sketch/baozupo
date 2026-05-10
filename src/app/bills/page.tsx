"use client";

import { useEffect, useState } from "react";
import { Receipt, Loader2, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { BillPaymentForm, type BillPaymentFormValues } from "@/components/forms/bill-payment-form";
import { BillForm, type BillFormValues } from "@/components/forms/bill-form";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { BILL_STATUS_LABELS } from "@/types";
import { calculateBillStatus as calcStatus } from "@/lib/billing";
import type { Bill, BillStatus } from "@/types";
import { toast } from "sonner";

const STATUS_BADGE: Record<BillStatus, "warning" | "info" | "success" | "destructive"> = {
  pending: "warning",
  partial: "info",
  paid: "success",
  overdue: "destructive",
};

type BillWithLease = Bill & {
  lease: {
    property: { name: string };
    lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } }>;
  };
};

export default function BillsPage() {
  const { householdId, loading: userLoading } = useUser();
  const [bills, setBills] = useState<BillWithLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | BillStatus>("all");
  const [payingBill, setPayingBill] = useState<BillWithLease | null>(null);
  const [billFormOpen, setBillFormOpen] = useState(false);

  const supabase = createClient();

  const fetchBills = async () => {
    if (!householdId) return;
    const leaseIds = await supabase
      .from("leases")
      .select("id")
      .eq("household_id", householdId)
      .is("deleted_at", null);

    if (!leaseIds.data) { setLoading(false); return; }
    const ids = leaseIds.data.map((l) => l.id);

    const { data, error } = await supabase
      .from("bills")
      .select("*, lease:leases(property:properties(name), lease_tenants(is_primary, tenant:tenants(name)))")
      .in("lease_id", ids.length ? ids : ["_none_"])
      .order("due_date", { ascending: false });

    if (!error) setBills((data ?? []) as BillWithLease[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handlePayment = async (values: BillPaymentFormValues) => {
    if (!payingBill) return;

    // 插入收款记录
    const { error: payError } = await supabase.from("payments").insert({
      bill_id: payingBill.id,
      amount: values.amount,
      paid_at: new Date(values.paid_at).toISOString(),
      method: values.method,
      notes: values.notes || null,
    });

    if (payError) { toast.error("记录收款失败"); return; }

    // 更新账单已收金额和状态
    const newPaidAmount = payingBill.paid_amount + values.amount;
    const newStatus = calcStatus(
      payingBill.total_amount,
      newPaidAmount,
      new Date(payingBill.due_date)
    );

    const { error: billError } = await supabase
      .from("bills")
      .update({ paid_amount: newPaidAmount, status: newStatus })
      .eq("id", payingBill.id);

    if (billError) { toast.error("更新账单状态失败"); return; }

    toast.success("收款记录成功");
    setPayingBill(null);
    fetchBills();
  };

  const handleCreateBill = async (values: BillFormValues & { total_amount: number; days_in_period: number; ratio: number }) => {
    const { error } = await supabase.from("bills").insert({
      lease_id: values.lease_id,
      period_start: values.period_start,
      period_end: values.period_end,
      days_in_period: values.days_in_period,
      ratio: values.ratio,
      due_date: values.due_date,
      rent_amount: values.rent_amount,
      utility_amount: values.utility_amount,
      other_amount: values.other_amount,
      total_amount: values.total_amount,
      paid_amount: 0,
      status: "pending",
      notes: values.notes || null,
    });

    if (error) { toast.error("创建账单失败：" + error.message); return; }
    toast.success("账单已创建");
    setBillFormOpen(false);
    fetchBills();
  };

  const getPrimaryTenant = (bill: BillWithLease) => {
    const primary = bill.lease?.lease_tenants?.find((lt) => lt.is_primary);
    return primary?.tenant?.name ?? bill.lease?.lease_tenants?.[0]?.tenant?.name ?? "—";
  };

  const filtered = statusFilter === "all" ? bills : bills.filter((b) => b.status === statusFilter);

  // 统计各状态数量
  const counts = bills.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl pb-24 md:pb-6">
      <div className="flex items-start justify-between mb-4 pt-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">账单</h1>
          <p className="text-xs text-muted-faint mt-1">
            共 {bills.length} 张 · 逾期 {counts.overdue ?? 0} 张
          </p>
        </div>
        <Button onClick={() => setBillFormOpen(true)} className="hidden md:inline-flex">
          <Plus className="h-4 w-4 mr-1" />
          新增账单
        </Button>
      </div>

      {/* Segmented pill tabs */}
      <div className="mb-4 -mx-1 px-1 overflow-x-auto">
        <div className="inline-flex p-1 bg-secondary rounded-xl gap-1 min-w-full">
          {[
            { v: "all", label: "全部", count: bills.length },
            { v: "pending", label: "待收", count: counts.pending ?? 0 },
            { v: "partial", label: "部分", count: counts.partial ?? 0 },
            { v: "overdue", label: "逾期", count: counts.overdue ?? 0 },
            { v: "paid", label: "已收", count: counts.paid ?? 0 },
          ].map((t) => {
            const active = statusFilter === t.v;
            return (
              <button
                key={t.v}
                onClick={() => setStatusFilter(t.v as typeof statusFilter)}
                className={`flex-1 h-9 rounded-lg text-sm transition-all whitespace-nowrap px-3 inline-flex items-center justify-center gap-1.5 ${
                  active
                    ? "bg-card text-foreground font-semibold shadow-soft"
                    : "text-muted-foreground font-medium"
                }`}
              >
                {t.label}
                <span className={`num text-[11px] ${active ? "text-muted-foreground" : "text-muted-faint"}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="没有符合条件的账单"
          description={statusFilter === "all" ? "账单将在创建租约后自动或手动生成" : undefined}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              tenant={getPrimaryTenant(bill)}
              onPay={() => setPayingBill(bill)}
            />
          ))}
        </div>
      )}

      {/* 移动端 FAB */}
      <button
        onClick={() => setBillFormOpen(true)}
        className="md:hidden fixed right-5 bottom-24 h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-soft-lg hover:bg-primary-hover transition-all z-40"
        aria-label="新增账单"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* 新增账单弹窗 */}
      <Dialog open={billFormOpen} onOpenChange={setBillFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增账单</DialogTitle>
          </DialogHeader>
          <BillForm
            onSubmit={handleCreateBill}
            onCancel={() => setBillFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 收款弹窗 */}
      <Dialog open={!!payingBill} onOpenChange={(open) => { if (!open) setPayingBill(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>记录收款</DialogTitle>
          </DialogHeader>
          {payingBill && (
            <BillPaymentForm
              bill={payingBill}
              tenantName={getPrimaryTenant(payingBill)}
              propertyName={payingBill.lease?.property?.name}
              onSubmit={handlePayment}
              onCancel={() => setPayingBill(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BillCard({
  bill,
  tenant,
  onPay,
}: {
  bill: BillWithLease;
  tenant: string;
  onPay: () => void;
}) {
  const unpaid = bill.total_amount - bill.paid_amount;
  const property = bill.lease?.property?.name ?? "—";

  // 计算逾期天数
  const daysOverdue = (() => {
    if (bill.status !== "overdue") return 0;
    const due = new Date(bill.due_date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  })();

  const progressPct = bill.total_amount > 0 ? (bill.paid_amount / bill.total_amount) * 100 : 0;

  return (
    <Card className={bill.status === "overdue" ? "border-destructive/30" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-base">{tenant}</span>
              <Badge variant={STATUS_BADGE[bill.status]}>{BILL_STATUS_LABELS[bill.status]}</Badge>
              {daysOverdue > 0 && (
                <span className="text-xs text-destructive font-semibold">· 逾期 {daysOverdue} 天</span>
              )}
            </div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 text-muted-faint" />
              {property}
            </div>
            <p className="num text-xs text-muted-faint mt-1">
              {formatDate(bill.period_start)} — {formatDate(bill.period_end)} · 到期 {formatDate(bill.due_date)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="num text-xl font-bold tracking-tight">
              {formatCurrency(bill.total_amount)}
            </p>
            {bill.status === "paid" && (
              <p className="num text-xs text-success mt-0.5">已收 {formatCurrency(bill.paid_amount)}</p>
            )}
            {bill.status === "partial" && (
              <p className="num text-xs text-muted-foreground mt-0.5">已收 {formatCurrency(bill.paid_amount)}</p>
            )}
          </div>
        </div>

        {/* 部分支付进度条 */}
        {bill.status === "partial" && (
          <div className="mt-2.5 h-1 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-info rounded-full" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {/* 未付清 CTA */}
        {bill.status !== "paid" && (
          <div className="mt-3 pt-3 border-t border-dashed border-border">
            <Button
              onClick={onPay}
              variant={bill.status === "overdue" ? "destructive" : "default"}
              size="sm"
              className="w-full h-10"
            >
              记录收款 · 待收 {formatCurrency(unpaid)}
            </Button>
          </div>
        )}

        {bill.notes && (
          <p className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">{bill.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
