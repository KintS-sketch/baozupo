// ============================================================
// 核心业务类型定义
// ============================================================

export type PropertyStatus = "rented" | "vacant" | "renovating";
export type LeaseStatus = "active" | "expired" | "terminated";
export type RentalSource = "direct" | "agent";
export type BillStatus = "pending" | "partial" | "paid" | "overdue";
export type PaymentMethod = "wechat" | "alipay" | "bank" | "cash" | "other";
export type PaymentCycle = "monthly" | "quarterly" | "biannual" | "annual";
export type BillingMode = "natural_month" | "rolling_month";
export type IdType = "id_card" | "passport" | "other";
export type MeterType = "water" | "electricity" | "gas";
export type HouseholdRole = "owner" | "member";

// ============================================================
// 数据库实体类型
// ============================================================

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Household {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  created_at: string;
}

export interface Property {
  id: string;
  household_id: string;
  name: string;
  address: string;
  city: string | null;
  district: string | null;
  layout: string | null;
  area: number | null;
  status: PropertyStatus;
  notes: string | null;
  cover_image_url: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  household_id: string;
  name: string;
  phone: string;
  id_type: IdType;
  id_number: string | null; // 敏感字段，UI层需脱敏展示
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  tags: string[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lease {
  id: string;
  household_id: string;
  property_id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  payment_cycle: PaymentCycle;
  rent_due_day: number;
  billing_mode: BillingMode;
  status: LeaseStatus;
  notes: string | null;
  contract_url: string | null;
  // 新增（migration 0010）：直租 / 中介 来源
  rental_source: RentalSource;
  agent_name: string | null;
  agent_phone: string | null;
  agent_fee: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // 关联查询结果（非数据库字段）
  property?: Property;
  tenants?: Tenant[];
  primary_tenant?: Tenant;
}

export interface LeaseTenant {
  id: string;
  lease_id: string;
  tenant_id: string;
  is_primary: boolean;
  created_at: string;
  tenant?: Tenant;
}

export interface Bill {
  id: string;
  lease_id: string;
  period_start: string;
  period_end: string;
  days_in_period: number;
  ratio: number;
  due_date: string;
  rent_amount: number;
  utility_amount: number;
  other_amount: number;
  total_amount: number;
  paid_amount: number;
  status: BillStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // 关联查询结果
  lease?: Lease;
}

export interface Payment {
  id: string;
  bill_id: string;
  amount: number;
  paid_at: string;
  method: PaymentMethod;
  notes: string | null;
  screenshot_url: string | null;
  ai_recognized: boolean;
  created_at: string;
  // 关联查询结果
  bill?: Bill;
}

export interface MeterReading {
  id: string;
  property_id: string;
  type: MeterType;
  reading_date: string;
  value: number;
  unit_price: number | null;
  previous_value: number | null;
  usage: number | null;
  amount: number | null;
  notes: string | null;
  image_url: string | null;
  ai_recognized: boolean;
  ai_confidence: number | null;
  ai_provider: string | null;
  ai_raw_value: number | null;
  created_at: string;
}

export type ReminderType = "rent_due" | "lease_expiry" | "meter_reading" | "custom";
export type ReminderRelatedType = "bill" | "lease" | "property" | null;

export interface Reminder {
  id: string;
  household_id: string;
  type: ReminderType;
  title: string;
  content: string | null;
  related_id: string | null;
  related_type: ReminderRelatedType;
  remind_at: string;
  is_sent: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  household_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  household_id: string;
  entity_type: string;
  entity_id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

// ============================================================
// UI 辅助类型
// ============================================================

export interface DashboardStats {
  monthlyReceivable: number;
  monthlyReceived: number;
  monthlyUnreceived: number;
  overdueCount: number;
  rentedCount: number;
  vacantCount: number;
}

// 中文标签映射
export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  rented: "出租中",
  vacant: "空置",
  renovating: "装修中",
};

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  active: "生效中",
  expired: "已到期",
  terminated: "已归档",
};

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  pending: "待支付",
  partial: "部分支付",
  paid: "已支付",
  overdue: "已逾期",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wechat: "微信",
  alipay: "支付宝",
  bank: "银行转账",
  cash: "现金",
  other: "其他",
};

export const PAYMENT_CYCLE_LABELS: Record<PaymentCycle, string> = {
  monthly: "月付",
  quarterly: "季付",
  biannual: "半年付",
  annual: "年付",
};

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  natural_month: "自然月",
  rolling_month: "整月顺延",
};

export const ID_TYPE_LABELS: Record<IdType, string> = {
  id_card: "身份证",
  passport: "护照",
  other: "其他证件",
};

export const METER_TYPE_LABELS: Record<MeterType, string> = {
  electricity: "电",
  water: "水",
  gas: "燃气",
};

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  rent_due: "租金到期",
  lease_expiry: "合同到期",
  meter_reading: "抄表",
  custom: "自定义",
};

export const METER_TYPE_UNITS: Record<MeterType, string> = {
  electricity: "kWh",
  water: "吨",
  gas: "立方米",
};

/** 各表类型的常见默认单价（元/单位），用户可在表单中修改 */
export const METER_TYPE_DEFAULT_UNIT_PRICE: Record<MeterType, number> = {
  electricity: 0.6,
  water: 5.0,
  gas: 2.5,
};
