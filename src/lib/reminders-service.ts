/**
 * 浏览器端提醒服务：
 * - 拉取 bills + leases + existing reminders
 * - 调 generateReminderPlans 计算应有的
 * - 用 diffReminderPlans 找出需要新增的
 * - 批量插入
 *
 * 设计为幂等：同一天多次调用不会产生重复提醒。
 */

import { createClient } from "@/lib/supabase/client";
import {
  generateReminderPlans,
  diffReminderPlans,
  type BillForReminder,
  type LeaseForReminder,
} from "@/lib/reminders";

export async function ensureReminders(householdId: string): Promise<{ inserted: number }> {
  const supabase = createClient();

  const today = new Date();

  // 1) 该家庭的所有未取消租约 ID（用于过滤 bills 和 leases）
  const { data: leasesRaw } = await supabase
    .from("leases")
    .select("id, end_date, status, property:properties(name)")
    .eq("household_id", householdId)
    .is("deleted_at", null);

  const leaseIds = (leasesRaw ?? []).map((l) => l.id);
  if (leaseIds.length === 0) return { inserted: 0 };

  // 2) Bills（未付的，带 property + tenant 信息）
  const { data: billsRaw } = await supabase
    .from("bills")
    .select(
      "id, due_date, status, total_amount, paid_amount, lease:leases(property:properties(name), lease_tenants(is_primary, tenant:tenants(name)))"
    )
    .in("lease_id", leaseIds)
    .neq("status", "paid");

  const bills: BillForReminder[] = (billsRaw ?? []).map((b: unknown) => {
    const billRow = b as {
      id: string;
      due_date: string;
      status: string;
      total_amount: number;
      paid_amount: number;
      lease?: {
        property?: { name?: string } | null;
        lease_tenants?: Array<{ is_primary: boolean; tenant?: { name?: string } | null }>;
      } | null;
    };
    const tenants = billRow.lease?.lease_tenants ?? [];
    const primary = tenants.find((t) => t.is_primary) ?? tenants[0];
    return {
      id: billRow.id,
      due_date: billRow.due_date,
      status: billRow.status,
      total_amount: Number(billRow.total_amount),
      paid_amount: Number(billRow.paid_amount),
      property_name: billRow.lease?.property?.name ?? null,
      tenant_name: primary?.tenant?.name ?? null,
    };
  });

  const leases: LeaseForReminder[] = (leasesRaw ?? []).map((l: unknown) => {
    const leaseRow = l as {
      id: string;
      end_date: string;
      status: string;
      property?: { name?: string } | null;
    };
    return {
      id: leaseRow.id,
      end_date: leaseRow.end_date,
      status: leaseRow.status,
      property_name: leaseRow.property?.name ?? null,
    };
  });

  const plans = generateReminderPlans(bills, leases, today);
  if (plans.length === 0) return { inserted: 0 };

  // 3) 拉已有的提醒做去重
  const { data: existingRaw } = await supabase
    .from("reminders")
    .select("type, related_id, remind_at")
    .eq("household_id", householdId);

  const toInsert = diffReminderPlans(plans, existingRaw ?? []);
  if (toInsert.length === 0) return { inserted: 0 };

  const rows = toInsert.map((p) => ({
    household_id: householdId,
    type: p.type,
    title: p.title,
    content: p.content,
    related_id: p.related_id,
    related_type: p.related_type,
    remind_at: p.remind_at,
    is_sent: false,
    is_dismissed: false,
  }));

  const { error } = await supabase.from("reminders").insert(rows);
  if (error) {
    console.error("[ensureReminders] insert error:", error);
    return { inserted: 0 };
  }
  return { inserted: rows.length };
}
