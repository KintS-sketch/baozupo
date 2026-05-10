import { describe, expect, it } from "vitest";
import { computeReading } from "./meter-billing";

describe("computeReading", () => {
  it("首次抄表：无上次读数 → 用量与金额均为 null", () => {
    expect(computeReading(1234.5, null, 0.6)).toEqual({ usage: null, amount: null });
  });

  it("正常增量：本次 - 上次 = 用量；用量 × 单价 = 金额", () => {
    expect(computeReading(1500, 1200, 0.6)).toEqual({ usage: 300, amount: 180 });
  });

  it("用量带小数：四舍五入到 3 位", () => {
    expect(computeReading(123.4567, 100, 1)).toEqual({ usage: 23.457, amount: 23.46 });
  });

  it("金额四舍五入到 2 位", () => {
    expect(computeReading(110.333, 100, 0.6)).toEqual({ usage: 10.333, amount: 6.2 });
  });

  it("没填单价：用量算出，金额为 null", () => {
    expect(computeReading(1500, 1200, null)).toEqual({ usage: 300, amount: null });
  });

  it("读数倒退（换表场景）：用量与金额计 0", () => {
    expect(computeReading(50, 9000, 0.6)).toEqual({ usage: 0, amount: 0 });
  });

  it("读数相同：用量与金额都是 0", () => {
    expect(computeReading(1500, 1500, 0.6)).toEqual({ usage: 0, amount: 0 });
  });
});
