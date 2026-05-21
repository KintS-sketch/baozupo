"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit,
  Loader2,
  FileText,
  Receipt,
  Gauge,
  Zap,
  Droplet,
  Flame,
  Plus,
  Paperclip,
  ExternalLink,
  Trash2,
} from "lucide-react";

/** 字段为空（null/undefined/空串/"null"/"NULL"）时显示"未填写" */
function safeText(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "未填写";
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return "未填写";
  return s;
}
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyForm, type PropertyFormValues } from "@/components/forms/property-form";
import { ContractUpload } from "@/components/contract-upload";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  PROPERTY_STATUS_LABELS,
  LEASE_STATUS_LABELS,
  BILL_STATUS_LABELS,
  METER_TYPE_LABELS,
  METER_TYPE_UNITS,
} from "@/types";
import type {
  Property,
  Lease,
  Bill,
  MeterReading,
  MeterType,
} from "@/types";
import { toast } from "sonner";

const STATUS_BADGE_VARIANTS: Record<string, "success" | "muted" | "warning"> = {
  rented: "success",
  vacant: "muted",
  renovating: "warning",
};

const BILL_BADGE: Record<string, "warning" | "info" | "success" | "destructive"> = {
  pending: "warning",
  partial: "info",
  paid: "success",
  overdue: "destructive",
};

const METER_ICON: Record<MeterType, typeof Zap> = {
  electricity: Zap,
  water: Droplet,
  gas: Flame,
};

const METER_BG: Record<MeterType, string> = {
  electricity: "bg-amber-50 text-amber-600",
  water: "bg-sky-50 text-sky-600",
  gas: "bg-orange-50 text-orange-600",
};

type LeaseWithTenant = Lease & {
  lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } }>;
};

type AttachmentRow = {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  entity_type: string;
};

