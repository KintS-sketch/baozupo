import { describe, expect, it } from "vitest";
import {
  generateReminderPlans,
  diffReminderPlans,
  type BillForReminder,
  type LeaseForReminder,
} from "./reminders";

const today = new Date(2026, 4, 9); // 2026-05-09

const baseBill: BillForReminder = {
  id: "bill-1",
  due_date: "2026-05-12",
  status: "pending",
  property_name: "Apt 101",
  tenant_name: "张三",
  total_amount: 3000,
  paid_amount: 0,
};

const baseLease: LeaseForReminder = {
  id: "lease-1",
  end_date: "2026-06-08",
  status: "active",
  property_name: "Apt 101",
};

describe("generateReminderPlans - 租金", () => {
  it("已支付账单：不生成任何提醒", () => {
    const paid = { ...baseBill, status: "paid" };
    expect(generateReminderPlans([paid], [], today)).toEqual([]);
  });

  it("到期 3 天前的提醒（today=05-09, due=05-12）", () => {
    const plans = generateReminderPlans([baseBill], [], today);
    const rentDue = plans.filter((p) => p.type === "rent_due");
    expect(rentDue).toHaveLength(1);
    expect(rentDue[0].remind_at).toBe("2026-05-09");
    expect(rentDue[0].title).toContain("3 天后");
    expect(rentDue[0].related_id).toBe("bill-1");
  });

  it("到期当天（today=05-12, due=05-12）：生成 -3 和 0 两条都已 ≤ today", () => {
    const plans = generateReminderPlans([{ ...baseBill, due_date: "2026-05-12" }], [], new Date(2026, 4, 12));
    const rentDue = plans.filter((p) => p.type === "rent_due");
    expect(rentDue.map((p) => p.remind_at).sort()).toEqual(["2026-05-09", "2026-05-12"]);
    expect(rentDue.find((p) => p.remind_at === "2026-05-12")?.title).toContain("今日到期");
  });

  it("逾期 7 天（today=05-19, due=05-12）：生成 -3, 0, +1, +7 全部", () => {
    const plans = generateReminderPlans([{ ...baseBill, due_date: "2026-05-12" }], [], new Date(2026, 4, 19));
    const rentDue = plans.filter((p) => p.type === "rent_due");
    expect(rentDue.map((p) => p.remind_at).sort()).toEqual([
      "2026-05-09",
      "2026-05-12",
      "2026-05-13",
      "2026-05-19",
    ]);
    expect(rentDue.find((p) => p.remind_at === "2026-05-19")?.title).toContain("已逾期 7 天");
  });

  it("未来很远的账单：不生成", () => {
    const future = { ...baseBill, due_date: "2027-01-01" };
    expect(generateReminderPlans([future], [], today)).toEqual([]);
  });

  it("title 中包含房源名和租客名", () => {
    const plans = generateReminderPlans([baseBill], [], today);
    expect(plans[0].title).toContain("Apt 101");
    expect(plans[0].title).toContain("张三");
  });
});

describe("generateReminderPlans - 合同到期", () => {
  it("active 租约 30 天前提醒（today=05-09, end=06-08）", () => {
    const plans = generateReminderPlans([], [baseLease], today);
    const lease = plans.filter((p) => p.type === "lease_expiry");
    expect(lease).toHaveLength(1);
    expect(lease[0].remind_at).toBe("2026-05-09");
    expect(lease[0].title).toContain("30 天后");
  });

  it("非 active 租约：不生成", () => {
    const expired = { ...baseLease, status: "expired" };
    expect(generateReminderPlans([], [expired], today)).toEqual([]);
  });

  it("距离 7 天（today=06-01, end=06-08）：生成 30+7 两条", () => {
    const plans = generateReminderPlans([], [baseLease], new Date(2026, 5, 1));
    const lease = plans.filter((p) => p.type === "lease_expiry");
    expect(lease.map((p) => p.remind_at).sort()).toEqual(["2026-05-09", "2026-06-01"]);
  });
});

describe("diffReminderPlans", () => {
  it("已存在相同 type+related_id+remind_at：过滤掉", () => {
    const plans = generateReminderPlans([baseBill], [], today);
    const existing = [
      { type: "rent_due", related_id: "bill-1", remind_at: "2026-05-09T00:00:00.000Z" },
    ];
    expect(diffReminderPlans(plans, existing)).toEqual([]);
  });

  it("不同 remind_at：保留", () => {
    const plans = generateReminderPlans([{ ...baseBill, due_date: "2026-05-12" }], [], new Date(2026, 4, 12));
    const existing = [
      { type: "rent_due", related_id: "bill-1", remind_at: "2026-05-09" },
    ];
    const diff = diffReminderPlans(plans, existing);
    expect(diff.map((d) => d.remind_at)).toEqual(["2026-05-12"]);
  });

  it("空 existing：全部保留", () => {
    const plans = generateReminderPlans([baseBill], [baseLease], today);
    expect(diffReminderPlans(plans, [])).toHaveLength(plans.length);
  });
});
