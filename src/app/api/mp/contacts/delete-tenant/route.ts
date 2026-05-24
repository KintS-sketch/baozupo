/**
 * POST /api/mp/contacts/delete-tenant
 *
 * 联系人弹窗里删除租客（实际是软删除 tenants 表所有合并后的 id）。
 * 复刻 contacts-dialog.tsx 的删除逻辑：
 *   1. 检查这些 tenant 是否还有 active lease，有则拒
 *   2. UPDATE tenants set deleted_at = now() WHERE id IN tenant_ids
 *
 * Body: { tenant_ids: string[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: { tenant_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const tenantIds = Array.isArray(body.tenant_ids) ? body.tenant_ids.filter(Boolean) : [];
  if (tenantIds.length === 0) {
    return NextResponse.json({ error: "tenant_ids 不能为空" }, { status: 400 });
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
    // 校验：这些 tenant 都属于当前 household
    const { data: ownerCheck } = await admin
      .from("tenants")
      .select("id")
      .in("id", tenantIds)
      .eq("household_id", user.household_id);
    const validIds = (ownerCheck ?? []).map((t: { id: string }) => t.id);
    if (validIds.length === 0) {
      return NextResponse.json({ error: "tenant 不存在或不属于你的家庭组" }, { status: 404 });
    }

    // 检查 active lease
    const { data: activeLeases } = await admin
      .from("lease_tenants")
      .select("tenant_id, lease:leases(status, deleted_at)")
      .in("tenant_id", validIds);
    const hasActive = (activeLeases ?? []).some((lt) => {
      const lease = (lt as { lease: { status: string; deleted_at: string | null } | null }).lease;
      return lease && !lease.deleted_at && lease.status === "active";
    });
    if (hasActive) {
      return NextResponse.json(
        { error: "该租客还有生效中的租约，无法删除。请先在租约页归档相关租约。" },
        { status: 409 }
      );
    }

    const { error: updErr } = await admin
      .from("tenants")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", validIds);
    if (updErr) throw updErr;

    return NextResponse.json({ success: true, deleted: validIds.length });
  } catch (err) {
    console.error("[api/mp/contacts/delete-tenant] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}