export default function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { householdId, loading: userLoading } = useUser();

  const [property, setProperty] = useState<Property | null>(null);
  const [leases, setLeases] = useState<LeaseWithTenant[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deletingAttachment, setDeletingAttachment] = useState<AttachmentRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const supabase = createClient();

  const handleDeleteAttachment = async () => {
    if (!deletingAttachment) return;
    setDeletingBusy(true);
    try {
      const { error: storageErr } = await supabase.storage
        .from("contracts")
        .remove([deletingAttachment.file_url]);
      if (storageErr && !storageErr.message?.toLowerCase().includes("not found")) {
        toast.error(`Storage 删除失败：${storageErr.message}`);
        return;
      }
      const { error: dbErr } = await supabase
        .from("attachments")
        .delete()
        .eq("id", deletingAttachment.id);
      if (dbErr) {
        toast.error(`记录删除失败：${dbErr.message}`);
        return;
      }
      toast.success("已删除");
      setDeletingAttachment(null);
      fetchAll();
    } finally {
      setDeletingBusy(false);
    }
  };

  const fetchAll = async () => {
    if (!householdId) return;

    // 房源
    const { data: propData, error: propErr } = await supabase
      .from("properties")
      .select("*")
      .eq("id", id)
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .maybeSingle();
    if (propErr || !propData) {
      toast.error("找不到该房源");
      setLoading(false);
      return;
    }
    setProperty(propData as Property);

    // 该房源的所有租约（含租客）
    const { data: leaseData } = await supabase
      .from("leases")
      .select("*, lease_tenants(is_primary, tenant:tenants(name))")
      .eq("property_id", id)
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .order("start_date", { ascending: false });
    const leaseList = (leaseData ?? []) as LeaseWithTenant[];
    setLeases(leaseList);

    // 这些租约的所有账单
    const leaseIds = leaseList.map((l) => l.id);
    if (leaseIds.length > 0) {
      const { data: billData } = await supabase
        .from("bills")
        .select("*")
        .in("lease_id", leaseIds)
        .order("due_date", { ascending: false })
        .limit(20);
      setBills((billData ?? []) as Bill[]);
    } else {
      setBills([]);
    }

    // 抄表记录
    const { data: meterData } = await supabase
      .from("meter_readings")
      .select("*")
      .eq("property_id", id)
      .order("reading_date", { ascending: false })
      .limit(20);
    setMeterReadings((meterData ?? []) as MeterReading[]);

    // 附件（合同等）— 查 entity_type='property' 或 'lease' (该房源的租约)
    const entityIds = [id, ...leaseIds];
    const { data: attData } = await supabase
      .from("attachments")
      .select("id, file_name, file_url, file_size, mime_type, created_at, entity_type")
      .in("entity_id", entityIds)
      .in("entity_type", ["property", "lease"])
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });
    const atts = (attData ?? []) as AttachmentRow[];
    setAttachments(atts);

    // 批量生成 1 小时有效的 signed URL（bucket 是 private 的）
    if (atts.length > 0) {
      const paths = atts.map((a) => a.file_url);
      const { data: signed } = await supabase.storage
        .from("contracts")
        .createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, idx) => {
        if (s.signedUrl) map[atts[idx].id] = s.signedUrl;
      });
      setSignedUrls(map);
    } else {
      setSignedUrls({});
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading, id]);

  const handleEditSubmit = async (values: PropertyFormValues) => {
    const payload = {
      ...values,
      area: values.area === "" ? null : Number(values.area),
    };
    const { error } = await supabase.from("properties").update(payload).eq("id", id);
    if (error) {
      toast.error("保存失败");
      return;
    }
    toast.success("已保存");
    setEditOpen(false);
    fetchAll();
  };

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="p-4 md:p-6 max-w-2xl">
        <Button variant="ghost" size="sm" onClick={() => router.push("/properties")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回房源列表
        </Button>
        <p className="mt-8 text-center text-muted-foreground">房源不存在或已被删除</p>
      </div>
    );
  }

  const activeLease = leases.find((l) => l.status === "active");
  const getPrimaryTenant = (lease: LeaseWithTenant) =>
    lease.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.name ??
    lease.lease_tenants?.[0]?.tenant?.name ??
    "—";

  // 当期账单 = 严格按 payment_cycle 的"现在这一期"，月付就 1 张这月、年付就 1 张这年。
  // 加上已过期但未付清的（逾期/部分付）。未来的 pending 不显示。
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const currentBills = bills.filter((b) => {
    const s = new Date(b.period_start);
    const e = new Date(b.period_end);
    if (todayDate >= s && todayDate <= e) return true; // 今天在期间内
    if (todayDate > e && b.status !== "paid") return true; // 已逾期未付清
    return false;
  });

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5 pb-20">
      {/* 顶部 */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties")}
          className="-ml-2 mb-2 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          房源列表
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{property.name}</h1>
              <Badge variant={STATUS_BADGE_VARIANTS[property.status]}>
                {PROPERTY_STATUS_LABELS[property.status]}
              </Badge>
            </div>
            {/* 地址已搬到下方"基本信息"卡片，避免表头重复 */}
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit className="h-4 w-4 mr-1" />
            编辑
          </Button>
        </div>
      </div>

      {/* 基本信息 — 所有字段无条件显示，未填写显示"未填写" */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
          <span className="text-muted-foreground">地址</span>
          <span>{safeText(property.address)}</span>

          <span className="text-muted-foreground">省</span>
          <span className={safeText(property.district) === "未填写" ? "text-muted-foreground" : ""}>
            {safeText(property.district)}
          </span>

          <span className="text-muted-foreground">城市</span>
          <span className={safeText(property.city) === "未填写" ? "text-muted-foreground" : ""}>
            {safeText(property.city)}
          </span>

          <span className="text-muted-foreground">户型</span>
          <span className={safeText(property.layout) === "未填写" ? "text-muted-foreground" : ""}>
            {safeText(property.layout)}
          </span>

          <span className="text-muted-foreground">面积</span>
          <span className={safeText(property.area) === "未填写" ? "text-muted-foreground" : ""}>
            {safeText(property.area) === "未填写" ? "未填写" : `${property.area} ㎡`}
          </span>

          {property.notes && (
            <>
              <span className="text-muted-foreground col-span-2 mt-2">备注</span>
              <span className="col-span-2 text-xs bg-muted rounded p-2">{property.notes}</span>
            </>
          )}
        </CardContent>
      </Card>

      {/* 当前租约 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            当前租约
          </h2>
          <Link href="/leases" className="text-xs text-primary font-medium">
            全部租约 ›
          </Link>
        </div>
        {activeLease ? (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">{getPrimaryTenant(activeLease)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(activeLease.start_date)} — {formatDate(activeLease.end_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">
                    {formatCurrency(activeLease.monthly_rent)}
                    <span className="text-xs font-normal text-muted-foreground">/月</span>
                  </p>
                  <Badge variant="success" className="mt-1">
                    {LEASE_STATUS_LABELS[activeLease.status]}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              暂无生效租约
              <div className="mt-2">
                <Link href="/leases">
                  <Button variant="outline" size="sm">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    去创建租约
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 抄表记录 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            抄表记录
            <span className="text-xs text-muted-foreground font-normal">
              （最近 {meterReadings.length} 条）
            </span>
          </h2>
          <Link href="/meters" className="text-xs text-primary font-medium">
            去抄表 ›
          </Link>
        </div>
        {meterReadings.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              还没有抄表记录
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {meterReadings.slice(0, 5).map((r) => {
                const Icon = METER_ICON[r.type];
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${METER_BG[r.type]}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {METER_TYPE_LABELS[r.type]} · {formatDate(r.reading_date)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.previous_value != null ? `${r.previous_value} → ` : ""}
                        {r.value} {METER_TYPE_UNITS[r.type]}
                        {r.usage != null && (
                          <span className="ml-2 text-foreground font-medium">
                            用量 {r.usage}
                          </span>
                        )}
                      </p>
                    </div>
                    {r.amount != null && r.amount > 0 && (
                      <span className="num text-sm font-semibold">{formatCurrency(r.amount)}</span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 账单 — 只显示当期 + 未付清，避免铺 12 期。历史在租约详情/全部账单看 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            当期账单
            <span className="text-xs text-muted-foreground font-normal">
              （{currentBills.length} 张需要关注 · 共 {bills.length} 期）
            </span>
          </h2>
          <Link href="/bills" className="text-xs text-primary font-medium">
            全部账单 ›
          </Link>
        </div>
        {bills.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              暂无账单数据
            </CardContent>
          </Card>
        ) : currentBills.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              本期账单已收齐，可在「全部账单」查看历史
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {currentBills.map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {formatDate(b.period_start)} — {formatDate(b.period_end)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      到期 {formatDate(b.due_date)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="num text-sm font-semibold">{formatCurrency(b.total_amount)}</span>
                    <Badge variant={BILL_BADGE[b.status] ?? "muted"}>
                      {BILL_STATUS_LABELS[b.status]}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 合同 / 附件 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            合同 / 附件
          </h2>
        </div>

        <ContractUpload
          propertyId={id}
          leaseOptions={leases
            .filter((l) => l.status === "active")
            .map((l) => ({
              id: l.id,
              label: `${formatDate(l.start_date)} 起 · ${getPrimaryTenant(l)}`,
            }))}
          onUploaded={fetchAll}
        />

        {attachments.length > 0 && (
          <Card className="mt-3">
            <CardContent className="divide-y divide-border p-0">
              {attachments.map((a) => {
                const href = signedUrls[a.id];
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Paperclip className="h-4 w-4" />
                    </div>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 flex items-center gap-2 group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:underline">
                            {a.file_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.entity_type === "lease" ? "租约附件" : "房源附件"} ·{" "}
                            {formatDate(a.created_at)}
                          </p>
                        </div>
                        <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                      </a>
                    ) : (
                      <div
                        className="flex-1 min-w-0 opacity-60"
                        title="链接生成失败，刷新页面重试"
                      >
                        <p className="text-sm font-medium truncate">{a.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.entity_type === "lease" ? "租约附件" : "房源附件"} ·{" "}
                          {formatDate(a.created_at)}
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeletingAttachment(a)}
                      className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="删除附件"
                      aria-label="删除附件"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 删除附件确认弹窗 */}
      <AlertDialog
        open={deletingAttachment !== null}
        onOpenChange={(open) => {
          if (!open && !deletingBusy) setDeletingAttachment(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除附件？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 <strong>{deletingAttachment?.file_name}</strong>，包括云端存储的文件。
              此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAttachment}
              disabled={deletingBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑房源</DialogTitle>
          </DialogHeader>
          <PropertyForm
            defaultValues={property}
            onSubmit={handleEditSubmit}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
