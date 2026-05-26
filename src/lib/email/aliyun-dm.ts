/**
 * 阿里云 DirectMail（邮件推送）SDK 封装
 *
 * 不引入 SDK，直接用 fetch + HMAC-SHA1 签名（跟阿里云 RPC 风格 API 通用方案）。
 * 接口文档：https://help.aliyun.com/document_detail/29444.html
 *
 * 需要 .env.production 配置：
 *   ALIYUN_DM_ACCESS_KEY_ID=<可与短信共用，但推荐独立 RAM 用户>
 *   ALIYUN_DM_ACCESS_KEY_SECRET=
 *   ALIYUN_DM_REGION=cn-hangzhou        # 或 ap-southeast-1 等
 *   ALIYUN_DM_ACCOUNT_NAME=noreply@mail.tendapp.cn   # 已配置好的发信地址
 *   ALIYUN_DM_FROM_ALIAS=养房 Tend       # 邮件显示发件人名
 *   ALIYUN_DM_TEMPLATE_LOGIN_OTP_SUBJECT=养房 Tend 登录验证码
 *
 * 注意：阿里云邮件「触发型模板」是单独的模板系统（不像短信那样有 TemplateCode），
 *      验证码邮件直接用 SingleSendMail 接口发即可，TextBody 自定义。
 */

import { createHmac, randomBytes } from "crypto";

export interface SendEmailResult {
  ok: boolean;
  envId?: string; // 阿里云 EnvId
  code?: string;
  message?: string;
}

function urlEncodeRfc3986(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * 阿里云 RPC 风格 API 签名（HMAC-SHA1）
 * 用于 dm/sms/cdn 等老接口
 */
function sign(params: Record<string, string>, accessKeySecret: string): string {
  // 1. 按 key 字典序排序
  const sortedKeys = Object.keys(params).sort();
  // 2. URL 编码 key=value 拼接
  const canonical = sortedKeys
    .map((k) => `${urlEncodeRfc3986(k)}=${urlEncodeRfc3986(params[k])}`)
    .join("&");
  // 3. StringToSign = "GET&%2F&" + urlEncode(canonical)
  const stringToSign = `GET&${urlEncodeRfc3986("/")}&${urlEncodeRfc3986(canonical)}`;
  // 4. HMAC-SHA1(stringToSign, accessKeySecret + "&"), base64
  return createHmac("sha1", accessKeySecret + "&").update(stringToSign).digest("base64");
}

interface SendArgs {
  to: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
}

async function sendMail(args: SendArgs): Promise<SendEmailResult> {
  const accessKeyId = process.env.ALIYUN_DM_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_DM_ACCESS_KEY_SECRET;
  const region = process.env.ALIYUN_DM_REGION ?? "cn-hangzhou";
  const accountName = process.env.ALIYUN_DM_ACCOUNT_NAME;
  const fromAlias = process.env.ALIYUN_DM_FROM_ALIAS ?? "养房 Tend";

  if (!accessKeyId || !accessKeySecret || !accountName) {
    return {
      ok: false,
      message: "DirectMail 未配置（ALIYUN_DM_ACCESS_KEY_ID / SECRET / ACCOUNT_NAME 缺）",
    };
  }

  // 选 endpoint：国内用 cn-hangzhou，国际用 ap-southeast-1
  const endpoint =
    region === "ap-southeast-1"
      ? "https://dm.ap-southeast-1.aliyuncs.com"
      : "https://dm.aliyuncs.com";

  const commonParams: Record<string, string> = {
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: randomBytes(16).toString("hex"),
    Timestamp: new Date().toISOString(),
    Action: "SingleSendMail",
    RegionId: region,
  };

  const businessParams: Record<string, string> = {
    AccountName: accountName,
    AddressType: "1", // 0 = 随机账号，1 = 发信地址
    ReplyToAddress: "false",
    ToAddress: args.to,
    FromAlias: fromAlias,
    Subject: args.subject,
  };
  if (args.textBody) businessParams.TextBody = args.textBody;
  if (args.htmlBody) businessParams.HtmlBody = args.htmlBody;

  const allParams = { ...commonParams, ...businessParams };
  const signature = sign(allParams, accessKeySecret);
  allParams.Signature = signature;

  // 拼 query string
  const qs = Object.keys(allParams)
    .map((k) => `${urlEncodeRfc3986(k)}=${urlEncodeRfc3986(allParams[k])}`)
    .join("&");

  try {
    const resp = await fetch(`${endpoint}/?${qs}`, { method: "GET" });
    const json = (await resp.json()) as {
      EnvId?: string;
      RequestId?: string;
      Code?: string;
      Message?: string;
    };
    if (!resp.ok || json.Code) {
      return {
        ok: false,
        code: json.Code,
        message: json.Message ?? `HTTP ${resp.status}`,
      };
    }
    return { ok: true, envId: json.EnvId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/**
 * 登录/注册验证码邮件
 *
 * 邮件标题: 养房 Tend 登录验证码
 * 邮件正文: 您正在登录养房 Tend，验证码 ${code}，10 分钟内有效，请勿泄露。
 */
export function sendLoginEmailOtp(email: string, code: string): Promise<SendEmailResult> {
  const subject =
    process.env.ALIYUN_DM_TEMPLATE_LOGIN_OTP_SUBJECT ?? "养房 Tend 登录验证码";
  const textBody = `您正在登录养房 Tend，验证码 ${code}，10 分钟内有效，请勿泄露给他人。

如非本人操作，请忽略此邮件。

— 养房 Tend 团队`;
  const htmlBody = `<!doctype html>
<html lang="zh-CN">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FFF8F1;padding:32px 16px;color:#3C281E;line-height:1.6;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(60,40,30,0.08);">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:24px;font-weight:700;color:#C8553D;">养房</span>
      <span style="font-size:14px;color:#a08a7a;letter-spacing:3px;margin-left:8px;">TEND</span>
    </div>
    <h2 style="font-size:18px;font-weight:600;margin:0 0 16px;">您正在登录养房 Tend</h2>
    <p style="margin:0 0 24px;color:#6b5848;">请使用以下验证码完成登录，<strong>10 分钟内有效</strong>，请勿泄露给他人。</p>
    <div style="background:#FFF1E5;border-radius:12px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#C8553D;font-family:'SF Mono',Menlo,monospace;">${code}</div>
    <p style="margin:24px 0 0;font-size:12px;color:#a08a7a;">如非本人操作，请忽略此邮件。</p>
  </div>
  <p style="text-align:center;margin:16px 0 0;font-size:12px;color:#a08a7a;">— 养房 Tend 团队</p>
</body>
</html>`;
  return sendMail({ to: email, subject, textBody, htmlBody });
}
