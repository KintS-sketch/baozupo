"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Gauge, Loader2, Trash2, Zap, Droplet, Flame, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { MeterForm, type MeterFormSubmit } from "@/components/forms/meter-form";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { METER_TYPE_LABELS, METER_TYPE_UNITS } from "@/types";
import type { MeterReading, MeterType, Property } from "@/types";
import { toast } from "sonner";

type MeterReadingWithProperty = MeterReading & {
  property: { name: string } | null;
};

const TYPE_ICONS: Record<MeterType, typeof Zap> = {
  electricity: Zap,
  water: Droplet,
  gas: Flame,
};

const TYPE_BG: Record<MeterType, string> = {
  electricity: "bg-amber-50 text-amber-600",
  water: "bg-sky-50 text-sky-600",
  gas: "bg-orange-50 text-orange-600",
};

export default function MetersPage() {
  const { householdId, loading: userLoading } = useUser();
  const [readings, setReadings] = useState<MeterReadingWithProperty[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | MeterType>("all");

  const supabase = createClient();

  const fetchData = async () => {
    if (!householdId) return;

    const propsResp = await supabase
      .from("properties")
      .select("*")
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const propList = (propsResp.data ?? []) as Property[];
    setProperties(propList);

    if (propList.length === 0) {
      setReadings([]);
      setLoading(false);
      return;
    }

    const propIds = propList.map((p) => p.id);
    const { data, error } = await supabase
      .from("meter_readings")
      .select("*, property:properties(name)")
      .in("property_id", propIds)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (!error) setReadings((data ?? []) as MeterReadingWithProperty[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const getLastReading = async (propertyId: string, type: MeterType): Promise<number | null> => {
    const { data } = await supabase
      .from("meter_readings")
      .select("value")
      .eq("property_id", propertyId)
      .eq("type", type)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return Number(data.value);
  };

  const handleSubmit = async (values: MeterFormSubmit) => {
    const { error } = await supabase.from("meter_readings").insert({
      property_id: values.property_id,
      type: values.type,
      reading_date: values.reading_date,
      value: values.value,
      previous_value: values.previous_value,
      unit_price: values.unit_price,
      usage: values.usage,
      amount: values.amount,
      notes: values.notes,
    });

    if (error) {
      toast.error("保存抄表失败：" + error.message);
      return;
    }

    toast.success("抄表已保存");
    setFormOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const { error } = await supabase.from("meter_readings").delete().eq("id", deletingId);
    if (error) {
      toast.error("删除失败");
    } else {
      toast.success("抄表已删除");
      fetchData();
    }
    setDeletingId(null);
  };

  const filtered = useMemo(
    () => (typeFilter === "all" ? readings : readings.filter((r) => r.type === typeFilter)),
    [readings, typeFilter]
  );

  // 统计本月各类总金额
  const monthStats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const result: Record<MeterType, number> = { electricity: 0, water: 0, gas: 0 };
    for (const r of readings) {
      if (r.reading_date.startsWith(ym) && r.amount !== null) {
        result[r.type] += Number(r.amount);
      }
    }
    return result;
  }, [readings]);

  const counts = readings.reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
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
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">抄表记录</h1>
          <p className="text-sm text-muted-foreground">共 {readings.length} 条</p>
        </div>
        <Button onClick={() => setFormOpen(true)} disabled={properties.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
          新增抄表
        </Button>
      </div>

      {/* 本月费用汇总 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <MonthCard type="electricity" amount={monthStats.electricity} />
        <MonthCard type="water" amount={monthStats.water} />
        <MonthCard type="gas" amount={monthStats.gas} />
      </div>

      <Tabs
        value={typeFilter}
        onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
        className="mb-4"
      >
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">全部 ({readings.length})</TabsTrigger>
          <TabsTrigger value="electricity">电 ({counts.electricity ?? 0})</TabsTrigger>
          <TabsTrigger value="water">水 ({counts.water ?? 0})</TabsTrigger>
          <TabsTrigger value="gas">燃气 ({counts.gas ?? 0})</TabsTrigger>
        </TabsList>
      </Tabs>

      {properties.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="还没有房源"
          description="抄表前需要先添加房源"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={typeFilter === "all" ? "还没有抄表记录" : "该类型暂无记录"}
          description={typeFilter === "all" ? "记录每月水电燃气读数，自动算费" : undefined}
          action={
            typeFilter === "all" ? (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                新增抄表
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReadingCard key={r.id} reading={r} onDelete={() => setDeletingId(r.id)} />
          ))}
        </div>
      )}

      {/* 新增抄表弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增抄表</DialogTitle>
          </DialogHeader>
          <MeterForm
            properties={properties}
            getLastReading={getLastReading}
            onSubmit={handleSubmit}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => { if (!o) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条抄表？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复。如果该读数已被作为下次抄表的「上次读数」，建议保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MonthCard({ type, amount }: { type: MeterType; amount: number }) {
  const Icon = TYPE_ICONS[type];
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${TYPE_BG[type]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-xs text-muted-foreground">本月{METER_TYPE_LABELS[type]}费</span>
        </div>
        <p className="text-base font-bold">{formatCurrency(amount)}</p>
      </CardContent>
    </Card>
  );
}

function ReadingCard({
  reading,
  onDelete,
}: {
  reading: MeterReadingWithProperty;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICONS[reading.type];
  const unit = METER_TYPE_UNITS[reading.type];
  const usage = reading.usage === null ? null : Number(reading.usage);
  const amount = reading.amount === null ? null : Number(reading.amount);

  return (
    <Card className="group hover:border-primary/30 transition-colors">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TYPE_BG[reading.type]}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-sm truncate">
                  {reading.property?.name ?? "—"}
                </span>
                <Badge variant="muted">{METER_TYPE_LABELS[reading.type]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(reading.reading_date)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                读数 {Number(reading.value)} {unit}
                {reading.previous_value !== null && (
                  <span className="text-muted-foreground/70">
                    {" "}（上次 {Number(reading.previous_value)}）
                  </span>
                )}
              </p>
              {reading.notes && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{reading.notes}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="text-right">
              {usage !== null && (
                <p className="text-xs text-muted-foreground">
                  用量 {usage} {unit}
                </p>
              )}
              {amount !== null && (
                <p className="text-sm font-bold">{formatCurrency(amount)}</p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
