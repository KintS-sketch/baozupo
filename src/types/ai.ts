// ============================================================
// AI 截图识别相关类型 (预留：Phase 2 接入 Claude API)
// ============================================================

import type { PaymentMethod } from "./index";

/** AI 识别付款截图的输出结构 */
export interface AiPaymentRecognitionResult {
  amount: number;
  paid_at: string;            // ISO 8601 日期字符串
  from_name: string | null;   // 付款方姓名
  to_name: string | null;     // 收款方姓名
  method: PaymentMethod;
  confidence: number;         // 0-1，识别置信度
}

/** AI 识别请求体 */
export interface AiRecognizePaymentRequest {
  bill_id: string;
  image_base64?: string;      // base64 编码的图片
  image_url?: string;         // 或图片 URL
}

/** AI 识别响应体 */
export interface AiRecognizePaymentResponse {
  success: boolean;
  data?: AiPaymentRecognitionResult;
  error?: string;
  // 预留：Phase 2 实际接入时填充
  model?: string;
  tokens_used?: number;
}

/** AI 抄表识别 - 输出 */
export interface AiMeterRecognitionResult {
  type: "water" | "electricity" | "gas" | "unknown";
  value: number;            // 当前读数
  unit: string | null;      // 单位（kWh / 吨 / m³），AI 推断
  confidence: number;       // 0-1，整体识别置信度
  display_value: string | null; // 表盘上显示的原始字符串（如 "12345.67"）
}

/** AI 抄表识别 - 请求 */
export interface AiRecognizeMeterRequest {
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** 可选：用户已知道的表类型，让模型更聚焦 */
  hint_type?: "water" | "electricity" | "gas";
}

/** AI 抄表识别 - 响应 */
export interface AiRecognizeMeterResponse {
  success: boolean;
  data?: AiMeterRecognitionResult;
  error?: string;
  model?: string;
  tokens_used?: number;
}

/** AI 身份证识别 - 输出 */
export interface AiIdCardRecognitionResult {
  name: string | null;
  id_number: string | null;            // 18 位身份证号
  gender: "male" | "female" | null;
  birthday: string | null;             // YYYY-MM-DD
  address: string | null;
  confidence: number;
}

/** AI 身份证识别 - 请求 */
export interface AiRecognizeIdCardRequest {
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

/** AI 身份证识别 - 响应 */
export interface AiRecognizeIdCardResponse {
  success: boolean;
  data?: AiIdCardRecognitionResult;
  error?: string;
  model?: string;
  tokens_used?: number;
}

/** AI 功能状态 */
export type AiFeatureStatus = "available" | "coming_soon" | "disabled";

export const AI_FEATURE_STATUS: Record<string, AiFeatureStatus> = {
  payment_recognition: "available",
  meter_recognition: "available",
  id_card_recognition: "available",
  lease_ocr: "coming_soon",
  smart_reminder: "coming_soon",
};
