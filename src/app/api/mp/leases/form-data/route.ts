/**
 * GET /api/mp/leases/form-data
 *
 * 给 mp LeaseForm 弹窗用的下拉数据：
 *   - 房源列表（id/name/address）
 *   - 已有租客列表（id/name）
 *
 * 认证：Authorization: Bearer
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({ properties: [], tenants: [] });
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
    const [{ data: props }, { data: tnts }] = await Promise.all([
      admin
        .from("properties")
        .select("id, name, address")
        .eq("household_id", user.household_id)
        .is("deleted_at", null)
        .order("name"),
      admin
        .from("tenants")
        .select("id, name, phone")
        .eq("household_id", user.household_id)
        .is("deleted_at", null)
        .order("name"),
    ]);

    return NextResponse.json({
      properties: props ?? [],
      tenants: tnts ?? [],
    });
  } catch (err) {
    console.error("[api/mp/leases/form-data] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
