/**
 * GET /api/mp/contacts
 *
 * 给小程序 baozupo-mp 首页右上角联系人弹窗用。
 * 完整复刻 src/components/contacts-dialog.tsx 的两个查询 + 去重合并逻辑：
 *   - 租客：tenants + 关联 active lease + property（按姓名+电话去重合并）
 *   - 中介：active lease 里 rental_source='agent' 的（按姓名+电话+房源去重）
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ tenants: TenantContact[], agents: AgentContact[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export interface TenantContact {
  type: "tenant";
  id: string;
  tenant_ids: string[]; // 去重合并后的所有 tenant 表 id
  name: string;
  phone: string;
  wechat_id: string | null;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  active_property_names: string[];
  has_active_lease: boolean;
}

export interface AgentContact {
  type: "agent";
  id: string;
  name: string;
  phone: string | null;
  property_name: string;
  agent_fee: number | null;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ tenants: [], agents: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const [{ data: tenantsRaw }, { data: leasesRaw }] = await Promise.all([
      admin
        .from("tenants")
        .select(
          `id, name, phone, wechat_id, id_number, emergency_contact_name,
           emergency_contact_phone,
           lease_tenants(is_primary,
             lease:leases(status, deleted_at, property:properties(name, address)))`
        )
        .eq("household_id", user.household_id)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      admin
        .from("leases")
        .select(
          `id, agent_name, agent_phone, agent_fee,
           property:properties(name, address)`
        )
        .eq("household_id", user.household_id)
        .eq("rental_source", "agent")
        .is("deleted_at", null)
        .not("agent_name", "is", null),
    ]);

    // === 租客去重合并 ===
    // 注意：supabase 的嵌套 join 字段可能返回单对象或数组（视 schema 推断），全部按数组兜底处理
    type LeaseProp = { name: string; address: string | null };
    type LeaseLite = {
      status: string;
      deleted_at: string | null;
      property: LeaseProp | LeaseProp[] | null;
    };
    type LeaseTenantJoin = {
      is_primary: boolean;
      lease: LeaseLite | LeaseLite[] | null;
    };
    type TenantRow = {
      id: string;
      name: string;
      phone: string;
      wechat_id: string | null;
      id_number: string | null;
      emergency_contact_name: string | null;
      emergency_contact_phone: string | null;
      lease_tenants?: LeaseTenantJoin[];
    };
    function asArr<T>(v: T | T[] | null | undefined): T[] {
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    }

    const tenantMap = new Map<string, TenantContact>();
    for (const t of (tenantsRaw ?? []) as unknown as TenantRow[]) {
      const name = (t.name ?? "").trim();
      const phone = (t.phone ?? "").trim();
      const key = `${name}|${phone}`;
      const activeProperties: string[] = [];
      let hasActive = false;
      for (const lt of t.lease_tenants ?? []) {
        for (const lease of asArr(lt.lease)) {
          if (!lease || lease.deleted_at) continue;
          if (lease.status !== "active") continue;
          hasActive = true;
          for (const prop of asArr(lease.property)) {
            const pname = prop?.name;
            const paddr = prop?.address;
            // 拼成「楼盘 · 房号」，区分同一小区里多套房
            const display = pname && paddr ? `${pname} · ${paddr}` : pname || paddr;
            if (display && !activeProperties.includes(display)) {
              activeProperties.push(display);
            }
          }
        }
      }
      const existing = tenantMap.get(key);
      if (existing) {
        existing.tenant_ids.push(t.id);
        existing.wechat_id = existing.wechat_id ?? t.wechat_id;
        existing.id_number = existing.id_number ?? t.id_number;
        existing.emergency_contact_name =
          existing.emergency_contact_name ?? t.emergency_contact_name;
        existing.emergency_contact_phone =
          existing.emergency_contact_phone ?? t.emergency_contact_phone;
        for (const p of activeProperties) {
          if (!existing.active_property_names.includes(p)) {
            existing.active_property_names.push(p);
          }
        }
        existing.has_active_lease = existing.has_active_lease || hasActive;
      } else {
        tenantMap.set(key, {
          type: "tenant",
          id: key,
          tenant_ids: [t.id],
          name: t.name,
          phone: t.phone,
          wechat_id: t.wechat_id,
          id_number: t.id_number,
          emergency_contact_name: t.emergency_contact_name,
          emergency_contact_phone: t.emergency_contact_phone,
          active_property_names: activeProperties,
          has_active_lease: hasActive,
        });
      }
    }

    // === 中介去重 ===
    type LeaseAgentRow = {
      id: string;
      agent_name: string | null;
      agent_phone: string | null;
      agent_fee: number | null;
      property: LeaseProp | LeaseProp[] | null;
    };
    const agentMap = new Map<string, AgentContact>();
    for (const l of (leasesRaw ?? []) as unknown as LeaseAgentRow[]) {
      if (!l.agent_name) continue;
      const name = l.agent_name.trim();
      const phone = (l.agent_phone ?? "").trim();
      const props = asArr(l.property);
      const pname = props[0]?.name ?? "—";
      const key = `${name}|${phone}|${pname}`;
      if (agentMap.has(key)) continue;
      agentMap.set(key, {
        type: "agent",
        id: l.id,
        name,
        phone: l.agent_phone,
        property_name: pname,
        agent_fee: l.agent_fee != null ? Number(l.agent_fee) : null,
      });
    }

    return NextResponse.json({
      tenants: Array.from(tenantMap.values()),
      agents: Array.from(agentMap.values()),
    });
  } catch (err) {
    console.error("[api/mp/contacts] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
