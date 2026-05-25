/**
 * PUT /api/mp/me/profile
 *
 * 更新当前用户的「档案字段」。目前只支持 display_name（昵称）。
 * 微信小程序「我的」页里点修改昵称会调这个接口。
 *
 * Body: { display_name: string }  // 长度 1-20，前后空格自动去掉
 * Auth: Authorization: Bearer <supabase access_token>
 * Returns: { success: true, display_name }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { display_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const raw = (body.display_name ?? "").toString().trim();
  if (!raw) {
    return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
  }
  if (raw.length > 20) {
    return NextResponse.json({ error: "昵称最多 20 个字" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: updateErr } = await admin
    .from("user_profiles")
    .update({ display_name: raw })
    .eq("id", user.id);

  if (updateErr) {
    console.error("[api/mp/me/profile] update fail", updateErr);
    return NextResponse.json(
      { error: "保存失败：" + updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, display_name: raw });
}
