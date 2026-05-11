import { WechatError, WechatOAuthUserInfo, WechatApiError } from "./types";

/**
 * 微信网页授权（OAuth2）
 *
 * 流程：
 * 1. 业务方调 buildAuthorizeUrl() 生成跳转链接
 * 2. 用户在微信内点链接 → 自动授权（snsapi_userinfo 弹窗 / snsapi_base 静默）
 * 3. 微信跳转到 redirect_uri?code=xxx&state=yyy
 * 4. 业务方调 exchangeCodeForUserInfo(code) 拿到 openid + nickname
 *
 * 安全：state 参数应使用一次性的、绑定 user_id 的 token，防止 CSRF
 */

export function buildAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  scope?: "snsapi_base" | "snsapi_userinfo";
}): string {
  const appid = process.env.WECHAT_APPID;
  if (!appid) {
    throw new WechatError(
      "WECHAT_APPID 未配置",
      -1,
      "服务端缺少公众号凭据"
    );
  }
  const params = new URLSearchParams({
    appid,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope ?? "snsapi_userinfo",
    state: opts.state,
  });
  return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
}

interface WechatOAuthTokenResp {
  access_token: string;     // 网页授权专用 access_token（与公众号全局的不同）
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

/**
 * 用 code 换 openid + （可选）用户资料
 *
 * 如果 scope=snsapi_base，只能拿到 openid；
 * 如果 scope=snsapi_userinfo，可以再调 /sns/userinfo 拿到 nickname + 头像
 */
export async function exchangeCodeForUserInfo(code: string): Promise<WechatOAuthUserInfo> {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) {
    throw new WechatError(
      "WECHAT_APPID / WECHAT_APPSECRET 未配置",
      -1,
      "服务端缺少公众号凭据"
    );
  }

  const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(
    appid
  )}&secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;

  const tokenResp = await fetch(tokenUrl, { cache: "no-store" });
  const tokenJson = (await tokenResp.json()) as WechatOAuthTokenResp | WechatApiError;

  if ("errcode" in tokenJson && tokenJson.errcode !== 0) {
    throw new WechatError(
      `OAuth token 错误：${tokenJson.errcode} - ${tokenJson.errmsg}`,
      tokenJson.errcode,
      tokenJson.errmsg
    );
  }

  const tokenData = tokenJson as WechatOAuthTokenResp;
  const result: WechatOAuthUserInfo = {
    openid: tokenData.openid,
    unionid: tokenData.unionid,
  };

  // 如果是 snsapi_userinfo 范围，再拉一次拿昵称头像
  if (tokenData.scope.includes("snsapi_userinfo")) {
    const infoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${tokenData.access_token}&openid=${tokenData.openid}&lang=zh_CN`;
    const infoResp = await fetch(infoUrl, { cache: "no-store" });
    const infoJson = (await infoResp.json()) as
      | { openid: string; nickname: string; headimgurl: string; unionid?: string }
      | WechatApiError;

    if (!("errcode" in infoJson) || infoJson.errcode === 0) {
      const info = infoJson as { nickname: string; headimgurl: string };
      result.nickname = info.nickname;
      result.headimgurl = info.headimgurl;
    }
  }

  return result;
}
