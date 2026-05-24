/**
 * POST /api/mp/leases/delete
 *
 * 软删除租约（PWA leases/page.tsx 的 handleDelete）：
 *   1. 检查是否有签署完成的电子合同（contracts.status='signed'），有则拒
 *   2. UPDATE leases SET deleted_at = now()
 *   3. 如果该房源没有其他 active 租约，把房源状态改回 vacant
 *
 * Body: { lease_id: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: { lease_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const leaseId = body.lease_id;
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id 不能为空" }, { status: 400 });
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
    // 校验归属
    const { data: lease } = await admin
      .from("leases")
      .select("id, property_id")
      .eq("id", leaseId)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lease) {
      return NextResponse.json({ error: "租约不存在或不属于你" }, { status: 404 });
    }

    // 检查电子签
    const { data: signed } = await admin
      .from("contracts")
      .select("id")
      .eq("lease_id", leaseId)
      .eq("status", "signed")
      .is("deleted_at", null);
    if (signed && signed.length > 0) {
      return NextResponse.json(
        {
          error:
            "该租约已有签署完成的电子合同，无法直接删除。请联系客服处理。",
        },
        { status: 409 }
      );
    }

    // 软删除
    const { error: delErr } = await admin
      .from("leases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", leaseId);
    if (delErr) throw delErr;

    // 房源状态兜底
    const pid = (lease as { property_id: string }).property_id;
    const { data: stillActive } = await admin
      .from("leases")
      .select("id")
      .eq("property_id", pid)
      .eq("status", "active")
      .is("deleted_at", null);
    if (!stillActive || stillActive.length === 0) {
      await admin.from("properties").update({ status: "vacant" }).eq("id", pid);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/mp/leases/delete] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}
