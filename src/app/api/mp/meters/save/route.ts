/**
 * POST /api/mp/meters/save
 *
 * 新增抄表读数。
 * Body: {
 *   property_id: string;
 *   type: 'water' | 'electricity' | 'gas';
 *   reading_date: string (YYYY-MM-DD);
 *   value: number;
 *   previous_value?: number | null;
 *   unit_price?: number | null;
 *   notes?: string;
 *   ai_recognized?: boolean;
 *   ai_confidence?: number;
 *   ai_provider?: string;
 *   ai_raw_value?: number;
 * }
 *
 * 服务端自动算 usage = value - previous_value 和 amount = usage * unit_price。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface SaveBody {
  property_id?: string;
  type?: "water" | "electricity" | "gas";
  reading_date?: string;
  value?: number;
  previous_value?: number | null;
  unit_price?: number | null;
  notes?: string;
  ai_recognized?: boolean;
  ai_confidence?: number;
  ai_provider?: string;
  ai_raw_value?: number;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "未加入家庭组" }, { status: 400 });

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!body.property_id) return NextResponse.json({ error: "请选择房源" }, { status: 400 });
  if (!body.type || !["water", "electricity", "gas"].includes(body.type))
    return NextResponse.json({ error: "表类型无效" }, { status: 400 });
  if (!body.reading_date) return NextResponse.json({ error: "请选择日期" }, { status: 400 });
  if (body.value == null || Number.isNaN(Number(body.value)))
    return NextResponse.json({ error: "请填写读数" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 校验 property 属于当前 household
  const { data: prop } = await admin
    .from("properties")
    .select("id, household_id")
    .eq("id", body.property_id)
    .maybeSingle();
  if (!prop || prop.household_id !== user.household_id) {
    return NextResponse.json({ error: "房源不存在或无权操作" }, { status: 403 });
  }

  const value = Number(body.value);
  const prev = body.previous_value == null ? null : Number(body.previous_value);
  const unit = body.unit_price == null ? null : Number(body.unit_price);
  const usage = prev != null && !Number.isNaN(prev) ? Number((value - prev).toFixed(3)) : null;
  const amount =
    usage != null && unit != null && !Number.isNaN(unit)
      ? Number((usage * unit).toFixed(2))
      : null;

  const insert: Record<string, unknown> = {
    property_id: body.property_id,
    type: body.type,
    reading_date: body.reading_date,
    value,
    previous_value: prev,
    unit_price: unit,
    usage,
    amount,
    notes: body.notes ?? null,
    ai_recognized: !!body.ai_recognized,
    ai_confidence: body.ai_confidence ?? null,
    ai_provider: body.ai_provider ?? null,
    ai_raw_value: body.ai_raw_value ?? null,
  };

  const { data, error } = await admin
    .from("meter_readings")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "保存失败：" + (error?.message ?? "未知") },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, id: data.id });
}
