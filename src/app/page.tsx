"use client";

import { useEffect, useState } from "react";
import { Building2, AlertCircle, Loader2, Clock, Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/brand-mark";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { ensureReminders } from "@/lib/reminders-service";
import { BILL_STATUS_LABELS } from "@/types";
import type { Bill, Lease, DashboardStats } from "@/types";
import { format, startOfMonth, endOfMonth } from "date-fns";
import Link from "next/link";

const BILL_STATUS_COLORS: Record<string, string> = {
  pending: "warning",
  partial: "info",
  paid: "success",
  overdue: "destructive",
};

export default function DashboardPage() {
  const { user, householdId, loading: userLoading } = useUser();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentBills, setRecentBills] = useState<Bill[]>([]);
  const [expiringLeases, setExpiringLeases] = useState<Lease[]>([]);
  const [pendingReminders, setPendingReminders] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userLoading) return;
    if (!householdId) {
      setLoading(false);
      return;
    }
    fetchDashboard(householdId);
    // 异步生成 + 拉取提醒数（不阻塞主页）
    (async () => {
      try {
        await ensureReminders(householdId);
        const supabase = createClient();
        const { count } = await supabase
          .from("reminders")
          .select("id", { count: "exact", head: true })
          .eq("household_id", householdId)
          .eq("is_dismissed", false);
        setPendingReminders(count ?? 0);
      } catch (err) {
        console.error("[dashboard] reminders sync failed:", err);
      }
    })();
  }, [householdId, userLoading]);

  const fetchDashboard = async (hid: string) => {
    const supabase = createClient();
    const now = new Date();
    const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");

    try {
      // 账单统计（本月到期账单）
      const { data: billsData } = await supabase
        .from("bills")
        .select("total_amount, paid_amount, status")
        .gte("due_date", monthStart)
        .lte("due_date", monthEnd)
        .in("lease_id",
          (await supabase
            .from("leases")
            .select("id")
            .eq("household_id", hid)
            .is("deleted_at", null)
          ).data?.map((l) => l.id) ?? []
        );

      // 房源统计
      const { data: propertiesData } = await supabase
        .from("properties")
        .select("status")
        .eq("household_id", hid)
        .is("deleted_at", null);

      // 逾期账单数
      const { count: overdueCount } = await supabase
        .from("bills")
        .select("id", { count: "exact", head: true })
        .eq("status", "overdue")
        .in("lease_id",
          (await supabase
            .from("leases")
            .select("id")
            .eq("household_id", hid)
            .is("deleted_at", null)
          ).data?.map((l) => l.id) ?? []
        );

      // 最近 5 条账单
      const { data: recentBillsData } = await supabase
        .from("bills")
        .select("*, lease:leases(property:properties(name), lease_tenants(tenant:tenants(name)))")
        .in("lease_id",
          (await supabase
            .from("leases")
            .select("id")
            .eq("household_id", hid)
            .is("deleted_at", null)
          ).data?.map((l) => l.id) ?? []
        )
        .order("created_at", { ascending: false })
        .limit(5);

      // 即将到期租约（30天内）
      const thirtyDaysLater = format(
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        "yyyy-MM-dd"
      );
      const { data: expiringLeasesData } = await supabase
        .from("leases")
        .select("*, property:properties(name)")
        .eq("household_id", hid)
        .eq("status", "active")
        .is("deleted_at", null)
        .lte("end_date", thirtyDaysLater)
        .gte("end_date", format(now, "yyyy-MM-dd"))
        .order("end_date");

      // 计算统计数据
      const monthlyReceivable = billsData?.reduce((s, b) => s + Number(b.total_amount), 0) ?? 0;
      const monthlyReceived = billsData?.reduce((s, b) => s + Number(b.paid_amount), 0) ?? 0;
      const rentedCount = propertiesData?.filter((p) => p.status === "rented").length ?? 0;
      const vacantCount = propertiesData?.filter((p) => p.status === "vacant").length ?? 0;

      setStats({
        monthlyReceivable,
        monthlyReceived,
        monthlyUnreceived: monthlyReceivable - monthlyReceived,
        overdueCount: overdueCount ?? 0,
        rentedCount,
        vacantCount,
      });
      setRecentBills((recentBillsData ?? []) as Bill[]);
      setExpiringLeases((expiringLeasesData ?? []) as Lease[]);
    } catch (err) {
      console.error("仪表盘数据加载失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const currentMonth = format(new Date(), "yyyy 年 M 月");
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return "凌晨好";
    if (h < 12) return "上午好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  })();
  const userName = user?.email?.split("@")[0] ?? "房东";

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalReceivable = stats?.monthlyReceivable ?? 0;
  const totalReceived = stats?.monthlyReceived ?? 0;
  const progress = totalReceivable > 0 ? Math.min(100, (totalReceived / totalReceivable) * 100) : 0;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl">
      {/* 问候 */}
      <div className="flex items-start justify-between pt-1">
        <div>
          <p className="text-sm text-muted-foreground">{greeting}，{userName}</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{currentMonth}</h1>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <BrandMark size={22} />
        </div>
      </div>

      {/* 待处理提醒 */}
      {pendingReminders > 0 && (
        <Link href="/reminders">
          <Card className="border-warning/30 bg-warning-soft hover:brightness-[0.98] transition-all">
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15">
                  <Bell className="h-5 w-5 text-warning" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    你有 {pendingReminders} 条待处理提醒
                  </p>
                  <p className="text-xs text-muted-foreground">点击查看详情</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Hero — 本月应收 */}
      <Card className="rounded-2xl border-border">
        <CardContent className="p-5 md:p-6">
          <p className="text-xs text-muted-foreground tracking-wide font-medium">本月应收</p>
          <p className="num mt-1 text-foreground">
            <span className="text-2xl text-muted-faint font-medium mr-1">¥</span>
            <span className="text-4xl md:text-5xl font-bold tracking-tight">
              {Math.floor(totalReceivable).toLocaleString()}
            </span>
            <span className="text-lg text-muted-faint font-medium">
              .{String(Math.round((totalReceivable * 100) % 100)).padStart(2, "0")}
            </span>
          </p>
          <div className="mt-4 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2.5 flex justify-between text-sm">
            <span>
              <span className="text-muted-foreground">已收 </span>
              <span className="num font-semibold">{formatCurrency(totalReceived)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">待收 </span>
              <span className="num font-semibold">{formatCurrency(totalReceivable - totalReceived)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/properties">
          <Card className="hover:border-primary/30 transition-colors h-full">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">出租中</span>
                <Building2 className="h-4 w-4 text-muted-faint" />
              </div>
              <p className="num text-2xl font-bold mt-2 leading-none">{stats?.rentedCount ?? 0}</p>
              <p className="text-xs text-muted-faint mt-1.5">
                共 {(stats?.rentedCount ?? 0) + (stats?.vacantCount ?? 0)} 套房源
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/bills">
          <Card
            className={`hover:border-primary/30 transition-colors h-full ${
              (stats?.overdueCount ?? 0) > 0 ? "border-destructive/30" : ""
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  {(stats?.overdueCount ?? 0) > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  )}
                  逾期账单
                </span>
                <AlertCircle className="h-4 w-4 text-muted-faint" />
              </div>
              <p
                className={`num text-2xl font-bold mt-2 leading-none ${
                  (stats?.overdueCount ?? 0) > 0 ? "text-destructive" : ""
                }`}
              >
                {stats?.overdueCount ?? 0}
              </p>
              <p className="text-xs text-muted-faint mt-1.5">
                {(stats?.overdueCount ?? 0) > 0 ? "请尽快处理" : "暂无逾期"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 即将到期租约 */}
      {expiringLeases.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">即将到期</h2>
            <Link href="/leases" className="text-xs text-primary font-medium">查看全部 ›</Link>
          </div>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {expiringLeases.map((lease) => (
                <div key={lease.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-warning shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{(lease.property as { name: string } | undefined)?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">到期：{formatDate(lease.end_date)}</p>
                    </div>
                  </div>
                  <Badge variant="warning">即将到期</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* 最近账单 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">最近账单</h2>
          <Link href="/bills" className="text-xs text-primary font-medium">查看全部 ›</Link>
        </div>
        {recentBills.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无账单数据
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentBills.map((bill) => (
              <Card key={bill.id}>
                <CardContent className="px-4 py-3.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {formatDate(bill.period_start)} — {formatDate(bill.period_end)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">到期 {formatDate(bill.due_date)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="num text-sm font-semibold">{formatCurrency(bill.total_amount)}</span>
                    <Badge variant={(BILL_STATUS_COLORS[bill.status] as "warning" | "info" | "success" | "destructive") ?? "muted"}>
                      {BILL_STATUS_LABELS[bill.status]}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

