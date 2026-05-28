/**
 * 电子合同（轻签约 v1）类型定义。
 * 对应数据库 contracts / contract_signers 表（migration 0013）。
 */

export type ContractStatus = "draft" | "partial" | "signed" | "void" | "expired";
export type ContractTemplateType = "direct" | "agent";
export type SignerRole = "landlord" | "agent" | "tenant" | "broker";

export interface Contract {
  id: string;
  household_id: string;
  lease_id: string;
  template_type: ContractTemplateType;
  status: ContractStatus;
  pdf_initial_path: string | null;
  pdf_final_path: string | null;
  pdf_hash_sha256: string | null;
  ts_token: string | null;
  expires_at: string;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ContractSigner {
  id: string;
  contract_id: string;
  role: SignerRole;
  sign_order: number;
  name: string;
  phone: string;
  id_number: string | null;
  public_token: string | null;
  signed_at: string | null;
  sign_ip: string | null;
  sign_ua: string | null;
  signature_image_path: string | null;
  sms_code_hash: string | null;
  sms_code_expires_at: string | null;
  sms_sent_at: string | null;
  sms_verified_at: string | null;
  sms_attempts: number;
  sms_locked_until: string | null;
  created_at: string;
}

export interface ContractWithSigners extends Contract {
  signers: ContractSigner[];
}

/** API 通用响应 */
export interface ContractApiResponse<T = Record<string, unknown>> {
  success: boolean;
  error?: string;
  data?: T;
}
