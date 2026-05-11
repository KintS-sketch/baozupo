import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/wechat/unbind
 * 当前用户解除微信绑定（清空 wechat_openid 字段）
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({
      wechat_openid: null,
      wechat_nickname: null,
      wechat_bound_at: null,
      wechat_subscribed: false,
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
