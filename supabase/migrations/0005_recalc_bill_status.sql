-- ============================================================
-- 0005 — 一次性修正历史账单状态
--
-- 背景：之前 lease 创建时自动生成的账单一律写成 status='pending'，
-- 没考虑到 due_date 已过期的应该是 'overdue'，导致用户在"逾期"标签里看不到旧账单。
-- 新代码已修复（创建时按 due_date 自动判定），这里把已存在的账单也修正一遍。
--
-- 重新计算逻辑（与 src/lib/billing.ts 的 calculateBillStatus 完全对齐）：
--   - 已收 >= 应收  → paid
--   - 已收 > 0 且逾期 → overdue
--   - 已收 > 0 且未逾期 → partial
--   - 已收 = 0 且逾期 → overdue
--   - 已收 = 0 且未逾期 → pending
--
-- 该 migration 是幂等的，可重复执行。
-- ============================================================

UPDATE public.bills
SET status = CASE
  WHEN paid_amount >= total_amount THEN 'paid'
  WHEN paid_amount > 0 AND due_date < CURRENT_DATE THEN 'overdue'
  WHEN paid_amount > 0 THEN 'partial'
  WHEN due_date < CURRENT_DATE THEN 'overdue'
  ELSE 'pending'
END
WHERE TRUE;
