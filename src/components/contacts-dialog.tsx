"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Copy,
  Check,
  Phone,
  MessageCircle,
  ShieldAlert,
  Building2,
  Search,
  Users,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { toast } from "sonner";

/**
 * 反馈 #13: 首页右上角点开 → 弹窗显示所有租客 + 中介联系人
 * 设计：联系人卡片 + 一键复制按钮，房东最高频的"查电话/微信"动作几秒搞定
 */
interface ContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TenantContact {
  type: "tenant";
  id: string;
  // 去重合并后，这个人对应的所有 tenants 表记录 id（删除时一并软删）
  tenant_ids: string[];
  name: string;
  phone: string;
  wechat_id: string | null;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  // 关联的生效房源（同一租客可能租多套，去重合并后是数组）
  active_property_names: string[];
  // 是否还有生效中的租约 —— 有则不允许删除
  has_active_lease: boolean;
}

interface AgentContact {
  type: "agent";
  id: string; // lease_id 当作 unique key（中介信息在 lease 上）
  name: string;
  phone: string | null;
  property_name: string;
  agent_fee: number | null;
}

type Contact = TenantContact | AgentContact;

export function ContactsDialog({ open, onOpenChange }: ContactsDialogProps) {
  const { householdId } = useUser();
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState<"all" | "tenant" | "agent">("all");
  const [search, setSearch] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // 删除租客确认弹窗
  const [deletingTenant, setDeletingTenant] = useState<TenantContact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const supabase = createClient();

  const loadContacts = useCallback(async () => {
    if (!householdId) return;
    {
      setLoading(true);
      // 拉所有租客 + 关联当前活跃租约（房源带 address，显示详细房号）
      const { data: tenantsData } = await supabase
        .from("tenants")
        .select(
          `id, name, phone, wechat_id, id_number, emergency_contact_name, emergency_contact_phone,
           lease_tenants(is_primary, lease:leases(status, deleted_at, property:properties(name, address)))`
        )
        .eq("household_id", householdId)
        .is("deleted_at", null)
        .order("name");

      // 拉所有 active/expired 租约里有中介信息的，作为中介联系人源
      const { data: agentLeases } = await supabase
        .from("leases")
        .select(
          "id, agent_name, agent_phone, agent_fee, property:properties(name, address)"
        )
        .eq("household_id", householdId)
        .eq("rental_source", "agent")
        .is("deleted_at", null)
        .not("agent_name", "is", null);

      // supabase-js 把 1:1 关联返回成数组（即便只有 1 条），unknown 强转兼容
      type PropertyRef = { name: string; address: string | null };
      type SupaTenant = {
        is_primary: boolean;
        lease:
          | { status: string; deleted_at: string | null; property: PropertyRef | PropertyRef[] | null }
          | Array<{ status: string; deleted_at: string | null; property: PropertyRef | PropertyRef[] | null }>
          | null;
      };
      type TenantRow = {
        id: string;
        name: string;
        phone: string;
        wechat_id: string | null;
        id_number: string | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
        lease_tenants?: SupaTenant[];
      };
      // 房源显示「小区名 详细地址」，区分同小区不同房号
      const pickPropertyName = (
        p: PropertyRef | PropertyRef[] | null | undefined
      ): string | null => {
        const prop = Array.isArray(p) ? p[0] : p;
        if (!prop || !prop.name) return null;
        const addr = (prop.address ?? "").trim();
        return addr ? `${prop.name} ${addr}` : prop.name;
      };
      // 去重：同一个人在多套房各建租约 → tenants 表里有多条记录。
      // 按「姓名 + 手机号」归并成一张联系人卡，字段取最全的，房源汇总成数组。
      const tenantMap = new Map<string, TenantContact>();
      for (const t of (tenantsData ?? []) as unknown as TenantRow[]) {
        // 收集这条 tenant 记录关联的生效房源 + 判断有没有生效中的租约
        const propNames: string[] = [];
        let thisHasActive = false;
        for (const lt of t.lease_tenants ?? []) {
          const l = lt.lease;
          const leases = Array.isArray(l) ? l : l ? [l] : [];
          for (const lease of leases) {
            // 跳过软删的租约（leases/page.tsx handleDelete 只设 deleted_at，
            // 不改 status，所以这里必须显式过滤，否则被删的租约会被算成生效中）
            if (lease.deleted_at) continue;
            if (lease.status !== "active") continue;
            thisHasActive = true;
            const name = pickPropertyName(lease.property);
            if (name) propNames.push(name);
          }
        }
        const key = `${t.name.trim()}|${t.phone.trim()}`;
        const existing = tenantMap.get(key);
        if (existing) {
          // 合并：字段补缺、房源去重汇总、记录 id 累加、生效租约状态 OR
          existing.tenant_ids.push(t.id);
          existing.has_active_lease = existing.has_active_lease || thisHasActive;
          existing.wechat_id = existing.wechat_id || t.wechat_id;
          existing.id_number = existing.id_number || t.id_number;
          existing.emergency_contact_name =
            existing.emergency_contact_name || t.emergency_contact_name;
          existing.emergency_contact_phone =
            existing.emergency_contact_phone || t.emergency_contact_phone;
          for (const p of propNames) {
            if (!existing.active_property_names.includes(p)) {
              existing.active_property_names.push(p);
            }
          }
        } else {
          tenantMap.set(key, {
            type: "tenant",
            id: t.id,
            tenant_ids: [t.id],
            name: t.name,
            phone: t.phone,
            wechat_id: t.wechat_id,
            id_number: t.id_number,
            emergency_contact_name: t.emergency_contact_name,
            emergency_contact_phone: t.emergency_contact_phone,
            active_property_names: [...new Set(propNames)],
            has_active_lease: thisHasActive,
          });
        }
      }
      const tenantContacts: TenantContact[] = Array.from(tenantMap.values());

      type AgentLeaseRow = {
        id: string;
        agent_name: string;
        agent_phone: string | null;
        agent_fee: number | null;
        property: PropertyRef | PropertyRef[] | null;
      };
      // 去重：同个中介名 + 电话 视作同一人，但带不同房源时各保留
      const seen = new Set<string>();
      const agentContacts: AgentContact[] = [];
      for (const r of (agentLeases ?? []) as unknown as AgentLeaseRow[]) {
        const propName = pickPropertyName(r.property) ?? "—";
        const key = `${r.agent_name}|${r.agent_phone ?? ""}|${propName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        agentContacts.push({
          type: "agent",
          id: r.id,
          name: r.agent_name,
          phone: r.agent_phone,
          property_name: propName,
          agent_fee: r.agent_fee,
        });
      }

      setContacts([...tenantContacts, ...agentContacts]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  // 弹窗打开时加载联系人
  useEffect(() => {
    if (open) loadContacts();
  }, [open, loadContacts]);

  // 删除租客：软删除该租客名下所有 tenants 记录（同名同号合并的多条一起删）
  const handleDeleteTenant = async () => {
    if (!deletingTenant) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", deletingTenant.tenant_ids);
      if (error) {
        toast.error("删除失败：" + error.message);
        return;
      }
      toast.success("租客已从通讯录移除");
      setDeletingTenant(null);
      loadContacts();
    } finally {
      setDeleteBusy(false);
    }
  };

  // 点删除按钮：有生效租约不让删，否则弹确认
  const requestDeleteTenant = (c: TenantContact) => {
    if (c.has_active_lease) {
      toast.error("该租客还有生效中的租约，无法删除。请先在租约页归档相关租约。");
      return;
    }
    setDeletingTenant(c);
  };

  const filtered = useMemo(() => {
    let list = contacts;
    if (tab === "tenant") list = list.filter((c) => c.type === "tenant");
    if (tab === "agent") list = list.filter((c) => c.type === "agent");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if (c.type === "tenant") {
          return (
            c.phone.includes(q) ||
            (c.wechat_id ?? "").toLowerCase().includes(q)
          );
        }
        return (c.phone ?? "").includes(q);
      });
    }
    return list;
  }, [contacts, tab, search]);

  const tenantCount = contacts.filter((c) => c.type === "tenant").length;
  const agentCount = contacts.filter((c) => c.type === "agent").length;

  const handleCopy = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} 已复制`);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast.error("复制失败，请手动选中");
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            联系人
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {tenantCount} 租客 · {agentCount} 中介
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* tab + 搜索 */}
        <div className="px-5 pt-3 pb-2 space-y-2.5 border-b border-border">
          <div className="inline-flex p-1 bg-secondary rounded-lg gap-1 w-full">
            {[
              { v: "all" as const, label: "全部", count: contacts.length },
              { v: "tenant" as const, label: "租客", count: tenantCount },
              { v: "agent" as const, label: "中介", count: agentCount },
            ].map((t) => {
              const active = tab === t.v;
              return (
                <button
                  key={t.v}
                  onClick={() => setTab(t.v)}
                  className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors inline-flex items-center justify-center gap-1 ${
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {t.label}
                  <span className="text-[10px] text-muted-faint num">{t.count}</span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜姓名 / 手机 / 微信号"
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>

        {/* 联系人列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search ? "没有匹配的联系人" : "还没有联系人"}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <ContactCard
                  key={`${c.type}-${c.id}`}
                  contact={c}
                  onCopy={handleCopy}
                  copiedKey={copiedKey}
                  onRequestDelete={requestDeleteTenant}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* 删除租客确认 */}
    <AlertDialog
      open={deletingTenant !== null}
      onOpenChange={(o) => {
        if (!o && !deleteBusy) setDeletingTenant(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确定删除联系人？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后「{deletingTenant?.name}」不再出现在通讯录里。
            这是软删除，历史租约记录不受影响。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteBusy}>否</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteTenant}
            disabled={deleteBusy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            是，删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function ContactCard({
  contact,
  onCopy,
  copiedKey,
  onRequestDelete,
}: {
  contact: Contact;
  onCopy: (text: string, key: string, label: string) => void;
  copiedKey: string | null;
  onRequestDelete: (c: TenantContact) => void;
}) {
  const isAgent = contact.type === "agent";
  const initial = contact.name.charAt(0).toUpperCase();
  // 卡片配色：租客主色调；中介琥珀色，区分一眼
  const avatarBg = isAgent
    ? "bg-amber-100 text-amber-700"
    : "bg-primary/10 text-primary";

  return (
    <div className="rounded-xl border border-border bg-card p-3 hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 mb-2.5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-sm ${avatarBg}`}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm truncate">{contact.name}</p>
            <Badge variant={isAgent ? "warning" : "success"} className="text-[10px] px-1.5 py-0">
              {isAgent ? "中介" : "租客"}
            </Badge>
          </div>
          {contact.type === "tenant" && contact.active_property_names.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{contact.active_property_names.join("、")}</span>
            </p>
          )}
          {contact.type === "agent" && (
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {contact.property_name}
            </p>
          )}
        </div>
        {/* 删除按钮 — 只有租客可删（中介信息挂在租约上，不单独删） */}
        {contact.type === "tenant" && (
          <button
            type="button"
            onClick={() => onRequestDelete(contact)}
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="删除联系人"
            title="删除联系人"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-1.5 pl-1">
        {/* 手机号 */}
        {contact.phone && (
          <CopyRow
            icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
            label="电话"
            value={contact.phone}
            copyKey={`${contact.type}-${contact.id}-phone`}
            currentCopied={copiedKey}
            onCopy={(t, k) => onCopy(t, k, "电话")}
          />
        )}
        {/* 微信号 — 只有租客有 */}
        {contact.type === "tenant" && contact.wechat_id && (
          <CopyRow
            icon={<MessageCircle className="h-3.5 w-3.5 text-emerald-500" />}
            label="微信"
            value={contact.wechat_id}
            copyKey={`${contact.type}-${contact.id}-wechat`}
            currentCopied={copiedKey}
            onCopy={(t, k) => onCopy(t, k, "微信号")}
          />
        )}
        {/* 紧急联系人 — 只有租客有 */}
        {contact.type === "tenant" && contact.emergency_contact_name && (
          <CopyRow
            icon={<ShieldAlert className="h-3.5 w-3.5 text-amber-500" />}
            label="紧急"
            value={`${contact.emergency_contact_name}${
              contact.emergency_contact_phone ? ` · ${contact.emergency_contact_phone}` : ""
            }`}
            copyText={contact.emergency_contact_phone ?? contact.emergency_contact_name}
            copyKey={`${contact.type}-${contact.id}-emergency`}
            currentCopied={copiedKey}
            onCopy={(t, k) => onCopy(t, k, "紧急联系人")}
          />
        )}
      </div>
    </div>
  );
}

function CopyRow({
  icon,
  label,
  value,
  copyText,
  copyKey,
  currentCopied,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  copyText?: string; // 实际复制内容（默认 = value）
  copyKey: string;
  currentCopied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const isCopied = currentCopied === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyText ?? value, copyKey)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 active:bg-muted/60 transition-colors group text-left"
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium w-8 shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0 text-sm truncate font-medium">{value}</span>
      <span
        className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded transition-colors ${
          isCopied
            ? "text-success bg-success/10"
            : "text-muted-foreground group-hover:text-primary group-hover:bg-primary/5"
        }`}
        aria-label="复制"
      >
        {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}
