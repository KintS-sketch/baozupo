/**
 * GET /api/mp/subscription
 *
 * 当前用户订阅状态 + Pro 功能清单（用于 mp 端订阅页展示）。
 * 升级/购买流程引导用户去网页版（mp 内不发起支付）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const PRO_FEATURES = [
  { icon: "building-2", title: "无限房源", desc: "免费版限 3 套，Pro 不限" },
  { icon: "message-circle", title: "微信自动提醒", desc: "收租 / 抄表 / 合同到期自动推送" },
  { icon: "users", title: "家庭成员无限", desc: "免费版限 1 个，Pro 不限" },
  { icon: "calculator", title: "个税 Pro 报告", desc: "自动算税额 + PDF 申报报告（即将上线）" },
  { icon: "file-text", title: "Excel 多 sheet 导出", desc: "数据完整带出" },
  { icon: "sparkles", title: "优先客服", desc: "问题 1 工作日内响应" },
];

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, source, started_at, expires_at, notes")
    .eq("user_id", user.id)
    .maybeSingle();

  const plan = (sub?.plan as "free" | "pro") ?? "free";
  const isPro = plan === "pro";
  // 过期检查：如果 expires_at 在过去，视为 free
  const expired =
    !!sub?.expires_at && new Date(sub.expires_at) < new Date();
  const effectivePlan = isPro && !expired ? "pro" : "free";

  return NextResponse.json({
    plan: effectivePlan,
    source: sub?.source ?? null,
    started_at: sub?.started_at ?? null,
    expires_at: sub?.expires_at ?? null,
    features: PRO_FEATURES,
    upgrade_url: "https://tendapp.cn/subscription",
    note: "升级 Pro 请在网页版完成（小程序暂不支持支付）",
  });
}
