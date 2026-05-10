// ============================================================
// 格式化工具函数
// ============================================================

import { format, parseISO, isValid } from "date-fns";
import { zhCN } from "date-fns/locale";

/** 格式化金额，保留两位小数，加千分位 */
export function formatAmount(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** 格式化为带¥符号的金额 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `¥${formatAmount(amount)}`;
}

/** 格式化日期：YYYY年MM月DD日 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const date = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    if (!isValid(date)) return "—";
    return format(date, "yyyy年MM月dd日", { locale: zhCN });
  } catch {
    return "—";
  }
}

/** 格式化日期：MM/DD */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const date = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    if (!isValid(date)) return "—";
    return format(date, "MM/dd", { locale: zhCN });
  } catch {
    return "—";
  }
}

/** 格式化为 input[type=date] 的值 (YYYY-MM-DD) */
export function toDateInput(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const date = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    if (!isValid(date)) return "";
    return format(date, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

/** 手机号脱敏：138****5678 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

/** 身份证脱敏：110***********1234 */
export function maskIdNumber(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 8) return "****";
  return id.slice(0, 3) + "*".repeat(id.length - 7) + id.slice(-4);
}

/** 验证手机号格式（中国大陆） */
export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.trim());
}

/** 验证身份证号格式（简单校验） */
export function isValidIdCard(id: string): boolean {
  return /^\d{15}$|^\d{17}[\dXx]$/.test(id.trim());
}

/** 格式化账期：2024年5月 */
export function formatPeriod(startStr: string, endStr: string): string {
  const start = formatDate(startStr);
  const end = formatDate(endStr);
  return `${start} — ${end}`;
}

/** 计算两个日期之间的月数（近似） */
export function monthsBetween(startStr: string, endStr: string): number {
  try {
    const start = parseISO(startStr);
    const end = parseISO(endStr);
    return (
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    );
  } catch {
    return 0;
  }
}
