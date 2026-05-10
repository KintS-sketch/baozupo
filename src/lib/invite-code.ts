/**
 * 邀请码生成
 *
 * 6 位字符，从 INVITE_ALPHABET 中选取（排除易混的 0/O/1/I/L 等）
 * 6 位 × 28 字符 = 481M 组合，碰撞概率足够低
 */

// 28 字符表：去掉 0/O/I/1/L 这些容易看错的
const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".split("");

export function generateInviteCode(length = 6): string {
  let code = "";
  // 浏览器/Node 都有 crypto.getRandomValues
  const buf = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
  }
  for (let i = 0; i < length; i++) {
    code += INVITE_ALPHABET[buf[i] % INVITE_ALPHABET.length];
  }
  return code;
}

export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[01ILO]/g, (c) => {
      // 用户输入的 0/O 都视为 0 但表里没有，纠正常见误读
      if (c === "0" || c === "O") return "";
      if (c === "1" || c === "I" || c === "L") return "";
      return c;
    });
}
