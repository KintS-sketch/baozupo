/**
 * GET /api/mp/leases
 *
 * 给小程序 baozupo-mp 用的租约列表合并端点。
 * 复刻 src/app/leases/page.tsx 的主查询 + 附件/合同关联：
 *   - leases + property + lease_tenants + tenants
 *   - 关联 attachments（按 mime_type 区分图片/文件计数）
 *   - 关联 contracts（电子签合同状态）
 *
 * 不带详情弹窗里的账单（账单走单独 /api/mp/leases/:id/bills，先简化）
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ leases: LeaseWithRelations[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface TenantLite {
  id: string;
  name: string;
  phone: string;
  id_type: string;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

export interface LeaseWithRelations {
  id: string;
  property_id: string;
  property_name: string;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  payment_cycle: string;
  billing_mode: string;
  rent_due_day: number;
  status: "active" | "expired" | "terminated";
  rental_source: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  agent_fee: number | null;
  notes: string | null;
  primary_tenant: TenantLite | null;
  tenants: TenantLite[];
  attachment_images: number;
  attachment_docs: number;
  contract: { id: string; status: string } | null;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ leases: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: leases, error } = await admin
      .from("leases")
      .select(
        `id, property_id, start_date, end_date, monthly_rent, deposit,
         payment_cycle, billing_mode, rent_due_day, status, rental_source,
         agent_name, agent_phone, agent_fee, notes,
         property:properties(name),
         lease_tenants(is_primary,
           tenant:tenants(id, name, phone, id_type, id_number,
             emergency_contact_name, emergency_contact_phone))`
      )
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    if (!leases || leases.length === 0) {
      return NextResponse.json({ leases: [] });
    }

    const leaseIds = leases.map((l) => (l as { id: string }).id);

    // 附件计数
    const { data: attachments } = await admin
      .from("attachments")
      .select("entity_id, mime_type")
      .eq("household_id", user.household_id)
      .eq("entity_type", "lease")
      .in("entity_id", leaseIds);

    const attCountByLease = new Map<string, { images: number; docs: number }>();
    for (const a of attachments ?? []) {
      const eid = (a as { entity_id: string }).entity_id;
      const mime = String((a as { mime_type: string }).mime_type ?? "");
      const c = attCountByLease.get(eid) ?? { images: 0, docs: 0 };
      if (mime.startsWith("image/")) c.images += 1;
      else c.docs += 1;
      attCountByLease.set(eid, c);
    }

    // 电子合同（每个 lease 取最新有效一份，优先 draft/partial/signed）
    const { data: contracts } = await admin
      .from("contracts")
      .select("id, lease_id, status, created_at")
      .in("lease_id", leaseIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const contractByLease = new Map<string, { id: string; status: string }>();
    const ACTIVE_STATUSES = new Set(["draft", "partial", "signed"]);
    for (const c of contracts ?? []) {
      const lid = (c as { lease_id: string }).lease_id;
      const status = (c as { status: string }).status;
      if (contractByLease.has(lid)) {
        // 已有更优先的
        if (ACTIVE_STATUSES.has(contractByLease.get(lid)!.status)) continue;
        if (ACTIVE_STATUSES.has(status)) {
          contractByLease.set(lid, { id: (c as { id: string }).id, status });
        }
      } else {
        contractByLease.set(lid, { id: (c as { id: string }).id, status });
      }
    }

    const result: LeaseWithRelations[] = leases.map((l) => {
      const row = l as {
        id: string;
        property_id: string;
        start_date: string;
        end_date: string;
        monthly_rent: number;
        deposit: number;
        payment_cycle: string;
        billing_mode: string;
        rent_due_day: number;
        status: string;
        rental_source: string | null;
        agent_name: string | null;
        agent_phone: string | null;
        agent_fee: number | null;
        notes: string | null;
        property: { name: string } | null;
        lease_tenants?: {
          is_primary: boolean;
          tenant: TenantLite | null;
        }[];
      };
      const lts = row.lease_tenants ?? [];
      const tenantList = lts.map((lt) => lt.tenant).filter((t): t is TenantLite => !!t);
      const primary =
        lts.find((lt) => lt.is_primary && lt.tenant)?.tenant ?? tenantList[0] ?? null;
      const att = attCountByLease.get(row.id) ?? { images: 0, docs: 0 };
      return {
        id: row.id,
        property_id: row.property_id,
        property_name: row.property?.name ?? "—",
        start_date: row.start_date,
        end_date: row.end_date,
        monthly_rent: Number(row.monthly_rent),
        deposit: Number(row.deposit),
        payment_cycle: row.payment_cycle,
        billing_mode: row.billing_mode,
        rent_due_day: row.rent_due_day,
        status: row.status as LeaseWithRelations["status"],
        rental_source: row.rental_source,
        agent_name: row.agent_name,
        agent_phone: row.agent_phone,
        agent_fee: row.agent_fee != null ? Number(row.agent_fee) : null,
        notes: row.notes,
        primary_tenant: primary,
        tenants: tenantList,
        attachment_images: att.images,
        attachment_docs: att.docs,
        contract: contractByLease.get(row.id) ?? null,
      };
    });

    return NextResponse.json({ leases: result });
  } catch (err) {
    console.error("[api/mp/leases] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
