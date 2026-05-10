// ============================================================
// 账单生成算法
// 支持：自然月模式 (natural_month) 和整月顺延模式 (rolling_month)
// ============================================================

import {
  getDaysInMonth,
  differenceInDays,
  addMonths,
  isAfter,
  isBefore,
  startOfDay,
} from "date-fns";
import type { BillingMode, BillStatus } from "@/types";

export interface BillPeriod {
  periodStart: Date;
  periodEnd: Date;
  daysInPeriod: number;
  daysInMonth: number;    // 该账期所属月的总天数
  ratio: number;          // daysInPeriod / daysInMonth，保留 6 位小数
  rentAmount: number;     // 本期租金，保留 2 位小数
  dueDate: Date;
}

/**
 * 生成一份租约的所有账单期
 * @param startDate 起租日
 * @param endDate 结束日（含）
 * @param monthlyRent 月租金（元）
 * @param mode 账单模式
 * @param rentDueDay 每月收租日（1-31）
 */
export function generateBillPeriods(
  startDate: Date,
  endDate: Date,
  monthlyRent: number,
  mode: BillingMode,
  rentDueDay: number
): BillPeriod[] {
  if (mode === "rolling_month") {
    return generateRollingMonthPeriods(startDate, endDate, monthlyRent, rentDueDay);
  }
  return generateNaturalMonthPeriods(startDate, endDate, monthlyRent, rentDueDay);
}

/**
 * 自然月模式：按日历月拆分账单
 * 示例：4月5日—8月5日，月租5000
 *  → 4/5-4/30: 26/30 = 4333.33
 *  → 5/1-5/31: 整月 5000
 *  → 6/1-6/30: 整月 5000
 *  → 7/1-7/31: 整月 5000
 *  → 8/1-8/5:  5/31 = 806.45
 */
function generateNaturalMonthPeriods(
  startDate: Date,
  endDate: Date,
  monthlyRent: number,
  rentDueDay: number
): BillPeriod[] {
  const periods: BillPeriod[] = [];
  let current = startOfDay(new Date(startDate));
  const end = startOfDay(new Date(endDate));

  while (!isAfter(current, end)) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const daysInMonth = getDaysInMonth(new Date(year, month, 1));

    const periodStart = new Date(current);
    const monthLastDay = new Date(year, month, daysInMonth);
    const periodEnd = isBefore(monthLastDay, end) ? monthLastDay : new Date(end);

    const daysInPeriod = differenceInDays(periodEnd, periodStart) + 1;
    const rawRatio = daysInPeriod / daysInMonth;
    const ratio = parseFloat(rawRatio.toFixed(6));
    // 金额从原始比例计算，避免预舍入引起的误差
    const rentAmount = parseFloat((monthlyRent * rawRatio).toFixed(2));
    const dueDate = calcDueDate(periodStart, rentDueDay);

    periods.push({ periodStart, periodEnd, daysInPeriod, daysInMonth, ratio, rentAmount, dueDate });

    // 跳到下个月第一天
    current = new Date(year, month + 1, 1);
  }

  return periods;
}

/**
 * 整月顺延模式：从起租日按整月计算
 * 示例：4月5日—
 *  → 4/5-5/4
 *  → 5/5-6/4
 *  → 6/5-7/4 ...
 */
function generateRollingMonthPeriods(
  startDate: Date,
  endDate: Date,
  monthlyRent: number,
  rentDueDay: number
): BillPeriod[] {
  const periods: BillPeriod[] = [];
  let current = startOfDay(new Date(startDate));
  const end = startOfDay(new Date(endDate));

  while (!isAfter(current, end)) {
    const periodStart = new Date(current);
    const nextMonthSameDay = addMonths(current, 1);
    // 整月末 = 下个月同一天的前一天
    const fullPeriodEnd = new Date(
      nextMonthSameDay.getFullYear(),
      nextMonthSameDay.getMonth(),
      nextMonthSameDay.getDate() - 1
    );
    const periodEnd = isBefore(fullPeriodEnd, end) ? fullPeriodEnd : new Date(end);

    const daysInPeriod = differenceInDays(periodEnd, periodStart) + 1;
    const daysInMonth = getDaysInMonth(periodStart);
    const rawRatio = daysInPeriod / daysInMonth;
    const ratio = parseFloat(rawRatio.toFixed(6));
    const rentAmount = parseFloat((monthlyRent * rawRatio).toFixed(2));
    const dueDate = calcDueDate(periodStart, rentDueDay);

    periods.push({ periodStart, periodEnd, daysInPeriod, daysInMonth, ratio, rentAmount, dueDate });

    current = new Date(nextMonthSameDay);
  }

  return periods;
}

/**
 * 计算账单到期日：收租日在账期开始当月或次月的首次出现
 */
function calcDueDate(periodStart: Date, rentDueDay: number): Date {
  const year = periodStart.getFullYear();
  const month = periodStart.getMonth();
  const dueInCurrentMonth = new Date(year, month, rentDueDay);
  if (!isBefore(dueInCurrentMonth, periodStart)) {
    return dueInCurrentMonth;
  }
  return new Date(year, month + 1, rentDueDay);
}

/**
 * 计算账单状态
 * - paid：已收 >= 应收
 * - partial：已收 > 0 且 < 应收（无论是否逾期，先标记 partial；逾期未收才为 overdue）
 * - overdue：到期日 < 今天 且 已收 < 应收
 * - pending：到期日 >= 今天 且 已收 = 0
 */
export function calculateBillStatus(
  totalAmount: number,
  paidAmount: number,
  dueDate: Date,
  today: Date = startOfDay(new Date())
): BillStatus {
  const due = startOfDay(new Date(dueDate));
  const isOverdue = isBefore(due, today);

  if (paidAmount >= totalAmount) return "paid";
  if (paidAmount > 0) return isOverdue ? "overdue" : "partial";
  return isOverdue ? "overdue" : "pending";
}
