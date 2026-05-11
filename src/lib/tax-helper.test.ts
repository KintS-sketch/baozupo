import { describe, it, expect } from "vitest";
import {
  summarizeYear,
  estimateLeaseYearlyRent,
  summaryToCSV,
  type PaymentRecord,
  type LeaseSnapshot,
} from "./tax-helper";

const leaseFull: LeaseSnapshot = {
  property_id: "p1",
  property_name: "莲塘 2 室",
  monthly_rent: 3500,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  status: "active",
};

const leaseHalf: LeaseSnapshot = {
  property_id: "p2",
  property_name: "福田 1 居",
  monthly_rent: 2800,
  start_date: "2026-07-01",
  end_date: "2026-12-31",
  status: "active",
};

describe("estimateLeaseYearlyRent", () => {
  it("整年覆盖", () => {
    expect(estimateLeaseYearlyRent(leaseFull, 2026)).toBe(3500 * 12);
  });

  it("半年覆盖（7-12 月）", () => {
    expect(estimateLeaseYearlyRent(leaseHalf, 2026)).toBe(2800 * 6);
  });

  it("非该年范围 → 0", () => {
    expect(estimateLeaseYearlyRent(leaseFull, 2025)).toBe(0);
    expect(estimateLeaseYearlyRent(leaseFull, 2027)).toBe(0);
  });

  it("已 terminated → 0", () => {
    expect(estimateLeaseYearlyRent({ ...leaseFull, status: "terminated" }, 2026)).toBe(0);
  });
});

describe("summarizeYear", () => {
  const payments: PaymentRecord[] = [
    { amount: 3500, paid_at: "2026-01-15", property_id: "p1", property_name: "莲塘 2 室", tenant_name: "张三" },
    { amount: 3500, paid_at: "2026-02-15", property_id: "p1", property_name: "莲塘 2 室", tenant_name: "张三" },
    { amount: 2800, paid_at: "2026-07-05", property_id: "p2", property_name: "福田 1 居", tenant_name: "李四" },
    { amount: 1000, paid_at: "2025-12-31", property_id: "p1", property_name: "莲塘 2 室", tenant_name: "张三" }, // 不计入 2026
  ];

  it("仅聚合指定年份", () => {
    const s = summarizeYear(2026, payments, [leaseFull, leaseHalf]);
    expect(s.totalReceived).toBe(3500 + 3500 + 2800);
    expect(s.paymentCount).toBe(3);
  });

  it("月度桶按月分配", () => {
    const s = summarizeYear(2026, payments, [leaseFull, leaseHalf]);
    expect(s.monthly[0].received).toBe(3500); // 1 月
    expect(s.monthly[1].received).toBe(3500); // 2 月
    expect(s.monthly[6].received).toBe(2800); // 7 月
    expect(s.monthly[2].received).toBe(0);    // 3 月
  });

  it("房源聚合按金额降序", () => {
    const s = summarizeYear(2026, payments, [leaseFull, leaseHalf]);
    expect(s.byProperty[0].propertyId).toBe("p1");
    expect(s.byProperty[0].received).toBe(7000);
    expect(s.byProperty[1].propertyId).toBe("p2");
    expect(s.byProperty[1].received).toBe(2800);
  });

  it("年度预计 = 所有租约该年应收之和", () => {
    const s = summarizeYear(2026, payments, [leaseFull, leaseHalf]);
    expect(s.totalExpected).toBe(3500 * 12 + 2800 * 6);
  });

  it("租客去重计数", () => {
    const s = summarizeYear(2026, payments, [leaseFull, leaseHalf]);
    expect(s.tenantCount).toBe(2);
  });

  it("无 payment 但有 lease → 房源仍出现（received 为 0）", () => {
    const s = summarizeYear(2026, [], [leaseFull]);
    expect(s.byProperty.length).toBe(1);
    expect(s.byProperty[0].received).toBe(0);
    expect(s.totalReceived).toBe(0);
    expect(s.totalExpected).toBe(3500 * 12);
  });
});

describe("summaryToCSV", () => {
  it("生成的 CSV 含 BOM + 总览 + 月度 + 房源", () => {
    const s = summarizeYear(2026, [
      { amount: 3500, paid_at: "2026-01-15", property_id: "p1", property_name: "莲塘 2 室", tenant_name: "张三" },
    ], [leaseFull]);
    const csv = summaryToCSV(s);
    expect(csv.startsWith("﻿")).toBe(true); // BOM
    expect(csv).toContain("2026 年度收入汇总");
    expect(csv).toContain("【总览】");
    expect(csv).toContain("【按月份】");
    expect(csv).toContain("【按房源】");
    expect(csv).toContain("莲塘 2 室");
    expect(csv).toContain("最终税额以税务机关核定为准");
  });
});
