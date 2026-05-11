"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Sparkles, Calculator, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { ProBadge } from "@/components/pro-badge";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency } from "@/lib/format";
import {
  summarizeYear,
  summaryToCSV,
  type PaymentRecord,
  type LeaseSnapshot,
  type YearlySummary,
} from "@/lib/tax-helper";

export default function TaxPage() {
  const { householdId, loading: userLoading } = useUser();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [leases, setLeases] = useState<LeaseSnapshot[]>([]);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);

  const supabase = createClient();

  useEffect(() => {
    if (userLoading || !householdId) return;

    const fetchAll = async () => {
      // 1. 拉所有当前 household 的 leases
      const { data: leaseData } = await supabase
        .from("leases")
        .select("id, property_id, monthly_rent, start_date, end_date, status, property:properties(name)")
        .eq("household_id", householdId)
        .is("deleted_at", null);

      const leaseRows = (leaseData ?? []) as unknown as Array<{
        id: string;
        property_id: string;
        monthly_rent: number;
        start_date: string;
        end_date: string;
        status: string;
        property: { name: string } | null;
      }>;

      const leaseSnapshots: LeaseSnapshot[] = leaseRows.map((l) => ({
        property_id: l.property_id,
        property_name: l.property?.name ?? "—",
        monthly_rent: Number(l.monthly_rent),
        start_date: l.start_date,
        end_date: l.end_date,
        status: l.status,
      }));
      setLeases(leaseSnapshots);

      // 2. 拉这些 lease 下所有 bill_id
      const leaseIds = leaseRows.map((l) => l.id);
      if (leaseIds.length === 0) {
        setPayments([]);
        setLoading(false);
        return;
      }
      const { data: billData } = await supabase
        .from("bills")
        .select("id, lease_id")
        .in("lease_id", leaseIds);
      const bills = (billData ?? []) as Array<{ id: string; lease_id: string }>;
      const billLeaseMap = new Map(bills.map((b) => [b.id, b.lease_id]));
      const leaseInfo = new Map(leaseRows.map((l) => [l.id, l]));

      // 3. 拉所有 payments
      if (bills.length === 0) {
        setPayments([]);
        setLoading(false);
        return;
      }
      const { data: payData } = await supabase
        .from("payments")
        .select("amount, paid_at, bill_id, bill:bills(lease:leases(lease_tenants(is_primary, tenant:tenants(name))))")
        .in("bill_id", bills.map((b) => b.id))
        .order("paid_at", { ascending: false });

      const payRows = (payData ?? []) as unknown as Array<{
        amount: number;
        paid_at: string;
        bill_id: string;
        bill: {
          lease: {
            lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } | null }>;
          } | null;
        } | null;
      }>;

      const paymentRecords: PaymentRecord[] = payRows.map((p) => {
        const leaseId = billLeaseMap.get(p.bill_id) ?? "";
        const leaseRow = leaseInfo.get(leaseId);
        const primaryTenant = p.bill?.lease?.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.name ?? "";
        return {
          amount: Number(p.amount),
          paid_at: p.paid_at,
          property_id: leaseRow?.property_id ?? "",
          property_name: leaseRow?.property?.name ?? "—",
          tenant_name: primaryTenant,
        };
      });
      setPayments(paymentRecords);
      setLoading(false);
    };

    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const summary = useMemo<YearlySummary | null>(() => {
    if (loading) return null;
    return summarizeYear(year, payments, leases);
  }, [year, payments, leases, loading]);

  // 年份选择：从最早 payment 年份到今年
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const p of payments) {
      years.add(new Date(p.paid_at).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [payments, currentYear]);

  const handleExport = () => {
    if (!summary) return;
    const csv = summaryToCSV(summary);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `养房Tend-${year}年度收入汇总.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summary || (summary.totalReceived === 0 && summary.byProperty.length === 0)) {
    return (
      <div className="p-4 md:p-6 max-w-4xl">
        <Header year={year} availableYears={availableYears} onYearChange={setYear} />
        <EmptyState
          icon={Calculator}
          title={`${year} 年还没有租金收入哦`}
          description="等收到第一笔租金后，这里会自动汇总年度数据"
        />
      </div>
    );
  }

  const maxMonthly = Math.max(...summary.monthly.map((m) => m.received), 1);
  const maxProperty = Math.max(...summary.byProperty.map((p) => p.received), 1);
  const completion =
    summary.totalExpected > 0
      ? Math.min(100, Math.round((summary.totalReceived / summary.totalExpected) * 100))
      : 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-5">
      <Header year={year} availableYears={availableYears} onYearChange={setYear} />

      {/* 总览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile
          label="累计已收"
          value={formatCurrency(summary.totalReceived)}
          accent="primary"
          sub={`${summary.paymentCount} 笔收款`}
        />
        <SummaryTile
          label="年度预计"
          value={formatCurrency(summary.totalExpected)}
          sub={summary.totalExpected > 0 ? `当前进度 ${completion}%` : "—"}
        />
        <SummaryTile
          label="涉及房源"
          value={`${summary.propertyCount} 套`}
        />
        <SummaryTile
          label="涉及租客"
          value={`${summary.tenantCount} 人`}
        />
      </div>

      {/* 月度图 */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">月度收款趋势</h2>
            </div>
            <span className="text-xs text-muted-foreground">单位：元</span>
          </div>
          <div className="flex items-end gap-1.5 h-32">
            {summary.monthly.map((m) => {
              const heightPct = m.received > 0 ? (m.received / maxMonthly) * 100 : 0;
              const isCurrent = year === currentYear && m.month === new Date().getMonth() + 1;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 group">
                  <div
                    className={`w-full rounded-t transition-all relative ${
                      m.received > 0
                        ? "bg-primary/80 hover:bg-primary"
                        : "bg-muted"
                    } ${isCurrent ? "ring-2 ring-primary/40" : ""}`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  >
                    {m.received > 0 && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-foreground/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                        {m.received >= 10000
                          ? `${(m.received / 10000).toFixed(1)}万`
                          : m.received.toFixed(0)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{m.month}月</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 房源明细 */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="text-sm font-semibold mb-3">各房源年度收入</h2>
          <div className="space-y-3">
            {summary.byProperty.map((p) => {
              const widthPct = p.received > 0 ? (p.received / maxProperty) * 100 : 0;
              return (
                <div key={p.propertyId}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm font-medium truncate">{p.propertyName}</span>
                    <span className="text-sm font-semibold tabular-nums shrink-0 ml-3">
                      {formatCurrency(p.received)}
                      {p.received === 0 && (
                        <span className="text-xs text-muted-foreground ml-1">空置/未收</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded-full transition-all"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.paymentCount} 笔收款</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 操作 + 引流 */}
      <div className="space-y-3">
        <Button variant="outline" className="w-full" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          导出 Excel（{year} 年度汇总）
        </Button>

        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-50 to-orange-50/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2">
                  想自动算税额 + 生成申报报告？
                  <ProBadge />
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Pro 版按你所在城市自动算个人所得税、房产税、增值税，
                  一键生成《年度租赁所得报告》PDF，拿去申报。
                </p>
                <Link
                  href="/subscription"
                  className="inline-block text-xs text-orange-700 font-medium mt-2 hover:underline"
                >
                  即将上线 · 报税季前推出 → 提前了解 Pro
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 免责声明 */}
      <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded-lg p-3">
        ⚠️ 本工具仅按你的实际收款记录做数据汇总，<strong>不构成税务建议</strong>。
        最终应纳税额以税务机关核定为准。建议申报前咨询当地税务局或注册税务师。
      </p>
    </div>
  );
}

function Header({
  year,
  availableYears,
  onYearChange,
}: {
  year: number;
  availableYears: number[];
  onYearChange: (y: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="md:hidden">
          <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            个税助手
          </h1>
          <p className="text-xs text-muted-foreground">年度租金收入汇总，方便你做个税年度申报</p>
        </div>
      </div>
      <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))}>
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableYears.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y} 年
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "primary";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold mt-1 tabular-nums ${accent === "primary" ? "text-primary" : ""}`}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
