"use client";

import { useEffect, useState } from "react";
import { Plus, Users, MoreVertical, Edit, Trash2, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { TenantForm, type TenantFormValues } from "@/components/forms/tenant-form";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { maskPhone, maskIdNumber } from "@/lib/format";
import { ID_TYPE_LABELS } from "@/types";
import type { Tenant } from "@/types";
import { toast } from "sonner";

export default function TenantsPage() {
  const { householdId, loading: userLoading } = useUser();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createClient();

  const fetchTenants = async () => {
    if (!householdId) return;
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (!error) setTenants(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleSubmit = async (values: TenantFormValues) => {
    if (!householdId) return;
    const payload = { ...values, household_id: householdId };

    if (editing) {
      const { error } = await supabase.from("tenants").update(payload).eq("id", editing.id);
      if (error) { toast.error("保存失败"); return; }
      toast.success("租客信息已更新");
    } else {
      const { error } = await supabase.from("tenants").insert(payload);
      if (error) { toast.error("添加失败"); return; }
      toast.success("租客已添加");
    }

    setFormOpen(false);
    setEditing(null);
    fetchTenants();
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    // 检查是否有关联租约
    const { data: leaseLinks } = await supabase
      .from("lease_tenants")
      .select("lease_id, lease:leases(status)")
      .eq("tenant_id", deletingId);

    const hasActiveLeases = leaseLinks?.some(
      (lt) => (lt.lease as unknown as { status: string } | null)?.status === "active"
    );

    if (hasActiveLeases) {
      toast.error("该租客有进行中的租约，无法删除。请先办理退租。");
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("tenants")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deletingId);

    if (error) { toast.error("删除失败"); }
    else { toast.success("租客已删除"); fetchTenants(); }
    setDeletingId(null);
  };

  const openEdit = (t: Tenant) => { setEditing(t); setFormOpen(true); };
  const openAdd = () => { setEditing(null); setFormOpen(true); };

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">租客管理</h1>
          <p className="text-sm text-muted-foreground">共 {tenants.length} 位租客</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" />
          添加租客
        </Button>
      </div>

      {tenants.length === 0 ? (
        <EmptyState
          icon={Users}
          title="还没有租客"
          description="添加您的第一位租客信息"
          action={
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" />
              添加租客
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tenants.map((tenant) => (
            <Card key={tenant.id} className="group hover:border-primary/30 transition-colors">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                      {tenant.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{tenant.name}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{maskPhone(tenant.phone)}</span>
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(tenant)}>
                        <Edit className="mr-2 h-4 w-4" />
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeletingId(tenant.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {tenant.id_number && (
                    <p>
                      {ID_TYPE_LABELS[tenant.id_type]}：
                      {/* 列表页展示脱敏后的证件号 */}
                      <span className="font-mono">{maskIdNumber(tenant.id_number)}</span>
                    </p>
                  )}
                  {tenant.emergency_contact_name && (
                    <p>紧急联系人：{tenant.emergency_contact_name}</p>
                  )}
                  {tenant.notes && <p className="line-clamp-1">{tenant.notes}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑租客" : "添加租客"}</DialogTitle>
          </DialogHeader>
          <TenantForm
            defaultValues={editing ?? undefined}
            onSubmit={handleSubmit}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除租客？</AlertDialogTitle>
            <AlertDialogDescription>
              如果该租客有进行中的租约，将无法删除。请先办理退租。
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
