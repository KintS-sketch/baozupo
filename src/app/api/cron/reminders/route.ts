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
 * Vercel Cron 每天调一次，扫描所有已绑定微信的用户，按规则推送：
 *   1. 账单到期：今天到期 / 已逾期 1-7 天
 *   2. 抄表提醒：上次抄表 ≥ 28 天前，或从未抄过
 *   3. 租约到期：还有 30 / 7 / 0 天
 *
 * 安全：Vercel Cron 调用时会带 Authorization: Bearer ${CRON_SECRET}，
 *      用 CRON_SECRET 验证身份，避免被公网随便触发。
 *
 * 去重：每次推送写一条 wechat_push_logs 记录，
 *      下次扫描时按 (user_id, template_key, related_id) 跳过已推送的实体。
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

async function pushBillReminders(
  admin: Admin,
  userId: string,
  openid: string,
  householdIds: string[],
  summary: PushSummary
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const { data } = await admin
    .from("bills")
    .select(
      "id, amount, due_date, status, property:properties!inner(name), leases(lease_tenants(is_primary, tenant:tenants(name)))"
    )
    .in("household_id", householdIds)
    .in("status", ["pending", "partial", "overdue"])
    .gte("due_date", sevenDaysAgo.toISOString().slice(0, 10))
    .lte("due_date", today.toISOString().slice(0, 10));

  const bills = (data ?? []) as unknown as BillRow[];

  for (const bill of bills) {
    if (await hasBeenPushed(admin, userId, "bill_due", bill.id)) continue;

    const dueDate = new Date(bill.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (24 * 3600 * 1000));

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

    await logPush(admin, userId, openid, "bill_due", "bill", bill.id, result);
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

async function pushLeaseReminders(
  admin: Admin,
  userId: string,
  openid: string,
  householdIds: string[],
  summary: PushSummary
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDates = [0, 7, 30].map((offset) => {
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
    if (await hasBeenPushed(admin, userId, "lease_expiry", lease.id)) continue;

    const endDate = new Date(lease.end_date);
    const daysLeft = Math.floor((endDate.getTime() - today.getTime()) / (24 * 3600 * 1000));
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

    await logPush(admin, userId, openid, "lease_expiry", "lease", lease.id, result);
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

async function hasBeenPushed(
  admin: Admin,
  userId: string,
  templateKey: string,
  relatedId: string
): Promise<boolean> {
  const { data } = await admin
    .from("wechat_push_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("template_key", templateKey)
    .eq("related_id", relatedId)
    .eq("status", "success")
    .maybeSingle();
  return !!data;
}

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

async function logPush(
  admin: Admin,
  userId: string,
  openid: string,
  templateKey: string,
  relatedType: string,
  relatedId: string,
  result: { success: boolean; error?: string }
) {
  await admin.from("wechat_push_logs").insert({
    user_id: userId,
    openid,
    template_key: templateKey,
    related_type: relatedType,
    related_id: relatedId,
    status: result.success ? "success" : "failed",
    error_msg: result.error ?? null,
  });
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
