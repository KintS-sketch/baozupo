/**
 * POST /api/mp/properties/delete
 *
 * 软删除房源（PWA properties/page.tsx 的删除逻辑）：
 *   1. 检查是否有 active lease，有则拒
 *   2. UPDATE properties SET deleted_at = now()
 *
 * Body: { property_id: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: { property_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId) {
    return NextResponse.json({ error: "property_id 不能为空" }, { status: 400 });
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
    const { data: owner } = await admin
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!owner) {
      return NextResponse.json({ error: "房源不存在或不属于你" }, { status: 404 });
    }

    // 检查是否有 active 租约
    const { data: activeLeases } = await admin
      .from("leases")
      .select("id")
      .eq("property_id", propertyId)
      .eq("status", "active")
      .is("deleted_at", null);
    if (activeLeases && activeLeases.length > 0) {
      return NextResponse.json(
        { error: "该房源有进行中的租约，无法删除。请先退租后再操作。" },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("properties")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", propertyId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/mp/properties/delete] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}
