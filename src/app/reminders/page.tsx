"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Loader2,
  Check,
  X,
  CalendarClock,
  AlertCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatDate } from "@/lib/format";
import { ensureReminders } from "@/lib/reminders-service";
import { REMINDER_TYPE_LABELS } from "@/types";
import type { Reminder, ReminderType } from "@/types";
import { toast } from "sonner";

const TYPE_VARIANTS: Record<ReminderType, "warning" | "info" | "muted" | "success"> = {
  rent_due: "warning",
  lease_expiry: "info",
  meter_reading: "muted",
  custom: "muted",
};

const RELATED_LINKS: Record<string, string> = {
  bill: "/bills",
  lease: "/leases",
  property: "/properties",
};

export default function RemindersPage() {
  const { householdId, loading: userLoading } = useUser();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<"pending" | "dismissed">("pending");

  const supabase = createClient();

  const fetchReminders = async () => {
    if (!householdId) return;
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .eq("household_id", householdId)
      .order("remind_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (!error) setReminders((data ?? []) as Reminder[]);
    setLoading(false);
  };

  const generate = async () => {
    if (!householdId) return;
    setGenerating(true);
    try {
      const { inserted } = await ensureReminders(householdId);
      if (inserted > 0) {
        toast.success(`新增 ${inserted} 条提醒`);
      } else {
        toast.info("暂无新的提醒");
      }
      fetchReminders();
    } catch (err) {
      console.error(err);
      toast.error("生成提醒失败");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (userLoading || !householdId) return;
    (async () => {
      // 加载页面时静默生成一次（不打扰用户）
      try {
        await ensureReminders(householdId);
      } catch (err) {
        console.error("[reminders] auto generate failed:", err);
      }
      fetchReminders();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleDismiss = async (id: string) => {
    const { error } = await supabase
      .from("reminders")
      .update({ is_dismissed: true })
      .eq("id", id);
    if (error) {
      toast.error("操作失败");
      return;
    }
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_dismissed: true } : r))
    );
  };

  const handleRestore = async (id: string) => {
    const { error } = await supabase
      .from("reminders")
      .update({ is_dismissed: false })
      .eq("id", id);
    if (error) {
      toast.error("操作失败");
      return;
    }
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_dismissed: false } : r))
    );
  };

  const dismissAllPending = async () => {
    if (!householdId) return;
    const ids = reminders.filter((r) => !r.is_dismissed).map((r) => r.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("reminders")
      .update({ is_dismissed: true })
      .in("id", ids);
    if (error) {
      toast.error("操作失败");
      return;
    }
    setReminders((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, is_dismissed: true } : r)));
    toast.success(`已忽略 ${ids.length} 条`);
  };

  const pending = useMemo(() => reminders.filter((r) => !r.is_dismissed), [reminders]);
  const dismissed = useMemo(() => reminders.filter((r) => r.is_dismissed), [reminders]);
  const list = tab === "pending" ? pending : dismissed;

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">提醒中心</h1>
          <p className="text-sm text-muted-foreground">
            待处理 {pending.length} · 已处理 {dismissed.length}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            刷新提醒
          </Button>
          {tab === "pending" && pending.length > 0 && (
            <Button variant="outline" size="sm" onClick={dismissAllPending}>
              <Check className="h-4 w-4 mr-1" />
              全部忽略
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending">待处理 ({pending.length})</TabsTrigger>
          <TabsTrigger value="dismissed">已处理 ({dismissed.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {list.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={tab === "pending" ? "暂无待处理提醒" : "暂无已处理提醒"}
          description={
            tab === "pending"
              ? "系统会在有租金到期、合同到期等情况时自动生成提醒"
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              onDismiss={() => handleDismiss(r.id)}
              onRestore={() => handleRestore(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderCard({
  reminder,
  onDismiss,
  onRestore,
}: {
  reminder: Reminder;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  const isOverdue = reminder.type === "rent_due" && reminder.title.includes("逾期");
  const TypeIcon = isOverdue ? AlertCircle : CalendarClock;
  const linkBase = reminder.related_type ? RELATED_LINKS[reminder.related_type] : null;

  return (
    <Card
      className={
        reminder.is_dismissed
          ? "opacity-60"
          : isOverdue
          ? "border-red-200"
          : "hover:border-primary/30 transition-colors"
      }
    >
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isOverdue ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary"
            }`}
          >
            <TypeIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm">{reminder.title}</span>
              <Badge variant={TYPE_VARIANTS[reminder.type]}>
                {REMINDER_TYPE_LABELS[reminder.type]}
              </Badge>
            </div>
            {reminder.content && (
              <p className="text-xs text-muted-foreground">{reminder.content}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              提醒日：{formatDate(reminder.remind_at)}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {linkBase && (
                <Link href={linkBase}>
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    <ExternalLink className="h-3 w-3 mr-1" />
                    查看{reminder.related_type === "bill" ? "账单" : "租约"}
                  </Button>
                </Link>
              )}
              {reminder.is_dismissed ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRestore}>
                  恢复
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
                  <X className="h-3 w-3 mr-1" />
                  忽略
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
