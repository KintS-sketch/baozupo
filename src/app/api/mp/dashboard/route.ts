/**
 * GET /api/mp/dashboard
 *
 * 给小程序 baozupo-mp 用的首页数据合并端点。
 * mp 端跑不了 supabase-js（mp-weixin runtime 没 URL/Headers/Response 等
 * Fetch API），所以所有数据查询在服务端做，前端只渲染。
 *
 * 完整复刻 src/app/page.tsx 里的所有 dashboard 查询。
 *
 * 认证：Authorization: Bearer <supabase access_token>
 * 返回：{ stats, recentBills, expiringLeases, pendingReminders }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

interface DashboardResponse {
  stats: {
    monthlyReceivable: number;
    monthlyReceived: number;
    overdueCount: number;
    rentedCount: number;
    vacantCount: number;
  };
  recentBills: unknown[];
  expiringLeases: unknown[];
  pendingReminders: number;
}

function emptyResponse(): DashboardResponse {
  return {
    stats: {
      monthlyReceivable: 0,
      monthlyReceived: 0,
      overdueCount: 0,
      rentedCount: 0,
      vacantCount: 0,
    },
    recentBills: [],
    expiringLeases: [],
    pendingReminders: 0,
  };
}

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 用户还没绑定家庭组（罕见，刚注册）
  if (!user.household_id) {
    return NextResponse.json(emptyResponse());
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[api/mp/dashboard] supabase env not configured");
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }

  // 用 service_role 绕过 RLS（已通过 Bearer 验证用户身份 + household_id 由
  // getUserFromBearer 从 household_members 表查出，安全）
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const hid = user.household_id;
  const now = new Date();
  const monthStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const today = toDateString(now);
  const thirtyDaysLater = toDateString(
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  );

  try {
    // 先拿这个 household 所有未删除租约的 id
    const { data: leasesIdsData } = await admin
      .from("leases")
      .select("id")
      .eq("household_id", hid)
      .is("deleted_at", null);
    const leaseIds = (leasesIdsData ?? []).map((l: { id: string }) => l.id);

    // 没租约的情况：只查房源 + 提醒
    if (leaseIds.length === 0) {
      const [{ data: propertiesData }, { count: reminderCount }] = await Promise.all([
        admin
          .from("properties")
          .select("status")
          .eq("household_id", hid)
          .is("deleted_at", null),
        admin
          .from("reminders")
          .select("id", { count: "exact", head: true })
          .eq("household_id", hid)
          .eq("is_dismissed", false),
      ]);
      const rentedCount =
        (propertiesData ?? []).filter((p: { status: string }) => p.status === "rented").length;
      const vacantCount =
        (propertiesData ?? []).filter((p: { status: string }) => p.status === "vacant").length;

      return NextResponse.json({
        stats: {
          monthlyReceivable: 0,
          monthlyReceived: 0,
          overdueCount: 0,
          rentedCount,
          vacantCount,
        },
        recentBills: [],
        expiringLeases: [],
        pendingReminders: reminderCount ?? 0,
      } satisfies DashboardResponse);
    }

    // 有租约：6 个查询并发跑
    const [
      { data: billsData },
      { data: propertiesData },
      { count: overdueCount },
      { data: recentBillsData },
      { data: expiringData },
      { count: reminderCount },
    ] = await Promise.all([
      admin
        .from("bills")
        .select("total_amount, paid_amount, status")
        .gte("due_date", monthStart)
        .lte("due_date", monthEnd)
        .in("lease_id", leaseIds),
      admin
        .from("properties")
        .select("status")
        .eq("household_id", hid)
        .is("deleted_at", null),
      admin
        .from("bills")
        .select("id", { count: "exact", head: true })
        .eq("status", "overdue")
        .in("lease_id", leaseIds),
      // 反馈 #4: 只取「当期」账单（period 含今天，或已过期未付清）
      // 服务端无法用一个查询表达 (期内 OR 已过期未付清)，所以拉所有 period_start <= today 的，
      // 再 JS filter，最后取 5 条
      admin
        .from("bills")
        .select("*")
        .in("lease_id", leaseIds)
        .lte("period_start", today)
        .order("due_date", { ascending: false })
        .limit(50),
      admin
        .from("leases")
        .select("*, property:properties(name)")
        .eq("household_id", hid)
        .eq("status", "active")
        .is("deleted_at", null)
        .lte("end_date", thirtyDaysLater)
        .gte("end_date", today)
        .order("end_date"),
      admin
        .from("reminders")
        .select("id", { count: "exact", head: true })
        .eq("household_id", hid)
        .eq("is_dismissed", false),
    ]);

    const monthlyReceivable = (billsData ?? []).reduce(
      (s: number, b: { total_amount: number | string }) => s + Number(b.total_amount),
      0
    );
    const monthlyReceived = (billsData ?? []).reduce(
      (s: number, b: { paid_amount: number | string }) => s + Number(b.paid_amount),
      0
    );
    const rentedCount =
      (propertiesData ?? []).filter((p: { status: string }) => p.status === "rented").length;
    const vacantCount =
      (propertiesData ?? []).filter((p: { status: string }) => p.status === "vacant").length;

    // 「当期」筛选：今天落在 period 内，或已过期但未付清
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const currentBills = (recentBillsData ?? [])
      .filter((b: { period_start: string; period_end: string; status: string }) => {
        const start = new Date(b.period_start);
        const end = new Date(b.period_end);
        if (todayDate >= start && todayDate <= end) return true;
        if (todayDate > end && b.status !== "paid") return true;
        return false;
      })
      .slice(0, 5);

    return NextResponse.json({
      stats: {
        monthlyReceivable,
        monthlyReceived,
        overdueCount: overdueCount ?? 0,
        rentedCount,
        vacantCount,
      },
      recentBills: currentBills,
      expiringLeases: expiringData ?? [],
      pendingReminders: reminderCount ?? 0,
    } satisfies DashboardResponse);
  } catch (err) {
    console.error("[api/mp/dashboard] query fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
