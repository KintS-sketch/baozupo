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

/** AI 功能状态 */
export type AiFeatureStatus = "available" | "coming_soon" | "disabled";

export const AI_FEATURE_STATUS: Record<string, AiFeatureStatus> = {
  payment_recognition: "coming_soon",
  lease_ocr: "coming_soon",
  smart_reminder: "coming_soon",
};
