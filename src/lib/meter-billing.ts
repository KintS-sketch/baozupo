/**
 * 抄表用量与费用计算
 *
 * 用量 = 本次读数 - 上次读数（首次抄表无上次读数则用量为 null）
 * 金额 = 用量 × 单价（用量为 null 时金额也为 null）
 *
 * 数据库使用 NUMERIC 存储，前端用 number 计算后再保存。
 * 浮点误差在 2 位/3 位小数处截断。
 */

export interface ComputedReading {
  usage: number | null;
  amount: number | null;
}

export function computeReading(
  currentValue: number,
  previousValue: number | null,
  unitPrice: number | null
): ComputedReading {
  if (previousValue === null || previousValue === undefined) {
    return { usage: null, amount: null };
  }

  const rawUsage = currentValue - previousValue;
  if (rawUsage < 0) {
    // 读数倒退（如换表）— 用量记 0，提示用户在 notes 说明
    return { usage: 0, amount: 0 };
  }

  const usage = round(rawUsage, 3);
  if (unitPrice === null || unitPrice === undefined) {
    return { usage, amount: null };
  }

  const amount = round(usage * unitPrice, 2);
  return { usage, amount };
}

function round(n: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}
