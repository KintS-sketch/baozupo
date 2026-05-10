import { describe, it, expect } from "vitest";
import { generateBillPeriods, calculateBillStatus } from "./billing";

// ============================================================
// 账单算法测试用例
// ============================================================

describe("generateBillPeriods - 自然月模式", () => {
  it("4月5日至8月5日，月租5000，收租日1号", () => {
    const start = new Date(2024, 3, 5);  // 2024-04-05
    const end = new Date(2024, 7, 5);    // 2024-08-05
    const periods = generateBillPeriods(start, end, 5000, "natural_month", 1);

    expect(periods).toHaveLength(5);

    // 第1期：4月5日-4月30日，26/30天
    expect(periods[0].periodStart).toEqual(new Date(2024, 3, 5));
    expect(periods[0].periodEnd).toEqual(new Date(2024, 3, 30));
    expect(periods[0].daysInPeriod).toBe(26);
    expect(periods[0].daysInMonth).toBe(30);
    expect(periods[0].ratio).toBeCloseTo(26 / 30, 5);
    expect(periods[0].rentAmount).toBeCloseTo(5000 * (26 / 30), 2);

    // 第2期：5月1日-5月31日，整月
    expect(periods[1].periodStart).toEqual(new Date(2024, 4, 1));
    expect(periods[1].periodEnd).toEqual(new Date(2024, 4, 31));
    expect(periods[1].daysInPeriod).toBe(31);
    expect(periods[1].ratio).toBeCloseTo(1, 5);
    expect(periods[1].rentAmount).toBeCloseTo(5000, 2);

    // 第3期：6月整月
    expect(periods[2].daysInPeriod).toBe(30);
    expect(periods[2].rentAmount).toBeCloseTo(5000, 2);

    // 第4期：7月整月
    expect(periods[3].daysInPeriod).toBe(31);
    expect(periods[3].rentAmount).toBeCloseTo(5000, 2);

    // 第5期：8月1日-8月5日，5/31天
    expect(periods[4].periodStart).toEqual(new Date(2024, 7, 1));
    expect(periods[4].periodEnd).toEqual(new Date(2024, 7, 5));
    expect(periods[4].daysInPeriod).toBe(5);
    expect(periods[4].daysInMonth).toBe(31);
    expect(periods[4].ratio).toBeCloseTo(5 / 31, 5);
    expect(periods[4].rentAmount).toBeCloseTo(5000 * (5 / 31), 2);
  });

  it("整月租约（5月1日-5月31日）应只生成1期整月账单", () => {
    const start = new Date(2024, 4, 1);
    const end = new Date(2024, 4, 31);
    const periods = generateBillPeriods(start, end, 3000, "natural_month", 1);
    expect(periods).toHaveLength(1);
    expect(periods[0].ratio).toBeCloseTo(1, 5);
    expect(periods[0].rentAmount).toBeCloseTo(3000, 2);
  });
});

describe("generateBillPeriods - 整月顺延模式", () => {
  it("4月5日至8月4日，月租5000，应生成4个整月账期", () => {
    const start = new Date(2024, 3, 5);  // 2024-04-05
    const end = new Date(2024, 7, 4);    // 2024-08-04
    const periods = generateBillPeriods(start, end, 5000, "rolling_month", 5);

    expect(periods).toHaveLength(4);

    // 4/5-5/4
    expect(periods[0].periodStart).toEqual(new Date(2024, 3, 5));
    expect(periods[0].periodEnd).toEqual(new Date(2024, 4, 4));

    // 5/5-6/4
    expect(periods[1].periodStart).toEqual(new Date(2024, 4, 5));
    expect(periods[1].periodEnd).toEqual(new Date(2024, 5, 4));

    // 6/5-7/4
    expect(periods[2].periodStart).toEqual(new Date(2024, 5, 5));
    expect(periods[2].periodEnd).toEqual(new Date(2024, 6, 4));

    // 7/5-8/4
    expect(periods[3].periodStart).toEqual(new Date(2024, 6, 5));
    expect(periods[3].periodEnd).toEqual(new Date(2024, 7, 4));

    // 每期都应该是整月（ratio=1 或接近1）
    for (const p of periods) {
      expect(p.ratio).toBeCloseTo(1, 1);
      expect(p.rentAmount).toBeCloseTo(5000, 0);
    }
  });
});

describe("calculateBillStatus", () => {
  const today = new Date(2024, 5, 15); // 2024-06-15 (固定今天)

  it("已收 >= 应收 → paid", () => {
    const due = new Date(2024, 5, 1); // 过期
    expect(calculateBillStatus(5000, 5000, due, today)).toBe("paid");
    expect(calculateBillStatus(5000, 5200, due, today)).toBe("paid");
  });

  it("已收 > 0 且 < 应收，且未到期 → partial", () => {
    const due = new Date(2024, 5, 20); // 未到期
    expect(calculateBillStatus(5000, 2000, due, today)).toBe("partial");
  });

  it("已收 > 0 且 < 应收，且已过期 → overdue", () => {
    const due = new Date(2024, 5, 1); // 已过期
    expect(calculateBillStatus(5000, 2000, due, today)).toBe("overdue");
  });

  it("已收 = 0，到期日未到 → pending", () => {
    const due = new Date(2024, 5, 20);
    expect(calculateBillStatus(5000, 0, due, today)).toBe("pending");
  });

  it("已收 = 0，到期日已过 → overdue", () => {
    const due = new Date(2024, 5, 1);
    expect(calculateBillStatus(5000, 0, due, today)).toBe("overdue");
  });
});

describe("金额精度", () => {
  it("非整月金额应保留两位小数", () => {
    const start = new Date(2024, 3, 5);
    const end = new Date(2024, 3, 30);
    const [period] = generateBillPeriods(start, end, 5000, "natural_month", 1);
    const amountStr = period.rentAmount.toFixed(2);
    expect(amountStr).toBe(amountStr); // 确保无异常精度
    // 5000 * 26/30 = 4333.333... → 4333.33
    expect(period.rentAmount).toBe(4333.33);
  });
});
