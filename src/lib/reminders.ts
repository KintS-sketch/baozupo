/**
 * 提醒生成算法
 *
 * 触发规则（V1.0）：
 * - 租金到期：bill 状态非 paid，且 due_date 距今为 -3 / 0 / +1 / +7 天
 * - 合同到期：lease 状态为 active，且 end_date 距今为 30 / 7 天
 * - 抄表/自定义：暂不自动生成（用户手动新增）
 *
 * 设计：每次用户加载主页时调 ensureReminders()，幂等：
 * - 计算"今天应有"的 plan
 * - 取出已存在 reminders（按 type/related_id/remind_at 去重）
 * - 找出差集 → 批量 INSERT
 *
 * remind_at 精度到日期（不到时分秒），同一天同来源同类型只生成一条。
 */

export type ReminderTriggerType = "rent_due" | "lease_expiry";

export interface ReminderPlan {
  type: ReminderTriggerType;
  title: string;
  content: string;
  related_id: string;
  related_type: "bill" | "lease";
  remind_at: string; // YYYY-MM-DD
}

export interface BillForReminder {
  id: string;
  due_date: string; // YYYY-MM-DD
  status: string;
  property_name: string | null;
  tenant_name: string | null;
  total_amount: number;
  paid_amount: number;
}

export interface LeaseForReminder {
  id: string;
  end_date: string; // YYYY-MM-DD
  status: string;
  property_name: string | null;
}

const RENT_DUE_OFFSETS = [-3, 0, 1, 7] as const;
const LEASE_EXPIRY_OFFSETS = [30, 7] as const;

export function generateReminderPlans(
  bills: BillForReminder[],
  leases: LeaseForReminder[],
  today: Date
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  const todayKey = formatDate(today);

  for (const bill of bills) {
    if (bill.status === "paid") continue;
    const due = parseDate(bill.due_date);
    if (!due) continue;

    for (const offset of RENT_DUE_OFFSETS) {
      // offset = -3 表示提前 3 天提醒（即 remind_at = due_date - 3 天）
      // offset =  0 表示当天
      // offset =  1 / 7 表示逾期后 1 / 7 天
      const remindDate = addDays(due, offset);
      const remindKey = formatDate(remindDate);
      // 仅生成"今天及之前"应该有的提醒（避免一次性生成未来全部）
      if (remindKey > todayKey) continue;

      const remaining = Number(bill.total_amount) - Number(bill.paid_amount);
      const property = bill.property_name ?? "房源";
      const tenant = bill.tenant_name ? `（${bill.tenant_name}）` : "";

      let title: string;
      let content: string;
      if (offset < 0) {
        title = `${property}${tenant} 租金 ${-offset} 天后到期`;
        content = `应收 ¥${remaining.toFixed(2)}，到期日 ${bill.due_date}`;
      } else if (offset === 0) {
        title = `${property}${tenant} 租金今日到期`;
        content = `应收 ¥${remaining.toFixed(2)}`;
      } else {
        title = `${property}${tenant} 租金已逾期 ${offset} 天`;
        content = `应收 ¥${remaining.toFixed(2)}，原到期日 ${bill.due_date}`;
      }

      plans.push({
        type: "rent_due",
        title,
        content,
        related_id: bill.id,
        related_type: "bill",
        remind_at: remindKey,
      });
    }
  }

  for (const lease of leases) {
    if (lease.status !== "active") continue;
    const end = parseDate(lease.end_date);
    if (!end) continue;

    for (const offset of LEASE_EXPIRY_OFFSETS) {
      const remindDate = addDays(end, -offset);
      const remindKey = formatDate(remindDate);
      if (remindKey > todayKey) continue;

      const property = lease.property_name ?? "房源";
      plans.push({
        type: "lease_expiry",
        title: `${property} 合同 ${offset} 天后到期`,
        content: `合同到期日 ${lease.end_date}，请提前确认续租或退租`,
        related_id: lease.id,
        related_type: "lease",
        remind_at: remindKey,
      });
    }
  }

  return plans;
}

/**
 * 比较计划与已存在的提醒，返回需要新增的部分
 * 去重键：type + related_id + remind_at
 */
export function diffReminderPlans<T extends { type: string; related_id: string | null; remind_at: string }>(
  plans: ReminderPlan[],
  existing: T[]
): ReminderPlan[] {
  const existingKeys = new Set(
    existing.map((e) => `${e.type}|${e.related_id ?? ""}|${normalizeRemindAt(e.remind_at)}`)
  );
  return plans.filter(
    (p) => !existingKeys.has(`${p.type}|${p.related_id}|${p.remind_at}`)
  );
}

function normalizeRemindAt(raw: string): string {
  // 把数据库里 timestamp（带时分秒/时区）规整为 YYYY-MM-DD
  const t = raw.indexOf("T");
  return t > 0 ? raw.slice(0, 10) : raw.slice(0, 10);
}

function parseDate(s: string): Date | null {
  // 期望 YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
