-- supabase/migrations/0023_contract_group.sql
-- ============================================================
-- 0023: 合同分组支持 + broker 签字角色
-- ============================================================
-- 背景：
--   轻签约 v2 引入"中介居间"模式：一次发起生成两份合同
--   - 《房屋租赁合同》（房东 + 租客）
--   - 《房屋租赁居间服务协议》（房东 + 中介）
--   两份合同共享同一个 contract_group_id 关联。
--
-- 改动：
--   1. contracts 表加 contract_group_id（nullable，旧数据保持 null）
--   2. contract_signers.role 加 'broker' 枚举值
-- ============================================================

-- 1. contracts 加分组字段（向后兼容，nullable）
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_contracts_group_id
  ON public.contracts(contract_group_id);

-- 2. contract_signers.role 加 'broker'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_signers_role_check'
  ) THEN
    ALTER TABLE public.contract_signers DROP CONSTRAINT contract_signers_role_check;
  END IF;
END $$;

ALTER TABLE public.contract_signers
  ADD CONSTRAINT contract_signers_role_check
  CHECK (role IN ('landlord', 'tenant', 'agent', 'broker'));

NOTIFY pgrst, 'reload schema';
