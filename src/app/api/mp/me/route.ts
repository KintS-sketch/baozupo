/**
 * GET /api/mp/me
 *
 * 给小程序「我的」页用的账号+档案合并端点。
 * 复刻 src/app/settings/page.tsx 的两个查询：
 *   - auth.user (email, phone)
 *   - user_profiles (real_name, id_number, wechat_*)
 * 加 household 名/订阅状态（如果有 subscription 表的话——目前先返回 free，等订阅功能上线再扩）
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ user, profile, household, subscription }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export interface MeResponse {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
  };
  profile: {
    display_name: string | null;
    real_name: string | null;
    id_number: string | null;
    wechat_openid: string | null;
    wechat_nickname: string | null;
    wechat_bound_at: string | null;
  };
  household: {
    id: string;
    name: string | null;
  } | null;
  subscription: {
    plan: "free" | "pro";
  };
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const [{ data: profile }, householdResult] = await Promise.all([
      admin
        .from("user_profiles")
        .select("display_name, real_name, id_number, wechat_openid, wechat_nickname, wechat_bound_at")
        .eq("id", user.id)
        .maybeSingle(),
      user.household_id
        ? admin
            .from("households")
            .select("id, name")
            .eq("id", user.household_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const result: MeResponse = {
      user: {
        id: user.id,
        email: user.email ?? null,
        phone: user.phone ?? null,
      },
      profile: {
        display_name: profile?.display_name ?? null,
        real_name: profile?.real_name ?? null,
        id_number: profile?.id_number ?? null,
        wechat_openid: profile?.wechat_openid ?? null,
        wechat_nickname: profile?.wechat_nickname ?? null,
        wechat_bound_at: profile?.wechat_bound_at ?? null,
      },
      household: householdResult.data
        ? {
            id: (householdResult.data as { id: string }).id,
            name: (householdResult.data as { name: string | null }).name,
          }
        : user.household_id
          ? { id: user.household_id, name: null }
          : null,
      // TODO: 接入真实订阅表，目前 mp 端先固定 free
      subscription: { plan: "free" },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/mp/me] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
