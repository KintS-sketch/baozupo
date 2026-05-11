import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isWechatConfigured,
  sendBillDueReminder,
  sendLeaseExpiryReminder,
  sendMeterDueReminder,
} from "@/lib/wechat";
import { METER_TYPE_UNITS } from "@/types";
import type { MeterType } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/reminders
 *
 * Vercel Cron 每天 UTC 0:00（北京 08:00）扫描所有已绑定微信的用户。
 *
 * 推送规则（克制版 - 避免骚扰）：
 *   账单到期 → D-1（提前 1 天）+ D=0（当天）+ D+3（逾期 3 天）
 *   租约到期 → D-14（提前半月）+ D-1（提前 1 天）
 *   抄表提醒 → 上次抄表 ≥ 28 天前或从未抄过，每月每表一次
 *
 * 安全：Vercel Cron 调用时会带 Authorization: Bearer ${CRON_SECRET}。
 *
 * 去重：通过 wechat_push_logs.error_msg 字段编码 dedup_key 实现
 *      （例如 bill-{id}-d1before，每个 stage 推一次）。
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://baozupo.vercel.app";

type Admin = SupabaseClient<any, any, any>;

interface PushSummary {
  scanned_users: number;
  bills_pushed: number;
  meters_pushed: number;
  leases_pushed: number;
  errors: string[];
}

