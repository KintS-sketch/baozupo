"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  name: string;
  phone: string;
  wechat_id: string | null;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  // 关联的生效房源（同一租客可能租多套，去重合并后是数组）
  active_property_names: string[];
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

  const supabase = createClient();

  useEffect(() => {
    if (!open || !householdId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 拉所有租客 + 关联当前活跃租约
      const { data: tenantsData } = await supabase
        .from("tenants")
        .select(
          `id, name, phone, wechat_id, id_number, emergency_contact_name, emergency_contact_phone,
           lease_tenants(is_primary, lease:leases(status, property:properties(name)))`
        )
        .eq("household_id", householdId)
        .is("deleted_at", null)
        .order("name");

      // 拉所有 active/expired 租约里有中介信息的，作为中介联系人源
      const { data: agentLeases } = await supabase
        .from("leases")
        .select(
          "id, agent_name, agent_phone, agent_fee, property:properties(name)"
        )
        .eq("household_id", householdId)
        .eq("rental_source", "agent")
        .is("deleted_at", null)
        .not("agent_name", "is", null);

      if (cancelled) return;

      // supabase-js 把 1:1 关联返回成数组（即便只有 1 条），unknown 强转兼容
      type SupaTenant = {
        is_primary: boolean;
        lease:
          | { status: string; property: { name: string } | { name: string }[] | null }
          | Array<{ status: string; property: { name: string } | { name: string }[] | null }>
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
      const pickPropertyName = (
        p: { name: string } | { name: string }[] | null | undefined
      ): string | null => {
        if (!p) return null;
        if (Array.isArray(p)) return p[0]?.name ?? null;
        return p.name ?? null;
      };
      // 去重：同一个人在多套房各建租约 → tenants 表里有多条记录。
      // 按「姓名 + 手机号」归并成一张联系人卡，字段取最全的，房源汇总成数组。
      const tenantMap = new Map<string, TenantContact>();
      for (const t of (tenantsData ?? []) as unknown as TenantRow[]) {
        // 收集这条 tenant 记录关联的所有生效房源
        const propNames: string[] = [];
        for (const lt of t.lease_tenants ?? []) {
          const l = lt.lease;
          const leases = Array.isArray(l) ? l : l ? [l] : [];
          for (const lease of leases) {
            if (lease.status !== "active") continue;
            const name = pickPropertyName(lease.property);
            if (name) propNames.push(name);
          }
        }
        const key = `${t.name.trim()}|${t.phone.trim()}`;
        const existing = tenantMap.get(key);
        if (existing) {
          // 合并：字段补缺、房源去重汇总
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
            name: t.name,
            phone: t.phone,
            wechat_id: t.wechat_id,
            id_number: t.id_number,
            emergency_contact_name: t.emergency_contact_name,
            emergency_contact_phone: t.emergency_contact_phone,
            active_property_names: [...new Set(propNames)],
          });
        }
      }
      const tenantContacts: TenantContact[] = Array.from(tenantMap.values());

      type AgentLeaseRow = {
        id: string;
        agent_name: string;
        agent_phone: string | null;
        agent_fee: number | null;
        property: { name: string } | { name: string }[] | null;
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
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, householdId]);

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
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContactCard({
  contact,
  onCopy,
  copiedKey,
}: {
  contact: Contact;
  onCopy: (text: string, key: string, label: string) => void;
  copiedKey: string | null;
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
