/**
 * 哈希工具：SHA256 用于 PDF 文件存证、短信验证码哈希。
 * 依据《电子签名法》第 13 条第 (3)(4) 项：签名/内容改动可发现。
 */

import { createHash, timingSafeEqual } from "crypto";

/** 计算任意 Buffer/string 的 SHA256（hex 编码，64 字符）。*/
export function sha256Hex(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 把短信验证码 + 签署方 id（当 salt）哈希后存库，避免明文留底。
 * 同一个 code 给两个不同 signer 哈希出来不一样，防回滚攻击。
 */
export function hashSmsCode(code: string, signerId: string): string {
  return sha256Hex(`${code}|${signerId}`);
}

/** 恒时比较两个 hex 字符串，防计时攻击。 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