export async function GET(request: Request) {
  // 鉴权：Vercel Cron 会自动带这个 header
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isWechatConfigured()) {
    return NextResponse.json({
      ok: false,
      reason: "wechat_not_configured",
      message: "WECHAT_APPID / WECHAT_APPSECRET 未配置，跳过推送",
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, reason: "service_role_missing" },
      { status: 500 }
    );
  }
  const admin: Admin = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary: PushSummary = {
    scanned_users: 0,
    bills_pushed: 0,
    meters_pushed: 0,
    leases_pushed: 0,
    errors: [],
  };

  // 拉所有绑定了微信的用户
  const { data: users, error: usersErr } = await admin
    .from("user_profiles")
    .select("id, wechat_openid")
    .not("wechat_openid", "is", null);

  if (usersErr) {
    return NextResponse.json(
      { ok: false, error: usersErr.message },
      { status: 500 }
    );
  }
  summary.scanned_users = users?.length ?? 0;

  for (const user of (users ?? []) as Array<{ id: string; wechat_openid: string }>) {
    try {
      const openid = user.wechat_openid;
      const userId = user.id;

      // 查这个用户能访问的所有 household
      const { data: householdRows } = await admin
        .from("household_members")
        .select("household_id")
        .eq("user_id", userId);
      const householdIds = ((householdRows ?? []) as Array<{ household_id: string }>).map(
        (r) => r.household_id
      );
      if (householdIds.length === 0) continue;

      await pushBillReminders(admin, userId, openid, householdIds, summary);
      await pushLeaseReminders(admin, userId, openid, householdIds, summary);
      await pushMeterReminders(admin, userId, openid, householdIds, summary);
    } catch (err) {
      summary.errors.push(`user ${user.id}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, summary });
}

// ============================================================
// 账单到期 — 今天到期 / 逾期 1-7 天
// ============================================================

interface BillRow {
  id: string;
  amount: number | string;
  due_date: string;
  status: string;
  property: { name: string } | null;
  leases: { lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } | null }> } | null;
}

// 三个触发点：D-1（明天到期）/ D=0（今天到期）/ D+3（逾期 3 天）
// daysOverdue 视角：D-1 = -1，D=0 = 0，D+3 = +3
const BILL_OFFSETS = [-1, 0, 3] as const;

function stageLabel(daysOverdue: number): string {
  if (daysOverdue < 0) return `d${-daysOverdue}before`;
  if (daysOverdue === 0) return "d0";
  return `d${daysOverdue}after`;
}

async function pushBillReminders(
  admin: Admin,
  userId: string,
  openid: string,
  householdIds: string[],
  summary: PushSummary
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // due_date 与今天的偏移：daysOverdue = -1 时 due_date = today+1 (明天)
  const targetDates = BILL_OFFSETS.map((daysOverdue) => {
    const d = new Date(today);
    d.setDate(today.getDate() - daysOverdue);
    return d.toISOString().slice(0, 10);
  });

  const { data } = await admin
    .from("bills")
    .select(
      "id, amount, due_date, status, property:properties!inner(name), leases(lease_tenants(is_primary, tenant:tenants(name)))"
    )
    .in("household_id", householdIds)
    .in("status", ["pending", "partial", "overdue"])
    .in("due_date", targetDates);

  const bills = (data ?? []) as unknown as BillRow[];

  for (const bill of bills) {
    const dueDate = new Date(bill.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (24 * 3600 * 1000));
    const dedupKey = `bill-${bill.id}-${stageLabel(daysOverdue)}`;

    if (await hasBeenPushedByKey(admin, userId, "bill_due", dedupKey)) continue;

    const propertyName = bill.property?.name ?? "—";
    const primaryTenant =
      bill.leases?.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.name ?? "租客";

    const result = await sendBillDueReminder({
      openid,
      propertyName,
      tenantName: primaryTenant,
      amount: Number(bill.amount),
      dueDate: bill.due_date,
      daysOverdue,
      billId: bill.id,
      baseUrl: BASE_URL,
    });

    await logPushByKey(admin, userId, openid, "bill_due", dedupKey, result);
    if (result.success) summary.bills_pushed++;
  }
}

// ============================================================
// 租约到期 — 还有 30 / 7 / 0 天
// ============================================================

interface LeaseRow {
  id: string;
  end_date: string;
  property: { name: string } | null;
  lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } | null }>;
}

// 两个触发点：D-14（提前半月）+ D-1（提前 1 天）
const LEASE_OFFSETS = [14, 1] as const;

async function pushLeaseReminders(
  admin: Admin,
  userId: string,
  openid: string,
  householdIds: string[],
  summary: PushSummary
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDates = LEASE_OFFSETS.map((offset) => {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    return d.toISOString().slice(0, 10);
  });

  const { data } = await admin
    .from("leases")
    .select(
      "id, end_date, property:properties!inner(name), lease_tenants(is_primary, tenant:tenants(name))"
    )
    .in("household_id", householdIds)
    .eq("status", "active")
    .in("end_date", targetDates);

  const leases = (data ?? []) as unknown as LeaseRow[];

  for (const lease of leases) {
    const endDate = new Date(lease.end_date);
    const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / (24 * 3600 * 1000));
    const dedupKey = `lease-${lease.id}-d${daysLeft}before`;

    if (await hasBeenPushedByKey(admin, userId, "lease_expiry", dedupKey)) continue;

    const propertyName = lease.property?.name ?? "—";
    const tenantName =
      lease.lease_tenants?.find((lt) => lt.is_primary)?.tenant?.name ?? "租客";

    const result = await sendLeaseExpiryReminder({
      openid,
      propertyName,
      tenantName,
      endDate: lease.end_date,
      daysLeft,
      leaseId: lease.id,
      baseUrl: BASE_URL,
    });

    await logPushByKey(admin, userId, openid, "lease_expiry", dedupKey, result);
    if (result.success) summary.leases_pushed++;
  }
}

// ============================================================
// 抄表提醒 — 上次抄表 ≥ 28 天前 / 从未抄过
// ============================================================

interface PropertyRow {
  id: string;
  name: string;
}

interface MeterReadingRow {
  value: number | string;
  reading_date: string;
}

async function pushMeterReminders(
  admin: Admin,
  userId: string,
  openid: string,
  householdIds: string[],
  summary: PushSummary
) {
  const { data } = await admin
    .from("properties")
    .select("id, name")
    .in("household_id", householdIds)
    .eq("status", "rented");
  const properties = (data ?? []) as unknown as PropertyRow[];

  for (const property of properties) {
    for (const meterType of ["water", "electricity", "gas"] as const) {
      const { data: lastData } = await admin
        .from("meter_readings")
        .select("value, reading_date")
        .eq("property_id", property.id)
        .eq("type", meterType)
        .order("reading_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastReading = lastData as unknown as MeterReadingRow | null;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let shouldPush = false;
      let lastReadingStr: string | null = null;
      let lastDate: string | null = null;

      if (!lastReading) {
        shouldPush = true;
      } else {
        const lastD = new Date(lastReading.reading_date);
        const daysSince = Math.floor((today.getTime() - lastD.getTime()) / (24 * 3600 * 1000));
        if (daysSince >= 28) {
          shouldPush = true;
          lastReadingStr = `${lastReading.value} ${METER_TYPE_UNITS[meterType as MeterType]}`;
          lastDate = lastReading.reading_date;
        }
      }

      if (!shouldPush) continue;

      const dedupKey = `${property.id}-${meterType}-${today.toISOString().slice(0, 7)}`;
      if (await hasBeenPushedByKey(admin, userId, "meter_due", dedupKey)) continue;

      const result = await sendMeterDueReminder({
        openid,
        propertyName: property.name,
        meterType,
        lastReading: lastReadingStr,
        lastDate,
        baseUrl: BASE_URL,
      });

      await logPushByKey(admin, userId, openid, "meter_due", dedupKey, result);
      if (result.success) summary.meters_pushed++;
    }
  }
}

// ============================================================
// 去重 / 日志 helper
// ============================================================
// 统一用 dedup_key 编码到 error_msg 字段（避免改表结构）
//   bill-{billId}-{d1before|d0|d3after}
//   lease-{leaseId}-d{N}before
//   meter-{propertyId}-{type}-{yyyy-mm}

async function hasBeenPushedByKey(
  admin: Admin,
  userId: string,
  templateKey: string,
  dedupKey: string
): Promise<boolean> {
  const { data } = await admin
    .from("wechat_push_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("template_key", templateKey)
    .eq("error_msg", `dedup:${dedupKey}`)
    .eq("status", "success")
    .maybeSingle();
  return !!data;
}

async function logPushByKey(
  admin: Admin,
  userId: string,
  openid: string,
  templateKey: string,
  dedupKey: string,
  result: { success: boolean; error?: string }
) {
  await admin.from("wechat_push_logs").insert({
    user_id: userId,
    openid,
    template_key: templateKey,
    related_type: null,
    related_id: null,
    status: result.success ? "success" : "failed",
    error_msg: result.success ? `dedup:${dedupKey}` : `${result.error}; dedup:${dedupKey}`,
  });
}
