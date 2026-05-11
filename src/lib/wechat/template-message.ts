import { callWechatApi } from "./client";
import {
  WechatTemplateKey,
  WechatTemplateMessageData,
  WechatTemplateMessagePayload,
} from "./types";

/**
 * 模板消息发送
 *
 * 三个业务模板（需在公众号后台先申请获取 template_id，填到环境变量）：
 *   1. bill_due     — 账单到期提醒（收租日）
 *   2. meter_due    — 抄表提醒（每月抄表日）
 *   3. lease_expiry — 租约到期提醒（合同期满前 30 / 7 天）
 *
 * 用户体验角度：颜色使用品牌色 #C8553D（陶土色），符合"养房 Tend"温柔调性
 */

const TEMPLATE_ID_MAP: Record<WechatTemplateKey, string | undefined> = {
  bill_due:     process.env.WECHAT_TEMPLATE_BILL_DUE,
  meter_due:    process.env.WECHAT_TEMPLATE_METER_DUE,
  lease_expiry: process.env.WECHAT_TEMPLATE_LEASE_EXPIRY,
};

interface SendTemplateOptions {
  templateKey: WechatTemplateKey;
  openid: string;
  data: WechatTemplateMessageData;
  url?: string; // PWA 点击跳转地址（如 /bills/{id}）
}

interface SendTemplateResult {
  success: boolean;
  msgid?: number;
  error?: string;
}

export async function sendTemplateMessage(
  opts: SendTemplateOptions
): Promise<SendTemplateResult> {
  const templateId = TEMPLATE_ID_MAP[opts.templateKey];
  if (!templateId) {
    return {
      success: false,
      error: `模板 ${opts.templateKey} 未配置 WECHAT_TEMPLATE_${opts.templateKey.toUpperCase()}`,
    };
  }

  const payload: WechatTemplateMessagePayload = {
    touser: opts.openid,
    template_id: templateId,
    url: opts.url,
    data: opts.data,
  };

  try {
    const resp = await callWechatApi<{ errcode: number; errmsg: string; msgid: number }>(
      "/cgi-bin/message/template/send",
      payload
    );
    return { success: true, msgid: resp.msgid };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

// ============================================================
// 三个业务模板的便捷封装
// ============================================================

const BRAND_COLOR = "#C8553D";

/**
 * 账单到期提醒
 *
 * 模板预期字段（公众号后台申请时按此填）：
 *   {{first.DATA}}        提醒标题（如"您有一笔租金即将到期"）
 *   {{property.DATA}}     房源名（如"莲塘 2 室"）
 *   {{tenant.DATA}}       租客姓名
 *   {{amount.DATA}}       金额（¥ 3500）
 *   {{due_date.DATA}}     到期日（2026-05-15）
 *   {{remark.DATA}}       备注（如"今天到期 / 已逾期 3 天"）
 */
export async function sendBillDueReminder(opts: {
  openid: string;
  propertyName: string;
  tenantName: string;
  amount: number;
  dueDate: string;       // YYYY-MM-DD
  daysOverdue: number;   // 正数 = 已逾期；0 = 今天到期；负数 = 还有 N 天
  billId: string;
  baseUrl: string;       // 例如 https://baozupo.vercel.app
}): Promise<SendTemplateResult> {
  // 三档：D-1（提前 1 天）/ D=0（今天）/ D+3（逾期 3 天）
  const first =
    opts.daysOverdue >= 1
      ? `🌧 已逾期 ${opts.daysOverdue} 天`
      : opts.daysOverdue === 0
        ? "🌱 今日收租日"
        : "🌿 明天收租日";

  const remark =
    opts.daysOverdue >= 1
      ? `已逾期 ${opts.daysOverdue} 天，建议尽快联系租客`
      : opts.daysOverdue === 0
        ? "今天就是收租日，记得查收哦"
        : "明天到期，可以提前打个招呼";

  return sendTemplateMessage({
    templateKey: "bill_due",
    openid: opts.openid,
    url: `${opts.baseUrl}/bills?highlight=${opts.billId}`,
    data: {
      first:        { value: first, color: BRAND_COLOR },
      property:     { value: opts.propertyName },
      tenant:       { value: opts.tenantName },
      amount:       { value: `¥${opts.amount.toFixed(2)}`, color: BRAND_COLOR },
      due_date:     { value: opts.dueDate },
      remark:       { value: remark, color: "#888888" },
    },
  });
}

/**
 * 抄表提醒
 *
 * 模板预期字段：
 *   {{first.DATA}}        提醒标题
 *   {{property.DATA}}     房源
 *   {{meter_type.DATA}}   表类型（水 / 电 / 燃气）
 *   {{last_reading.DATA}} 上次读数（带单位）
 *   {{last_date.DATA}}    上次抄表日期
 *   {{remark.DATA}}       提示
 */
export async function sendMeterDueReminder(opts: {
  openid: string;
  propertyName: string;
  meterType: "water" | "electricity" | "gas";
  lastReading: string | null;   // "1234.5 kWh" 已格式化
  lastDate: string | null;
  baseUrl: string;
}): Promise<SendTemplateResult> {
  const typeLabel = { water: "水表", electricity: "电表", gas: "燃气表" }[opts.meterType];
  return sendTemplateMessage({
    templateKey: "meter_due",
    openid: opts.openid,
    url: `${opts.baseUrl}/meters`,
    data: {
      first:        { value: `📸 该抄${typeLabel}啦`, color: BRAND_COLOR },
      property:     { value: opts.propertyName },
      meter_type:   { value: typeLabel },
      last_reading: { value: opts.lastReading ?? "—" },
      last_date:    { value: opts.lastDate ?? "首次抄表" },
      remark:       {
        value: "拍一下表盘照片，AI 自动识别读数",
        color: "#888888",
      },
    },
  });
}

/**
 * 租约到期提醒
 *
 * 模板预期字段：
 *   {{first.DATA}}        提醒标题
 *   {{property.DATA}}     房源
 *   {{tenant.DATA}}       租客
 *   {{end_date.DATA}}     合同结束日
 *   {{days_left.DATA}}    剩余天数
 *   {{remark.DATA}}       建议动作
 */
export async function sendLeaseExpiryReminder(opts: {
  openid: string;
  propertyName: string;
  tenantName: string;
  endDate: string;
  daysLeft: number;
  leaseId: string;
  baseUrl: string;
}): Promise<SendTemplateResult> {
  // 两档：D-14（提前半月）/ D-1（提前 1 天）
  const first =
    opts.daysLeft <= 1
      ? "🌾 明天合同到期"
      : `🌾 租约还有 ${opts.daysLeft} 天到期`;

  const remark =
    opts.daysLeft <= 1
      ? "建议今天就确认续约 / 退租安排"
      : "可以开始沟通续约 / 退租意向，留出充足时间";

  return sendTemplateMessage({
    templateKey: "lease_expiry",
    openid: opts.openid,
    url: `${opts.baseUrl}/leases?highlight=${opts.leaseId}`,
    data: {
      first:     { value: first, color: BRAND_COLOR },
      property:  { value: opts.propertyName },
      tenant:    { value: opts.tenantName },
      end_date:  { value: opts.endDate },
      days_left: { value: `${opts.daysLeft} 天`, color: BRAND_COLOR },
      remark:    { value: remark, color: "#888888" },
    },
  });
}
