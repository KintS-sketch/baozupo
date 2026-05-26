/**
 * PUT /api/mp/me/profile
 *
 * 更新当前用户的「档案字段」。
 * 支持 display_name（昵称）和 avatar_url（头像）。
 * 两个字段都是可选的，传哪个改哪个。两个都不传报 400。
 *
 * Body:
 *   { display_name?: string }  // 长度 1-20，前后空格自动去掉
 *   { avatar_url?: string }    // 头像 URL（一般是 /api/mp/me/avatar 返回的 supabase storage URL）
 * Auth: Authorization: Bearer <supabase access_token>
 * Returns: { success: true, display_name?, avatar_url? }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { display_name?: string; avatar_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const updates: { display_name?: string; avatar_url?: string } = {};

  // display_name（可选）
  if (body.display_name !== undefined) {
    const raw = (body.display_name ?? "").toString().trim();
    if (!raw) {
      return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
    }
    if (raw.length > 20) {
      return NextResponse.json({ error: "昵称最多 20 个字" }, { status: 400 });
    }
    updates.display_name = raw;
  }

  // avatar_url（可选）
  if (body.avatar_url !== undefined) {
    const raw = (body.avatar_url ?? "").toString().trim();
    if (raw && !/^https?:\/\//i.test(raw)) {
      return NextResponse.json({ error: "avatar_url 必须是 http(s) 链接" }, { status: 400 });
    }
    if (raw.length > 1024) {
      return NextResponse.json({ error: "avatar_url 过长" }, { status: 400 });
    }
    updates.avatar_url = raw;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "至少要传 display_name 或 avatar_url" },
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

  const { error: updateErr } = await admin
    .from("user_profiles")
    .update(updates)
    .eq("id", user.id);

  if (updateErr) {
    console.error("[api/mp/me/profile] update fail", updateErr);
    return NextResponse.json(
      { error: "保存失败：" + updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...updates });
}
