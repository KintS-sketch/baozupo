/**
 * GET /api/mp/reminders
 * 返回当前 household 的所有提醒（pending + dismissed 都返回，前端 tab 过滤）
 *
 * 认证：Bearer
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({ reminders: [] });
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
    const { data, error } = await admin
      .from("reminders")
      .select("*")
      .eq("household_id", user.household_id)
      .order("remind_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ reminders: data ?? [] });
  } catch (err) {
    console.error("[api/mp/reminders] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
