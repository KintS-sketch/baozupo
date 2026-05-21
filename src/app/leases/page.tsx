"use client";

import { useEffect, useState } from "react";
import { Plus, FileText, MoreVertical, Edit, Loader2, Eye, Trash2, Paperclip, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContractUpload } from "@/components/contract-upload";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { LeaseForm, type LeaseFormValues, type LeaseFormExtras } from "@/components/forms/lease-form";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { LEASE_STATUS_LABELS, PAYMENT_CYCLE_LABELS, BILLING_MODE_LABELS, BILL_STATUS_LABELS } from "@/types";
import type { Lease, LeaseStatus, BillStatus } from "@/types";
import { generateBillPeriods, calculateBillStatus } from "@/lib/billing";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_BADGE: Record<LeaseStatus, "success" | "muted" | "destructive"> = {
  active: "success",
  expired: "muted",
  terminated: "destructive",
};

// 「交付情况」里给账单按状态上色
const BILL_BADGE: Record<BillStatus, "warning" | "info" | "success" | "destructive"> = {
  pending: "warning",
  partial: "info",
  paid: "success",
  overdue: "destructive",
};

// 同结构 BillRow 用于「交付情况」拉数据
interface LeaseBillRow {
  id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  status: BillStatus;
}

type LeaseWithRelations = Lease & {
  property: { name: string };
  lease_tenants: Array<{ is_primary: boolean; tenant: { id: string; name: string } }>;
  attachment_count?: number;
};

