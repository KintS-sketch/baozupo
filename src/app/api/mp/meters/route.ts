/**
 * GET /api/mp/meters
 *
 * 返回当前 household 全部抄表记录（含房源名）+ 本月费用汇总（按 type 分类）。
 * 客户端按 type tab 自己过滤。
 *
 * 等价于 PWA src/app/meters/page.tsx 的 supabase 查询。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface MeterReading {
  id: string;
  property_id: string;
  property_name: string;
  property_address: string | null;
  type: string;
  reading_date: string;
  value: number;
  previous_value: number | null;
  unit_price: number | null;
  usage: number | null;
  amount: number | null;
  notes: string | null;
  ai_recognized: boolean;
  ai_confidence: number | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id) {
    return NextResponse.json({
      readings: [],
      properties: [],
      month_totals: { water: 0, electricity: 0, gas: 0 },
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 拿这个 household 的所有未删除房源
  const { data: props } = await admin
    .from("properties")
    .select("id, name, address")
    .eq("household_id", user.household_id)
    .is("deleted_at", null);

  const propMap = new Map<string, { name: string; address: string }>();
  (props ?? []).forEach((p: { id: string; name: string; address: string }) =>
    propMap.set(p.id, { name: p.name, address: p.address })
  );

  if (propMap.size === 0) {
    return NextResponse.json({
      readings: [],
      properties: [],
      month_totals: { water: 0, electricity: 0, gas: 0 },
    });
  }

  const propertyIds = [...propMap.keys()];

  const { data: rows, error } = await admin
    .from("meter_readings")
    .select(
      "id, property_id, type, reading_date, value, previous_value, unit_price, usage, amount, notes, ai_recognized, ai_confidence, created_at"
    )
    .in("property_id", propertyIds)
    .order("reading_date", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: "查询失败：" + error.message },
      { status: 500 }
    );
  }

  const readings: MeterReading[] = (rows ?? []).map((r) => {
    const p = propMap.get(r.property_id);
    return {
      id: r.id,
      property_id: r.property_id,
      property_name: p?.name ?? "—",
      property_address: p?.address ?? null,
      type: r.type,
      reading_date: r.reading_date,
      value: Number(r.value),
      previous_value: r.previous_value == null ? null : Number(r.previous_value),
      unit_price: r.unit_price == null ? null : Number(r.unit_price),
      usage: r.usage == null ? null : Number(r.usage),
      amount: r.amount == null ? null : Number(r.amount),
      notes: r.notes,
      ai_recognized: !!r.ai_recognized,
      ai_confidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
      created_at: r.created_at,
    };
  });

  // 本月费用汇总（按 reading_date 在本月内 + amount 非空）
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const totals = { water: 0, electricity: 0, gas: 0 } as Record<string, number>;
  readings.forEach((r) => {
    const d = new Date(r.reading_date);
    if (d >= monthStart && d <= now && r.amount && totals[r.type] !== undefined) {
      totals[r.type] += r.amount;
    }
  });

  return NextResponse.json({
    readings,
    properties: [...propMap.entries()].map(([id, v]) => ({
      id,
      name: v.name,
      address: v.address,
    })),
    month_totals: totals,
  });
}
