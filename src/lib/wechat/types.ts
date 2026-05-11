/**
 * 微信公众号接入层 — 类型定义
 *
 * 接入对象：服务号（subscription account 订阅号没有模板消息能力）
 * 主要能力：网页授权获取 OpenID、发送模板消息、菜单管理
 */

export type WechatTemplateKey = "bill_due" | "meter_due" | "lease_expiry";

export interface WechatAccessToken {
  access_token: string;
  expires_at: number; // 毫秒时间戳，过期前 5 分钟视为失效
}

export interface WechatOAuthUserInfo {
  openid: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
}

export interface WechatTemplateMessageData {
  [key: string]: { value: string; color?: string };
}

export interface WechatTemplateMessagePayload {
  touser: string;       // 目标用户 openid
  template_id: string;  // 模板消息 ID（微信公众号后台申请）
  url?: string;         // 点击模板消息跳转的 URL（PWA 页面）
  data: WechatTemplateMessageData;
}

export interface WechatApiError {
  errcode: number;
  errmsg: string;
}

export class WechatError extends Error {
  constructor(
    message: string,
    public readonly errcode: number,
    public readonly errmsg: string
  ) {
    super(message);
    this.name = "WechatError";
  }
}
