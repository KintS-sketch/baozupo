/**
 * 阿里云短信 SDK 封装（电子签约用）。
 *
 * SDK：@alicloud/dysmsapi20170525 v3+（基于 @darabonba/typescript + openapi-core）
 *
 * 模板需提前在阿里云控制台申请 SMS_XXXXXX 模板号：
 *   - INVITE: ${name} 邀请您签订租房合同，请打开 ${url} 完成签字
 *   - VERIFY: 您正在签订租房合同，验证码 ${code}，5 分钟内有效
 *   - DONE:   您的租房合同已完成签字，下载 ${url}
 */

import Client from "@alicloud/dysmsapi20170525";
import { SendSmsRequest } from "@alicloud/dysmsapi20170525/dist/models/SendSmsRequest";
import { $OpenApiUtil } from "@alicloud/openapi-core";

export interface SendSmsResult {
  ok: boolean;
  bizId?: string;
  code?: string;
  message?: string;
}

function getClient(): Client {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("ALIYUN_SMS_ACCESS_KEY_ID / SECRET not set");
  }
  const config = new $OpenApiUtil.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: "dysmsapi.aliyuncs.com",
  });
  return new Client(config);
}

async function sendOne(
  phone: string,
  templateCode: string,
  params: Record<string, string>
): Promise<SendSmsResult> {
  if (!templateCode) {
    return { ok: false, message: "templateCode 未配置（请检查 ALIYUN_SMS_TEMPLATE_* 环境变量）" };
  }
  const signName = process.env.ALIYUN_SMS_SIGN_NAME ?? "养房Tend";
  try {
    const client = getClient();
    const req = new SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: JSON.stringify(params),
    });
    const resp = await client.sendSms(req);
    const body = resp.body;
    return {
      ok: body?.code === "OK",
      bizId: body?.bizId,
      code: body?.code,
      message: body?.message,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/** 邀请签字短信（带公开签字页链接）。`name` 限阿里云模板字符长度（一般 20 字内）。*/
export function sendContractInviteSms(phone: string, landlordName: string, url: string) {
  return sendOne(phone, process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_INVITE ?? "", {
    name: landlordName.slice(0, 16),
    url,
  });
}

/** 短信验证码 */
export function sendContractVerifySms(phone: string, code: string) {
  return sendOne(phone, process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_VERIFY ?? "", { code });
}

/** 签字完成通知 */
export function sendContractDoneSms(phone: string, downloadUrl: string) {
  return sendOne(phone, process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_DONE ?? "", { url: downloadUrl });
}
