/**
 * 令牌 / 验证码生成工具。
 */

import { randomBytes } from "crypto";

/**
 * 公开签字令牌：32 字节 → 64 hex 字符。
 * 用于 /sign/[token] 公开签字页的访问鉴权。
 */
export function generatePublicToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 6 位短信验证码（首位非 0，避免 0xxxxx 被部分短信网关误判 / 用户读取困难）。
 */
export function generateSmsCode(): string {
  const first = String(Math.floor(Math.random() * 9) + 1);
  const rest = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return first + rest;
}
