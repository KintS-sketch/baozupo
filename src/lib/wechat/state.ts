import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * OAuth state 参数防 CSRF
 *
 * 设计：state = `{userId}.{timestamp}.{hmac}`
 *   - 业务方在用户点"绑定微信"时签发
 *   - 微信回调时验证签名 + 验证 10 分钟内
 *   - 不需要 DB / Redis 存 token
 *
 * 安全要点：
 *   - HMAC secret 必须是高熵随机字符串，泄漏 = 攻击者可冒充任意用户绑定
 *   - timing-safe 比较防止时序攻击
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟有效

function getSecret(): string {
  const s = process.env.WECHAT_OAUTH_STATE_SECRET;
  if (!s || s.length < 32) {
    throw new Error("WECHAT_OAUTH_STATE_SECRET 未配置或太短（至少 32 字符）");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function encodeState(userId: string): string {
  const ts = Date.now().toString(36);
  const payload = `${userId}.${ts}`;
  return `${payload}.${sign(payload)}`;
}

export interface DecodedState {
  userId: string;
  issuedAt: number;
}

export function decodeState(state: string | null): DecodedState | null {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, tsBase36, providedHmac] = parts;
  const payload = `${userId}.${tsBase36}`;
  const expectedHmac = sign(payload);

  if (providedHmac.length !== expectedHmac.length) return null;
  const a = Buffer.from(providedHmac, "hex");
  const b = Buffer.from(expectedHmac, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const issuedAt = parseInt(tsBase36, 36);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > STATE_TTL_MS) return null;

  return { userId, issuedAt };
}
