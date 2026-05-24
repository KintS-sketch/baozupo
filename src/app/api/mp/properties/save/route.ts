/**
 * POST /api/mp/properties/save
 *
 * 新增 / 编辑房源。复刻 PWA properties/page.tsx 的 handleSubmit。
 *
 * Body: {
 *   id?: string,           // 提供 id 是编辑，否则是新增
 *   name: string,          // 必填
 *   address: string,       // 必填
 *   city?: string,
 *   district?: string,
 *   layout?: string,
 *   area?: number | null,
 *   status: "rented" | "vacant" | "renovating",
 *   notes?: string,
 * }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface SaveBody {
  id?: string;
  name?: string;
  address?: string;
  city?: string | null;
  district?: string | null;
  layout?: string | null;
  area?: number | string | null;
  status?: "rented" | "vacant" | "renovating";
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const address = (body.address ?? "").trim();
  if (!name) return NextResponse.json({ error: "请输入房源名称" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "请输入详细地址" }, { status: 400 });
  const status = body.status ?? "vacant";
  if (!["rented", "vacant", "renovating"].includes(status)) {
    return NextResponse.json({ error: "状态不合法" }, { status: 400 });
  }

  const areaRaw = body.area;
  let area: number | null = null;
  if (areaRaw != null && areaRaw !== "") {
    const n = Number(areaRaw);
    if (Number.isNaN(n) || n <= 0) {
      return NextResponse.json({ error: "面积必须大于 0" }, { status: 400 });
    }
    area = n;
  }

  const payload = {
    name,
    address,
    city: (body.city ?? "").trim() || null,
    district: (body.district ?? "").trim() || null,
    layout: (body.layout ?? "").trim() || null,
    area,
    status,
    notes: (body.notes ?? "").trim() || null,
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (body.id) {
      // 编辑：校验归属
      const { data: own } = await admin
        .from("properties")
        .select("id")
        .eq("id", body.id)
        .eq("household_id", user.household_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!own) {
        return NextResponse.json({ error: "房源不存在或不属于你" }, { status: 404 });
      }
      const { error } = await admin.from("properties").update(payload).eq("id", body.id);
      if (error) throw error;
      return NextResponse.json({ success: true, id: body.id, mode: "update" });
    } else {
      // 新增
      const { data, error } = await admin
        .from("properties")
        .insert({ ...payload, household_id: user.household_id })
        .select("id")
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, id: data.id, mode: "create" });
    }
  } catch (err) {
    console.error("[api/mp/properties/save] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}