export default function LeasesPage() {
  const { householdId, loading: userLoading } = useUser();
  const [leases, setLeases] = useState<LeaseWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<LeaseWithRelations | null>(null);
  const [viewing, setViewing] = useState<LeaseWithRelations | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | LeaseStatus>("all");
  const [leaseAttachments, setLeaseAttachments] = useState<Array<{ id: string; file_name: string; file_url: string; created_at: string }>>([]);
  const [leaseSignedUrls, setLeaseSignedUrls] = useState<Record<string, string>>({});
  // 当前查看的租约的「交付情况」账单列表
  const [leaseBills, setLeaseBills] = useState<LeaseBillRow[]>([]);

  const supabase = createClient();

  const fetchLeaseAttachments = async (leaseId: string) => {
    const { data } = await supabase
      .from("attachments")
      .select("id, file_name, file_url, created_at")
      .eq("entity_type", "lease")
      .eq("entity_id", leaseId)
      .order("created_at", { ascending: false });
    const atts = (data ?? []) as Array<{ id: string; file_name: string; file_url: string; created_at: string }>;
    setLeaseAttachments(atts);
    if (atts.length > 0) {
      const { data: signed } = await supabase.storage
        .from("contracts")
        .createSignedUrls(atts.map((a) => a.file_url), 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, idx) => {
        if (s.signedUrl) map[atts[idx].id] = s.signedUrl;
      });
      setLeaseSignedUrls(map);
    } else {
      setLeaseSignedUrls({});
    }
  };

  const fetchLeaseBills = async (leaseId: string) => {
    const { data } = await supabase
      .from("bills")
      .select("id, period_start, period_end, due_date, total_amount, paid_amount, status")
      .eq("lease_id", leaseId)
      .order("period_start", { ascending: true });
    setLeaseBills((data ?? []) as LeaseBillRow[]);
  };

  const openDetail = (lease: LeaseWithRelations) => {
    setViewing(lease);
    setDetailOpen(true);
    setLeaseBills([]);
    fetchLeaseAttachments(lease.id);
    fetchLeaseBills(lease.id);
  };

  const fetchLeases = async () => {
    if (!householdId) return;
    const { data, error } = await supabase
      .from("leases")
      .select("*, property:properties(name), lease_tenants(is_primary, tenant:tenants(id, name))")
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setLoading(false);
      return;
    }
    const leasesList = (data ?? []) as LeaseWithRelations[];

    // 同步拉每个 lease 的合同附件数量（单次 query 后前端 group）
    if (leasesList.length > 0) {
      const leaseIds = leasesList.map((l) => l.id);
      const { data: attData } = await supabase
        .from("attachments")
        .select("entity_id")
        .eq("household_id", householdId)
        .eq("entity_type", "lease")
        .in("entity_id", leaseIds);
      const counts = new Map<string, number>();
      for (const a of (attData ?? []) as Array<{ entity_id: string }>) {
        counts.set(a.entity_id, (counts.get(a.entity_id) ?? 0) + 1);
      }
      for (const lease of leasesList) {
        lease.attachment_count = counts.get(lease.id) ?? 0;
      }
    }

    setLeases(leasesList);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchLeases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleSubmit = async (values: LeaseFormValues, extras: LeaseFormExtras) => {
    if (!householdId) return;

    // 把表单字段拆开：lease 表用的 + 仅前端用的（tenant_mode/new_tenant_* / generate_bills）
    const {
      tenant_id: pickedTenantId,
      tenant_mode,
      new_tenant_name,
      new_tenant_phone,
      new_tenant_id_number,
      generate_bills,
      agent_fee,
      ...leaseRest
    } = values;

    // 中介费 "" → null
    const normalizedAgentFee =
      agent_fee === "" || agent_fee === undefined || agent_fee === null
        ? null
        : Number(agent_fee);

    // 直租时清空中介字段，避免 UI 切换后残留脏数据
    const payload = {
      ...leaseRest,
      household_id: householdId,
      agent_name: leaseRest.rental_source === "agent" ? leaseRest.agent_name ?? null : null,
      agent_phone: leaseRest.rental_source === "agent" ? leaseRest.agent_phone ?? null : null,
      agent_fee: leaseRest.rental_source === "agent" ? normalizedAgentFee : null,
    };

    if (editing) {
      const { error } = await supabase.from("leases").update(payload).eq("id", editing.id);
      if (error) { toast.error("保存失败"); return; }
      // 编辑时如果换了主租客，更新 lease_tenants
      if (pickedTenantId) {
        const currentPrimary = editing.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.id;
        if (currentPrimary !== pickedTenantId) {
          await supabase.from("lease_tenants").delete().eq("lease_id", editing.id);
          await supabase.from("lease_tenants").insert({
            lease_id: editing.id,
            tenant_id: pickedTenantId,
            is_primary: true,
          });
        }
      }
      toast.success("租约已更新");
    } else {
      // 新增模式：如果选了"新增租客"，先 create tenant 拿 id
      let tenant_id = pickedTenantId ?? "";
      if (tenant_mode === "new" && extras.newTenant) {
        const { data: newTenant, error: tErr } = await supabase
          .from("tenants")
          .insert({
            household_id: householdId,
            name: extras.newTenant.name,
            phone: extras.newTenant.phone,
            id_type: "id_card",
            id_number: extras.newTenant.id_number ?? null,
          })
          .select("id")
          .single();
        if (tErr || !newTenant) {
          toast.error("创建租客失败：" + (tErr?.message ?? "未知"));
          return;
        }
        tenant_id = newTenant.id;
      }

      if (!tenant_id) {
        toast.error("请填写或选择主租客");
        return;
      }

      const { data: newLease, error } = await supabase.from("leases").insert(payload).select().single();
      if (error || !newLease) { toast.error("创建失败：" + error?.message); return; }

      // 关联租客
      await supabase.from("lease_tenants").insert({
        lease_id: newLease.id,
        tenant_id,
        is_primary: true,
      });

      // 更新房源状态为出租中
      await supabase.from("properties").update({ status: "rented" }).eq("id", values.property_id);

      // 上传合同附件（如有）
      let contractUploaded = false;
      if (extras.contractFile) {
        const file = extras.contractFile;
        const safeName = file.name.replace(/[^\w.\-一-龥]/g, "_");
        const objectPath = `${householdId}/${newLease.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("contracts")
          .upload(objectPath, file, { upsert: false, contentType: file.type });
        if (upErr) {
          toast.warning(`租约已创建，但合同上传失败：${upErr.message}`);
        } else {
          const { error: insertErr } = await supabase.from("attachments").insert({
            household_id: householdId,
            entity_type: "lease",
            entity_id: newLease.id,
            file_name: file.name,
            file_url: objectPath,
            file_size: file.size,
            mime_type: file.type || null,
          });
          if (insertErr) {
            toast.warning(`合同已上传但记录失败：${insertErr.message}`);
          } else {
            contractUploaded = true;
          }
        }
      }

      // 自动生成账单
      let billsCreated = 0;
      if (generate_bills) {
        const periods = generateBillPeriods(
          new Date(values.start_date),
          new Date(values.end_date),
          values.monthly_rent,
          values.billing_mode,
          values.rent_due_day
        );
        const today = new Date();
        const billRows = periods.map((p) => ({
          lease_id: newLease.id,
          period_start: format(p.periodStart, "yyyy-MM-dd"),
          period_end: format(p.periodEnd, "yyyy-MM-dd"),
          days_in_period: p.daysInPeriod,
          ratio: p.ratio,
          due_date: format(p.dueDate, "yyyy-MM-dd"),
          rent_amount: p.rentAmount,
          utility_amount: 0,
          other_amount: 0,
          total_amount: p.rentAmount,
          paid_amount: 0,
          status: calculateBillStatus(p.rentAmount, 0, p.dueDate, today),
        }));
        const { error: billsErr } = await supabase.from("bills").insert(billRows);
        if (billsErr) {
          toast.error(`租约已创建，但账单生成失败：${billsErr.message}`);
        } else {
          billsCreated = billRows.length;
        }
      }

      const parts = ["租约已创建"];
      if (billsCreated > 0) parts.push(`生成 ${billsCreated} 期账单`);
      if (contractUploaded) parts.push("合同已上传");
      toast.success(parts.join("，"));
    }

    setFormOpen(false);
    setEditing(null);
    fetchLeases();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const target = leases.find((l) => l.id === deletingId);
    const { error } = await supabase
      .from("leases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deletingId);
    if (error) {
      toast.error(`删除失败：${error.message}`);
    } else {
      // 如果该租约对应的房源没有其他生效租约，把房源状态改回空置
      if (target?.property_id) {
        const { data: otherActive } = await supabase
          .from("leases")
          .select("id")
          .eq("property_id", target.property_id)
          .eq("status", "active")
          .is("deleted_at", null)
          .neq("id", deletingId)
          .limit(1);
        if (!otherActive || otherActive.length === 0) {
          await supabase.from("properties").update({ status: "vacant" }).eq("id", target.property_id);
        }
      }
      toast.success("租约已删除");
      fetchLeases();
    }
    setDeletingId(null);
  };

  const handleTerminate = async (lease: LeaseWithRelations) => {
    const { error } = await supabase
      .from("leases")
      .update({ status: "terminated" })
      .eq("id", lease.id);

    if (!error) {
      // 更新房源状态为空置
      await supabase.from("properties").update({ status: "vacant" }).eq("id", lease.property_id);
      toast.success("租约已归档，房源已改回空置");
      fetchLeases();
    } else {
      toast.error("操作失败");
    }
  };

  const filtered = statusFilter === "all" ? leases : leases.filter((l) => l.status === statusFilter);

  const getPrimaryTenant = (lease: LeaseWithRelations) => {
    const primary = lease.lease_tenants?.find((lt) => lt.is_primary);
    return primary?.tenant?.name ?? lease.lease_tenants?.[0]?.tenant?.name ?? "—";
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
          <h1 className="text-xl font-bold">租约管理</h1>
          <p className="text-sm text-muted-foreground">共 {leases.length} 份租约</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          新增租约
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="active">生效中</TabsTrigger>
          <TabsTrigger value="expired">已到期</TabsTrigger>
          <TabsTrigger value="terminated">已归档</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={statusFilter === "all" ? "还没有租约" : "没有符合条件的租约"}
          description={statusFilter === "all" ? "创建租约来关联房源和租客" : undefined}
          action={
            statusFilter === "all" ? (
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" />
                新增租约
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((lease) => {
            const attCount = lease.attachment_count ?? 0;
            return (
              <Card
                key={lease.id}
                className="group hover:border-primary/40 transition-colors cursor-pointer overflow-hidden"
                onClick={() => openDetail(lease)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm">{lease.property?.name ?? "—"}</span>
                        <Badge variant={STATUS_BADGE[lease.status]}>
                          {LEASE_STATUS_LABELS[lease.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        租客：{getPrimaryTenant(lease)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(lease.start_date)} — {formatDate(lease.end_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatCurrency(lease.monthly_rent)}<span className="text-xs font-normal text-muted-foreground">/月</span></p>
                        <p className="text-xs text-muted-foreground">{PAYMENT_CYCLE_LABELS[lease.payment_cycle]} · {BILLING_MODE_LABELS[lease.billing_mode]}</p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(lease)}>
                              <Eye className="mr-2 h-4 w-4" />
                              查看详情
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditing(lease); setFormOpen(true); }}>
                              <Edit className="mr-2 h-4 w-4" />
                              编辑
                            </DropdownMenuItem>
                            {lease.status === "active" && (
                              <DropdownMenuItem
                                className="text-orange-600 focus:text-orange-600"
                                onClick={() => handleTerminate(lease)}
                              >
                                <FileText className="mr-2 h-4 w-4" />
                                归档此租约
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeletingId(lease.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </CardContent>
                {/* 合同状态条 */}
                <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-t text-xs">
                  <div className="flex items-center gap-1.5">
                    <Paperclip className={`h-3.5 w-3.5 ${attCount > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    {attCount > 0 ? (
                      <span>
                        合同 · 已上传 <strong className="text-primary">{attCount}</strong> 份
                      </span>
                    ) : (
                      <span className="text-muted-foreground">暂无合同附件</span>
                    )}
                  </div>
                  <span className="text-primary text-[11px]">
                    {attCount > 0 ? "点击查看 →" : "点击上传 →"}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新增/编辑 */}
      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑租约" : "新增租约"}</DialogTitle>
          </DialogHeader>
          <LeaseForm
            defaultValues={editing ? {
              ...editing,
              // 回填主租客的 UUID（不是 name），这样下拉框能正确选中
              tenant_id: editing.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.id ?? "",
            } : undefined}
            onSubmit={handleSubmit}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>租约详情</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-2">
                <span className="text-muted-foreground">房源</span>
                <span className="font-medium">{viewing.property?.name ?? "—"}</span>
                <span className="text-muted-foreground">租客</span>
                <span className="font-medium">{getPrimaryTenant(viewing)}</span>
                <span className="text-muted-foreground">起租日期</span>
                <span>{formatDate(viewing.start_date)}</span>
                <span className="text-muted-foreground">结束日期</span>
                <span>{formatDate(viewing.end_date)}</span>
                <span className="text-muted-foreground">月租金</span>
                <span className="font-semibold">{formatCurrency(viewing.monthly_rent)}</span>
                <span className="text-muted-foreground">押金</span>
                <span>{formatCurrency(viewing.deposit)}</span>
                <span className="text-muted-foreground">付款周期</span>
                <span>{PAYMENT_CYCLE_LABELS[viewing.payment_cycle]}</span>
                <span className="text-muted-foreground">收租日</span>
                <span>每月 {viewing.rent_due_day} 号</span>
                <span className="text-muted-foreground">账单模式</span>
                <span>{BILLING_MODE_LABELS[viewing.billing_mode]}</span>
                <span className="text-muted-foreground">租约来源</span>
                <span>
                  {viewing.rental_source === "agent" ? (
                    <>
                      通过中介
                      {viewing.agent_name && (
                        <span className="text-muted-foreground"> · {viewing.agent_name}</span>
                      )}
                    </>
                  ) : (
                    "直租"
                  )}
                </span>
                {viewing.rental_source === "agent" && viewing.agent_phone && (
                  <>
                    <span className="text-muted-foreground">中介电话</span>
                    <span>{viewing.agent_phone}</span>
                  </>
                )}
                {viewing.rental_source === "agent" && viewing.agent_fee != null && (
                  <>
                    <span className="text-muted-foreground">中介费</span>
                    <span>{formatCurrency(viewing.agent_fee)}</span>
                  </>
                )}
                <span className="text-muted-foreground">状态</span>
                <Badge variant={STATUS_BADGE[viewing.status]}>{LEASE_STATUS_LABELS[viewing.status]}</Badge>
              </div>
              {viewing.notes && (
                <div>
                  <p className="text-muted-foreground mb-1">备注</p>
                  <p className="bg-muted rounded p-2 text-xs">{viewing.notes}</p>
                </div>
              )}

              {/* 交付情况：本租约下所有账单，按日期顺序展示
                  房源详情/账单页都只显示当期，历史在这里完整看到 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    交付情况
                  </p>
                  {leaseBills.length > 0 && (() => {
                    const paid = leaseBills.filter((b) => b.status === "paid").length;
                    return (
                      <span className="text-[11px] text-muted-foreground">
                        已收 {paid} / 共 {leaseBills.length} 期
                      </span>
                    );
                  })()}
                </div>
                {leaseBills.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4 bg-muted/30 rounded">
                    暂无账单数据
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border max-h-64 overflow-y-auto">
                    {leaseBills.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {formatDate(b.period_start)} — {formatDate(b.period_end)}
                          </p>
                          <p className="text-muted-foreground">到期 {formatDate(b.due_date)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="num font-semibold">
                            {formatCurrency(b.total_amount)}
                          </p>
                          {b.status === "partial" && (
                            <p className="num text-[10px] text-muted-foreground">
                              已收 {formatCurrency(b.paid_amount)}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={BILL_BADGE[b.status]}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {BILL_STATUS_LABELS[b.status]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 合同 / 附件 */}
              <div>
                <p className="font-medium mb-2 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  合同 / 附件
                </p>
                <ContractUpload
                  propertyId={viewing.property_id}
                  leaseOptions={[{ id: viewing.id, label: `本租约（${formatDate(viewing.start_date)} 起）` }]}
                  onUploaded={() => fetchLeaseAttachments(viewing.id)}
                />
                {leaseAttachments.length > 0 && (
                  <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {leaseAttachments.map((a) => {
                      const href = leaseSignedUrls[a.id];
                      return href ? (
                        <a
                          key={a.id}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors text-xs"
                        >
                          <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="flex-1 truncate">{a.file_name}</span>
                          <span className="text-muted-foreground shrink-0">{formatDate(a.created_at)}</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      ) : (
                        <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs opacity-60">
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate">{a.file_name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这份租约？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，该租约及其下面所有账单都不再显示。如果该房源没有其他生效租约，房源状态会自动改回「空置」。删除是软删除，数据仍保留在数据库里（防止误删），如需彻底清理请告诉我。
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
