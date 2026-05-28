/**
 * 阿拉伯数字转人民币大写（用于合同金额）。
 *
 * 输入：1234.56 → 输出："壹仟贰佰叁拾肆元伍角陆分"
 * 整数：附加"整"，如 100 → "壹佰元整"
 *
 * 限制：仅支持小于 9999_9999_9999.99 的非负数。
 */

const DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const UNITS = ["", "拾", "佰", "仟"];
const BIG_UNITS = ["", "万", "亿"];

function intToChinese(n: number): string {
  if (n === 0) return "零";

  let result = "";
  let bigIdx = 0;

  while (n > 0) {
    const group = n % 10000;
    n = Math.floor(n / 10000);

    if (group === 0) {
      if (result && !result.startsWith("零")) {
        result = "零" + result;
      }
      bigIdx++;
      continue;
    }

    let groupStr = "";
    let unitIdx = 0;
    let g = group;
    let lastZero = false;

    while (g > 0) {
      const d = g % 10;
      if (d === 0) {
        if (!lastZero && groupStr) {
          groupStr = "零" + groupStr;
        }
        lastZero = true;
      } else {
        groupStr = DIGITS[d] + UNITS[unitIdx] + groupStr;
        lastZero = false;
      }
      g = Math.floor(g / 10);
      unitIdx++;
    }

    result = groupStr + BIG_UNITS[bigIdx] + result;
    bigIdx++;
  }

  result = result.replace(/零+$/, "");
  return result;
}

export function numberToChinese(amount: number): string {
  if (amount < 0) throw new Error("不支持负数");
  if (amount > 9999_9999_9999.99) throw new Error("金额过大");

  const yuan = Math.floor(amount);
  const fenTotal = Math.round((amount - yuan) * 100);
  const jiao = Math.floor(fenTotal / 10);
  const fen = fenTotal % 10;

  if (yuan === 0 && fenTotal === 0) return "零元整";

  let result = "";
  if (yuan > 0) {
    result += intToChinese(yuan) + "元";
  } else {
    result += "零元";
  }

  if (jiao === 0 && fen === 0) {
    result += "整";
  } else {
    if (jiao > 0) {
      result += DIGITS[jiao] + "角";
    } else if (fen > 0) {
      result += "零";
    }
    if (fen > 0) {
      result += DIGITS[fen] + "分";
    }
  }

  return result;
}
