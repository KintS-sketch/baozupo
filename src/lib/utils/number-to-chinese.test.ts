import { describe, it, expect } from "vitest";
import { numberToChinese } from "./number-to-chinese";

describe("numberToChinese", () => {
  it("整数 0", () => {
    expect(numberToChinese(0)).toBe("零元整");
  });
  it("整数 1", () => {
    expect(numberToChinese(1)).toBe("壹元整");
  });
  it("整数 1234", () => {
    expect(numberToChinese(1234)).toBe("壹仟贰佰叁拾肆元整");
  });
  it("整数 100000", () => {
    expect(numberToChinese(100000)).toBe("壹拾万元整");
  });
  it("小数 0.05", () => {
    expect(numberToChinese(0.05)).toBe("零元零伍分");
  });
  it("小数 12.34", () => {
    expect(numberToChinese(12.34)).toBe("壹拾贰元叁角肆分");
  });
  it("小数 1000.50", () => {
    expect(numberToChinese(1000.5)).toBe("壹仟元伍角");
  });
});
