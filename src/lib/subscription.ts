/**
 * 订阅 / 付费墙逻辑
 *
 * Phase 1：UI 层呈现 free vs pro 差异，订阅写入仅由 service_role 操作
 *          （手动给测试用户开 Pro 时直接改数据库即可）
 * Phase 2（6 月）：接入微信支付 → webhook 写入 subscriptions 表
 */

export type SubscriptionPlan = "free" | "pro";

export interface Subscription {
  plan: SubscriptionPlan;
  source: string | null;          // trial / early_bird / standard / manual_grant
  startedAt: string | null;
  expiresAt: string | null;       // null = 永久
}

// ============================================================
// 配额配置（按套餐限制）
// ============================================================

export interface PlanLimits {
  /** 房源最大数量；Infinity 表示无限 */
  maxProperties: number;
  /** 家庭组成员最大人数 */
  maxHouseholdMembers: number;
  /** 微信公众号自动提醒 */
  wechatReminders: boolean;
  /** 个税 Pro：自动算税额 + PDF 报告 */
  taxProReport: boolean;
  /** Excel 多 sheet 导出（free 仅 CSV）*/
  excelExport: boolean;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    maxProperties: 2,
    maxHouseholdMembers: 3,
    wechatReminders: false,
    taxProReport: false,
    excelExport: false,
  },
  pro: {
    maxProperties: Infinity,
    maxHouseholdMembers: Infinity,
    wechatReminders: true,
    taxProReport: true,
    excelExport: true,
  },
};

// ============================================================
// 定价配置
// ============================================================

export interface PricingTier {
  id: "monthly" | "yearly" | "yearly_early_bird";
  label: string;
  priceYuan: number;
  perMonthLabel: string;
  badge?: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "monthly",
    label: "月卡",
    priceYuan: 9.9,
    perMonthLabel: "¥9.9/月",
  },
  {
    id: "yearly_early_bird",
    label: "年卡 · 早鸟",
    priceYuan: 69,
    perMonthLabel: "¥5.8/月（早鸟）",
    badge: "限前 100 名",
  },
  {
    id: "yearly",
    label: "年卡 · 标准",
    priceYuan: 99,
    perMonthLabel: "¥8.3/月",
  },
];

// ============================================================
// 业务判断函数
// ============================================================

/**
 * 是否为有效的 Pro 用户
 * - plan = 'pro'
 * - 且 expires_at 为 null 或 > now
 */
export function isProActive(sub: Subscription | null): boolean {
  if (!sub || sub.plan !== "pro") return false;
  if (!sub.expiresAt) return true; // 永久
  return new Date(sub.expiresAt).getTime() > Date.now();
}

/**
 * 获取用户当前生效的限额配置
 */
export function getLimits(sub: Subscription | null): PlanLimits {
  return isProActive(sub) ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
}

/**
 * 是否还能添加新房源
 */
export function canAddProperty(sub: Subscription | null, currentCount: number): boolean {
  return currentCount < getLimits(sub).maxProperties;
}

/**
 * 是否还能添加家庭组成员
 */
export function canAddHouseholdMember(sub: Subscription | null, currentCount: number): boolean {
  return currentCount < getLimits(sub).maxHouseholdMembers;
}

/**
 * 把后端拉到的行映射为 Subscription
 */
export function toSubscription(row: {
  plan?: string;
  source?: string | null;
  started_at?: string | null;
  expires_at?: string | null;
} | null): Subscription | null {
  if (!row) return null;
  return {
    plan: row.plan === "pro" ? "pro" : "free",
    source: row.source ?? null,
    startedAt: row.started_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}
