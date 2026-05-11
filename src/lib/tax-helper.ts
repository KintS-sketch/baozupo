/**
 * 个税助手 - 纯计算逻辑（无副作用，便于测试）
 *
 * Phase 1：年度租金收入汇总
 *   - 按"实际收款" paid_at 当年聚合（税务现金主义口径）
 *   - 输出：月度收入、房源明细、年度预计
 *
 * Phase 2（未来）：税额计算 + PDF 报告生成
 */

export interface PaymentRecord {
  amount: number;
  paid_at: string; // ISO 字符串
  property_id: string;
  property_name: string;
  tenant_name: string;
}

export interface LeaseSnapshot {
  property_id: string;
  property_name: string;
  monthly_rent: number;
  start_date: string;
  end_date: string;
  status: string; // active / expired / terminated
}

export interface MonthlyBucket {
  month: number; // 1-12
  received: number;
  paymentCount: number;
}

export interface PropertyBucket {
  propertyId: string;
  propertyName: string;
  received: number;
  paymentCount: number;
}

export interface YearlySummary {
  year: number;
  totalReceived: number;        // 累计已收
  totalExpected: number;        // 年度预计（基于活跃租约月租 × 在年内活跃月数）
  propertyCount: number;        // 涉及房源数
  tenantCount: number;          // 涉及租客数
  paymentCount: number;         // 收款笔数
  monthly: MonthlyBucket[];     // 12 月明细
  byProperty: PropertyBucket[]; // 按房源拆分
}

export function summarizeYear(
  year: number,
  payments: PaymentRecord[],
  leases: LeaseSnapshot[]
): YearlySummary {
  // 月度桶（1-12 月）
  const monthly: MonthlyBucket[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    received: 0,
    paymentCount: 0,
  }));

  // 房源桶
  const propertyMap = new Map<string, PropertyBucket>();
  const tenantSet = new Set<string>();
  let totalReceived = 0;
  let paymentCount = 0;

  for (const p of payments) {
    const d = new Date(p.paid_at);
    if (d.getFullYear() !== year) continue;
    const m = d.getMonth(); // 0-11
    monthly[m].received += p.amount;
    monthly[m].paymentCount += 1;
    totalReceived += p.amount;
    paymentCount += 1;

    const bucket = propertyMap.get(p.property_id) ?? {
      propertyId: p.property_id,
      propertyName: p.property_name,
      received: 0,
      paymentCount: 0,
    };
    bucket.received += p.amount;
    bucket.paymentCount += 1;
    propertyMap.set(p.property_id, bucket);

    if (p.tenant_name) tenantSet.add(p.tenant_name);
  }

  // 年度预计：所有租约在该年内"覆盖月数"乘以月租，求和
  const totalExpected = leases.reduce((sum, l) => {
    return sum + estimateLeaseYearlyRent(l, year);
  }, 0);

  // 也把"在该年活跃过的房源"加入 propertyMap（即使没收款也要显示）
  for (const l of leases) {
    if (!propertyMap.has(l.property_id) && estimateLeaseYearlyRent(l, year) > 0) {
      propertyMap.set(l.property_id, {
        propertyId: l.property_id,
        propertyName: l.property_name,
        received: 0,
        paymentCount: 0,
      });
    }
  }

  const byProperty = Array.from(propertyMap.values()).sort(
    (a, b) => b.received - a.received
  );

  return {
    year,
    totalReceived: round2(totalReceived),
    totalExpected: round2(totalExpected),
    propertyCount: byProperty.length,
    tenantCount: tenantSet.size,
    paymentCount,
    monthly: monthly.map((m) => ({ ...m, received: round2(m.received) })),
    byProperty: byProperty.map((p) => ({ ...p, received: round2(p.received) })),
  };
}

/**
 * 估算一个租约在指定年份内的应收租金
 * 算法：找出租约在该年内的活跃月数，乘以 monthly_rent
 * 简化：按完整月计算（不计部分月）
 */
export function estimateLeaseYearlyRent(lease: LeaseSnapshot, year: number): number {
  if (lease.status === "terminated") return 0;
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const leaseStart = new Date(lease.start_date);
  const leaseEnd = new Date(lease.end_date);

  // 取重叠区间
  const overlapStart = leaseStart > yearStart ? leaseStart : yearStart;
  const overlapEnd = leaseEnd < yearEnd ? leaseEnd : yearEnd;
  if (overlapStart > overlapEnd) return 0;

  // 估算月数（取整，向上偏宽）
  const months =
    (overlapEnd.getFullYear() - overlapStart.getFullYear()) * 12 +
    (overlapEnd.getMonth() - overlapStart.getMonth()) +
    1; // +1 把头尾月都算进
  return Math.max(0, months) * lease.monthly_rent;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 生成 CSV 字符串（含 BOM 防止 Excel 打开乱码）
 */
export function summaryToCSV(summary: YearlySummary): string {
  const lines: string[] = [];
  lines.push(`养房 Tend · ${summary.year} 年度收入汇总`);
  lines.push("");
  lines.push("【总览】");
  lines.push(`累计已收,${summary.totalReceived}`);
  lines.push(`年度预计,${summary.totalExpected}`);
  lines.push(`涉及房源数,${summary.propertyCount}`);
  lines.push(`涉及租客数,${summary.tenantCount}`);
  lines.push(`收款笔数,${summary.paymentCount}`);
  lines.push("");
  lines.push("【按月份】");
  lines.push("月份,已收金额,笔数");
  for (const m of summary.monthly) {
    lines.push(`${m.month}月,${m.received},${m.paymentCount}`);
  }
  lines.push("");
  lines.push("【按房源】");
  lines.push("房源,已收金额,笔数");
  for (const p of summary.byProperty) {
    lines.push(`${p.propertyName},${p.received},${p.paymentCount}`);
  }
  lines.push("");
  lines.push("说明：本表按实际收款日期统计，可作为个人所得税年度申报参考。");
  lines.push("最终税额以税务机关核定为准。");

  return "﻿" + lines.join("\n");
}
