"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Building2, MoreVertical, Edit, Trash2, Loader2, MapPin, User, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { PropertyForm, type PropertyFormValues } from "@/components/forms/property-form";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { PROPERTY_STATUS_LABELS } from "@/types";
import type { Property } from "@/types";
import { canAddProperty, isProActive, PLAN_LIMITS } from "@/lib/subscription";
import { formatCurrency, formatDate } from "@/lib/format";
import { toast } from "sonner";

// 一套房源对应的"当前生效租约"摘要，列表卡片上展示用
interface ActiveLeaseSummary {
  id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  primary_tenant_name: string | null;
}

const STATUS_BADGE_VARIANTS: Record<string, "success" | "muted" | "warning"> = {
  rented: "success",
  vacant: "muted",
  renovating: "warning",
};

export default function PropertiesPage() {
  const { householdId, subscription, loading: userLoading } = useUser();
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  // 当前生效租约：property_id → 摘要。空置房源里没有 key。
  const [activeLeases, setActiveLeases] = useState<Record<string, ActiveLeaseSummary>>({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createClient();
  const freeLimit = PLAN_LIMITS.free.maxProperties;
  const isPro = isProActive(subscription);
  const canAdd = canAddProperty(subscription, properties.length);
  const reachingLimit = !isPro && properties.length >= freeLimit;

  const fetchProperties = async () => {
    if (!householdId) return;
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Property[];
    setProperties(list);

    // 一次性拉所有"生效中"的租约（含主租客名），前端按 property_id group
    // 同一房源理论上只能有 1 个 active 租约（UI 限制），这里取最新一条兜底
    if (list.length > 0) {
      const ids = list.map((p) => p.id);
      const { data: leaseRows } = await supabase
        .from("leases")
        .select(
          "id, property_id, start_date, end_date, monthly_rent, created_at, lease_tenants(is_primary, tenant:tenants(name))"
        )
        .in("property_id", ids)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      // supabase-js 把 1:N 关联返回为数组（即便只有一条），这里取第一个元素
      type LeaseRow = {
        id: string;
        property_id: string;
        start_date: string;
        end_date: string;
        monthly_rent: number;
        created_at: string;
        lease_tenants: Array<{
          is_primary: boolean;
          tenant: { name: string } | Array<{ name: string }> | null;
        }>;
      };
      const tenantName = (t: LeaseRow["lease_tenants"][number]["tenant"]): string | null => {
        if (!t) return null;
        if (Array.isArray(t)) return t[0]?.name ?? null;
        return t.name ?? null;
      };
      const map: Record<string, ActiveLeaseSummary> = {};
      for (const row of (leaseRows ?? []) as unknown as LeaseRow[]) {
        // order desc + 已存在 key 则跳过 → 保留最新一条
        if (map[row.property_id]) continue;
        const primaryLt = row.lease_tenants?.find((lt) => lt.is_primary) ?? row.lease_tenants?.[0];
        const primary = tenantName(primaryLt?.tenant ?? null);
        map[row.property_id] = {
          id: row.id,
          start_date: row.start_date,
          end_date: row.end_date,
          monthly_rent: row.monthly_rent,
          primary_tenant_name: primary,
        };
      }
      setActiveLeases(map);
    } else {
      setActiveLeases({});
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchProperties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleSubmit = async (values: PropertyFormValues) => {
    if (!householdId) return;

    const payload = {
      ...values,
      area: values.area === "" ? null : Number(values.area),
      household_id: householdId,
    };

    if (editing) {
      const { error } = await supabase
        .from("properties")
        .update(payload)
        .eq("id", editing.id);
      if (error) { toast.error("保存失败：" + error.message); return; }
      toast.success("房源已更新");
    } else {
      const { error } = await supabase.from("properties").insert(payload);
      if (error) { toast.error("添加失败：" + error.message); return; }
      toast.success("房源已添加");
    }

    setFormOpen(false);
    setEditing(null);
    fetchProperties();
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    // 检查是否有进行中租约
    const { data: activeLeases } = await supabase
      .from("leases")
      .select("id")
      .eq("property_id", deletingId)
      .eq("status", "active")
      .is("deleted_at", null);

    if (activeLeases && activeLeases.length > 0) {
      toast.error("该房源有进行中的租约，无法删除。请先退租后再操作。");
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("properties")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deletingId);

    if (error) { toast.error("删除失败"); }
    else { toast.success("房源已删除"); fetchProperties(); }
    setDeletingId(null);
  };

  const openEdit = (p: Property) => { setEditing(p); setFormOpen(true); };
  const openAdd = () => {
    if (!canAdd) {
      toast.warning(`免费版仅限 ${freeLimit} 套房源，升级 Pro 解锁无限`, {
        action: {
          label: "查看 Pro",
          onClick: () => router.push("/subscription"),
        },
      });
      return;
    }
    setEditing(null);
    setFormOpen(true);
  };

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
          <h1 className="text-xl font-bold">房源管理</h1>
          <p className="text-sm text-muted-foreground">
            {isPro
              ? `共 ${properties.length} 套房源`
              : `已用 ${properties.length} / ${freeLimit} 套（免费版）`}
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" />
          添加房源
        </Button>
      </div>

      {reachingLimit && (
        <div className="mb-4">
          <UpgradePrompt
            title="免费版房源已达上限"
            description="升级 Pro 解锁无限房源 · 早鸟年卡 ¥69 仅前 100 名"
            ctaLabel="查看 Pro 详情"
            compact
          />
        </div>
      )}

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="还没有房源"
          description="添加您的第一套出租房源，开始管理之旅"
          action={
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" />
              添加房源
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {properties.map((property) => {
            const lease = activeLeases[property.id];
            return (
            <Card key={property.id} className="group hover:border-primary/30 transition-colors relative">
              <Link href={`/properties/${property.id}`} className="block">
                <CardContent className="pt-4 pr-12">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate">{property.name}</h3>
                        {property.layout && (
                          <p className="text-xs text-muted-foreground">{property.layout}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANTS[property.status]} className="ml-2 shrink-0">
                      {PROPERTY_STATUS_LABELS[property.status]}
                    </Badge>
                  </div>

                  <div className="flex items-start gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{property.address}</span>
                  </div>

                  {(property.area || property.city || property.district) && (
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {property.area && <span>{property.area} ㎡</span>}
                      {(property.district || property.city) && (
                        <span>
                          {property.district}
                          {property.district && property.city ? " · " : ""}
                          {property.city}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 当前生效租约信息（仅出租中房源显示） */}
                  {lease ? (
                    <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs text-foreground min-w-0">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {lease.primary_tenant_name ?? "未填写租客"}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-primary shrink-0">
                          {formatCurrency(lease.monthly_rent)}
                          <span className="text-[11px] font-normal text-muted-foreground">/月</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {formatDate(lease.start_date)} — {formatDate(lease.end_date)}
                        </span>
                      </div>
                    </div>
                  ) : property.status === "rented" ? (
                    <div className="mt-3 pt-3 border-t border-border/60">
                      <p className="text-xs text-muted-foreground">暂无生效租约，可去「租约」页添加</p>
                    </div>
                  ) : null}

                  {property.notes && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-1">{property.notes}</p>
                  )}
                </CardContent>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-2 h-7 w-7 z-10"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(property)}>
                    <Edit className="mr-2 h-4 w-4" />
                    编辑
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeletingId(property.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
            );
          })}
        </div>
      )}

      {/* 添加/编辑弹窗 */}
      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑房源" : "添加房源"}</DialogTitle>
          </DialogHeader>
          <PropertyForm
            defaultValues={editing ?? undefined}
            onSubmit={handleSubmit}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除房源？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后房源将从列表中隐藏。如果该房源有进行中的租约，将无法删除。
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
