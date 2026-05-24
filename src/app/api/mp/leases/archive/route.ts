/**
 * POST /api/mp/leases/archive
 *
 * 归档租约（PWA leases/page.tsx 的 handleTerminate）：
 *   1. UPDATE leases SET status='terminated'
 *   2. UPDATE properties SET status='vacant'
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
    const { data: lease } = await admin
      .from("leases")
      .select("id, property_id, status")
      .eq("id", leaseId)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lease) {
      return NextResponse.json({ error: "租约不存在" }, { status: 404 });
    }
    if ((lease as { status: string }).status !== "active") {
      return NextResponse.json({ error: "只能归档生效中的租约" }, { status: 409 });
    }

    const { error: e1 } = await admin
      .from("leases")
      .update({ status: "terminated" })
      .eq("id", leaseId);
    if (e1) throw e1;

    await admin
      .from("properties")
      .update({ status: "vacant" })
      .eq("id", (lease as { property_id: string }).property_id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/mp/leases/archive] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "归档失败" },
      { status: 500 }
    );
  }
}
