import { WechatAccessToken, WechatError, WechatApiError } from "./types";

/**
 * 微信公众号 access_token 客户端
 *
 * 设计要点：
 * - access_token 有效期 2 小时，必须**进程级缓存**避免每次重新获取
 *   （微信对单一应用每天有 2000 次 token 获取上限）
 * - 在 Vercel Serverless 环境，每次 cold start 会清空内存缓存
 *   → 这里只做"单实例热请求"的优化；高频场景应该改用 Redis / KV
 * - 实际部署内测期一天调用 < 50 次，内存缓存够用
 */

let cachedToken: WechatAccessToken | null = null;

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at - REFRESH_BUFFER_MS > now) {
    return cachedToken.access_token;
  }

  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;

  if (!appid || !secret) {
    throw new WechatError(
      "WECHAT_APPID / WECHAT_APPSECRET 未配置",
      -1,
      "服务端缺少公众号凭据，请配置环境变量"
    );
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
    appid
  )}&secret=${encodeURIComponent(secret)}`;

  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new WechatError(
      `微信 token 接口 HTTP ${resp.status}`,
      resp.status,
      "无法连接微信服务器"
    );
  }

  const json = (await resp.json()) as
    | { access_token: string; expires_in: number }
    | WechatApiError;

  if ("errcode" in json && json.errcode !== 0) {
    throw new WechatError(
      `微信 token 错误：${json.errcode} - ${json.errmsg}`,
      json.errcode,
      json.errmsg
    );
  }

  if (!("access_token" in json)) {
    throw new WechatError("微信 token 接口返回异常", -1, "返回数据缺少 access_token");
  }

  cachedToken = {
    access_token: json.access_token,
    expires_at: now + json.expires_in * 1000,
  };

  return cachedToken.access_token;
}

/**
 * 调试用：清空 token 缓存（仅服务端，测试 / 强制刷新场景）
 */
export function clearAccessTokenCache(): void {
  cachedToken = null;
}

/**
 * 通用微信 API POST 调用 helper
 * - 自动注入 access_token
 * - 自动处理 40001 (token 失效) → 清缓存 + 重试一次
 */
export async function callWechatApi<T = unknown>(
  path: string,
  body: unknown,
  retryOnTokenExpired = true
): Promise<T> {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!resp.ok) {
    throw new WechatError(
      `微信 API HTTP ${resp.status}`,
      resp.status,
      `${path} 接口异常`
    );
  }

  const json = (await resp.json()) as Partial<WechatApiError> & T;

  if (typeof json.errcode === "number" && json.errcode !== 0) {
    // 40001 = invalid credential / 42001 = access_token expired
    if ((json.errcode === 40001 || json.errcode === 42001) && retryOnTokenExpired) {
      clearAccessTokenCache();
      return callWechatApi<T>(path, body, false);
    }
    throw new WechatError(
      `${path} 错误：${json.errcode} - ${json.errmsg ?? ""}`,
      json.errcode,
      json.errmsg ?? "未知错误"
    );
  }

  return json;
}
