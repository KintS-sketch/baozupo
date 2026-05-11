export * from "./types";
export { getAccessToken, callWechatApi, clearAccessTokenCache } from "./client";
export { buildAuthorizeUrl, exchangeCodeForUserInfo } from "./oauth";
export {
  sendTemplateMessage,
  sendBillDueReminder,
  sendMeterDueReminder,
  sendLeaseExpiryReminder,
} from "./template-message";

/**
 * 检查微信公众号接入是否已配置好
 */
export function isWechatConfigured(): boolean {
  return !!(process.env.WECHAT_APPID && process.env.WECHAT_APPSECRET);
}
