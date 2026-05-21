-- ============================================================
-- 0010: 租约新增「来源」字段，区分直租 vs 通过中介
-- ============================================================
-- 配合反馈 #4+#5：
--   #4 用户希望在「新增租约」时直接填租客，不用先跳到租客页
--      → 仍由前端处理，DB schema 不变
--   #5 新增 直租 / 中介 选项 + 中介姓名/电话/中介费
--      → 这里加 4 个可空字段
--
-- 旧数据：rental_source 默认 'direct'（直租），不影响现有租约

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS rental_source text NOT NULL DEFAULT 'direct'
    CHECK (rental_source IN ('direct', 'agent')),
  ADD COLUMN IF NOT EXISTS agent_name text,
  ADD COLUMN IF NOT EXISTS agent_phone text,
  ADD COLUMN IF NOT EXISTS agent_fee numeric(10, 2);

COMMENT ON COLUMN leases.rental_source IS '租约来源：direct=直租 / agent=通过中介';
COMMENT ON COLUMN leases.agent_name IS '中介姓名（rental_source=agent 时使用）';
COMMENT ON COLUMN leases.agent_phone IS '中介电话';
COMMENT ON COLUMN leases.agent_fee IS '中介费（元，一次性）';
