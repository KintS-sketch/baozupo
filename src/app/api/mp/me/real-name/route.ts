/**
 * POST /api/mp/me/real-name
 *
 * 保存房东实名（电子签约用）。复刻 settings/page.tsx 的 saveRealName。
 * Body: { real_name: string, id_number: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { real_name?: string; id_number?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const name = (body.real_name ?? "").trim();
  const id = (body.id_number ?? "").trim().toUpperCase();
  if (!name) return NextResponse.json({ error: "请输入真实姓名" }, { status: 400 });
  if (!/^[0-9]{17}[0-9X]$/.test(id)) {
    return NextResponse.json(
      { error: "身份证号需为 18 位（最后一位可为 X）" },
      { status: 400 }
    );
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
    // 用 upsert：万一 trigger 没建 user_profiles 行也能兜底
    // （之前改昵称遇到同样问题：update 影响 0 行会静默成功，前端 reload 后看不到新值）
    const { error } = await admin
      .from("user_profiles")
      .upsert({ id: user.id, real_name: name, id_number: id }, { onConflict: "id" });
    if (error) throw error;
    return NextResponse.json({ success: true, real_name: name, id_number: id });
  } catch (err) {
    console.error("[api/mp/me/real-name] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}
