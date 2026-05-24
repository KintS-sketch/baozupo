/**
 * GET /api/mp/properties
 *
 * 给小程序 baozupo-mp 用的房源列表合并端点。
 * 复刻 src/app/properties/page.tsx 的数据查询：
 *   - 当前 household 下未删除的房源
 *   - 关联每套房源的「生效中」租约信息（主租客名 + 月租金 + 起止日）
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ properties: PropertyWithLease[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface ActiveLeaseSummary {
  id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  primary_tenant_name: string | null;
}

export interface PropertyWithLease {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  layout: string | null;
  area: number | null;
  status: "rented" | "vacant" | "renovating";
  notes: string | null;
  active_lease: ActiveLeaseSummary | null;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({ properties: [] });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: properties, error: propErr } = await admin
      .from("properties")
      .select("id, name, address, city, district, layout, area, status, notes")
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (propErr) throw propErr;
    if (!properties || properties.length === 0) {
      return NextResponse.json({ properties: [] });
    }

    const propertyIds = properties.map((p) => p.id);

    // 关联当前生效中的租约 + 主租客（PWA 页面右下角显示）
    const { data: leases } = await admin
      .from("leases")
      .select(
        `id, property_id, start_date, end_date, monthly_rent, created_at,
         lease_tenants(is_primary, tenant:tenants(name))`
      )
      .in("property_id", propertyIds)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    // 每套房源取最近一份 active lease 作为「当前租约」
    const leaseByProperty = new Map<string, ActiveLeaseSummary>();
    for (const l of leases ?? []) {
      const pid = (l as { property_id: string }).property_id;
      if (leaseByProperty.has(pid)) continue;
      const tenants = (l as {
        lease_tenants?: {
          is_primary: boolean;
          tenant: { name: string } | null;
        }[];
      }).lease_tenants;
      const primary = tenants?.find((t) => t.is_primary) ?? tenants?.[0];
      leaseByProperty.set(pid, {
        id: (l as { id: string }).id,
        start_date: (l as { start_date: string }).start_date,
        end_date: (l as { end_date: string }).end_date,
        monthly_rent: Number((l as { monthly_rent: number }).monthly_rent),
        primary_tenant_name: primary?.tenant?.name ?? null,
      });
    }

    const result: PropertyWithLease[] = properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      city: p.city,
      district: p.district,
      layout: p.layout,
      area: p.area != null ? Number(p.area) : null,
      status: p.status as PropertyWithLease["status"],
      notes: p.notes,
      active_lease: leaseByProperty.get(p.id) ?? null,
    }));

    return NextResponse.json({ properties: result });
  } catch (err) {
    console.error("[api/mp/properties] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
