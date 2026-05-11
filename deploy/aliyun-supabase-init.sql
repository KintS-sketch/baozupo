-- ============================================================
-- 养房 Tend 全量数据库初始化脚本
-- 适用：阿里云 RDS Supabase 首次部署
-- 用法：在 Supabase Studio → SQL Editor 里粘贴本文件全部内容 → 点 Run
-- 包含：0001 ~ 0006 全部 migration，幂等可重复执行
-- 生成时间：2026-05-11 16:55:22
-- ============================================================


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0001_initial.sql
-- ████████████████████████████████████████████████████████████

-- 房东俩 · 第一阶段数据库迁移
-- 执行方式: Supabase Dashboard → SQL Editor → 粘贴全部内容，点击 Run
-- 可安全重复执行（所有语句均幂等）

-- ============================================================
-- 辅助函数
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 自动更新 updated_at 字段的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 用户档案表 (扩展 auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 新用户注册时自动创建档案
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================
-- 家庭组表 (多用户协同管理)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.households (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL DEFAULT '我的家庭组',
  owner_id   UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_households_updated_at ON public.households;
CREATE TRIGGER update_households_updated_at
  BEFORE UPDATE ON public.households
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 家庭组成员表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.household_members (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  role         TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_user_id ON public.household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household_id ON public.household_members(household_id);

-- ============================================================
-- 房源表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.properties (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id    UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL,
  city            TEXT,
  district        TEXT,
  layout          TEXT,
  area            NUMERIC(8,2),
  status          TEXT NOT NULL DEFAULT 'vacant', -- 'rented' | 'vacant' | 'renovating'
  notes           TEXT,
  cover_image_url TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_household_id ON public.properties(household_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_properties_updated_at ON public.properties;
CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 租客表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenants (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id            UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  phone                   TEXT NOT NULL,
  id_type                 TEXT DEFAULT 'id_card', -- 'id_card' | 'passport' | 'other'
  -- TODO(Phase 2): id_number 应使用列级加密或 Vault 加密存储
  id_number               TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  notes                   TEXT,
  tags                    TEXT[] DEFAULT '{}',
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_household_id ON public.tenants(household_id);

DROP TRIGGER IF EXISTS update_tenants_updated_at ON public.tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 租约表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leases (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id   UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  property_id    UUID NOT NULL REFERENCES public.properties(id),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  monthly_rent   NUMERIC(10,2) NOT NULL CHECK (monthly_rent > 0),
  deposit        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  payment_cycle  TEXT NOT NULL DEFAULT 'monthly',
  rent_due_day   INTEGER NOT NULL DEFAULT 1 CHECK (rent_due_day BETWEEN 1 AND 31),
  billing_mode   TEXT NOT NULL DEFAULT 'natural_month',
  status         TEXT NOT NULL DEFAULT 'active', -- 'active' | 'expired' | 'terminated'
  notes          TEXT,
  contract_url   TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leases_dates_check CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_leases_household_id ON public.leases(household_id);
CREATE INDEX IF NOT EXISTS idx_leases_property_id ON public.leases(property_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON public.leases(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_leases_updated_at ON public.leases;
CREATE TRIGGER update_leases_updated_at
  BEFORE UPDATE ON public.leases
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 租约-租客关联表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lease_tenants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lease_id   UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lease_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lease_tenants_lease_id ON public.lease_tenants(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_tenants_tenant_id ON public.lease_tenants(tenant_id);

-- ============================================================
-- 账单表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bills (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lease_id      UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  days_in_period INTEGER NOT NULL,
  ratio         NUMERIC(8,6) NOT NULL DEFAULT 1,
  due_date      DATE NOT NULL,
  rent_amount   NUMERIC(10,2) NOT NULL CHECK (rent_amount >= 0),
  utility_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (utility_amount >= 0),
  other_amount  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (other_amount >= 0),
  total_amount  NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status        TEXT NOT NULL DEFAULT 'pending',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bills_lease_id ON public.bills(lease_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON public.bills(due_date);

DROP TRIGGER IF EXISTS update_bills_updated_at ON public.bills;
CREATE TRIGGER update_bills_updated_at
  BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================
-- 收款记录表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id         UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  paid_at         TIMESTAMPTZ NOT NULL,
  method          TEXT NOT NULL DEFAULT 'other',
  notes           TEXT,
  screenshot_url  TEXT,
  ai_recognized   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON public.payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON public.payments(paid_at DESC);

-- ============================================================
-- 水电表读数表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meter_readings (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES public.properties(id),
  type           TEXT NOT NULL,
  reading_date   DATE NOT NULL,
  value          NUMERIC(10,3) NOT NULL,
  unit_price     NUMERIC(8,4),
  previous_value NUMERIC(10,3),
  usage          NUMERIC(10,3),
  amount         NUMERIC(10,2),
  notes          TEXT,
  image_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meter_readings_property_id ON public.meter_readings(property_id);

-- ============================================================
-- 提醒表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reminders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id  UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT,
  related_id    UUID,
  related_type  TEXT,
  remind_at     TIMESTAMPTZ NOT NULL,
  is_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_household_id ON public.reminders(household_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON public.reminders(remind_at) WHERE NOT is_sent AND NOT is_dismissed;

-- ============================================================
-- 操作日志表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_household_id ON public.activity_logs(household_id);

-- ============================================================
-- 附件表
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attachments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  file_name    TEXT NOT NULL,
  file_url     TEXT NOT NULL,
  file_size    INTEGER,
  mime_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity ON public.attachments(entity_type, entity_id);

-- ============================================================
-- 权限授予（关键！PostgREST 通过 anon/authenticated 角色访问表）
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT ALL ON public.user_profiles     TO authenticated;
GRANT ALL ON public.households        TO authenticated;
GRANT ALL ON public.household_members TO authenticated;
GRANT ALL ON public.properties        TO authenticated;
GRANT ALL ON public.tenants           TO authenticated;
GRANT ALL ON public.leases            TO authenticated;
GRANT ALL ON public.lease_tenants     TO authenticated;
GRANT ALL ON public.bills             TO authenticated;
GRANT ALL ON public.payments          TO authenticated;
GRANT ALL ON public.meter_readings    TO authenticated;
GRANT ALL ON public.reminders         TO authenticated;
GRANT ALL ON public.activity_logs     TO authenticated;
GRANT ALL ON public.attachments       TO authenticated;

-- ============================================================
-- RLS 策略 (Row Level Security)
-- 第一阶段暂不启用，保持表可访问。
-- TODO(Phase 2): 启用 RLS 并添加如下策略模式：
--
--   ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "household_members_only" ON public.properties
--   USING (
--     household_id IN (
--       SELECT household_id FROM public.household_members
--       WHERE user_id = auth.uid()
--     )
--   );
--
-- 对所有业务表（households, tenants, leases, bills, payments...）重复此模式。
-- ============================================================


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0002_household_invites_and_rls.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- 0002 — 家庭组邀请系统 + Row Level Security 启用
--
-- 内容：
--   1. household_invites 表：6 位邀请码，24 小时过期，一次性使用
--   2. 启用所有业务表的 RLS（之前 0001 留作 TODO）
--   3. RLS 策略：用户只能访问自己 household_members 中所属 household 的数据
--
-- 该 migration 是幂等的（IF NOT EXISTS / DROP-CREATE policy），可重复执行。
-- ============================================================

-- ============================================================
-- household_invites 表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.household_invites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,             -- 6 位字母数字（不含易混字符）
  created_by   UUID NOT NULL REFERENCES auth.users(id),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,                      -- 首次被接受的时间
  used_by      UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_invites_code ON public.household_invites(code) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_household_invites_household ON public.household_invites(household_id);

GRANT ALL ON public.household_invites TO authenticated;

-- ============================================================
-- 辅助函数：当前用户所属的 household_id 集合
-- 在 RLS policy 中复用，避免重复子查询
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_household_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id
  FROM public.household_members
  WHERE user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.current_household_ids() TO authenticated;

-- ============================================================
-- 启用 RLS
-- ============================================================
ALTER TABLE public.user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments        ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 用户档案：只能看自己的
-- ============================================================
DROP POLICY IF EXISTS "user_profiles_self" ON public.user_profiles;
CREATE POLICY "user_profiles_self" ON public.user_profiles
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- households：成员可查；owner 可改/删；任何登录用户可创建
-- ============================================================
DROP POLICY IF EXISTS "households_select_members" ON public.households;
CREATE POLICY "households_select_members" ON public.households
  FOR SELECT
  USING (id IN (SELECT public.current_household_ids()));

DROP POLICY IF EXISTS "households_insert_self_owner" ON public.households;
CREATE POLICY "households_insert_self_owner" ON public.households
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "households_update_owner" ON public.households;
CREATE POLICY "households_update_owner" ON public.households
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "households_delete_owner" ON public.households;
CREATE POLICY "households_delete_owner" ON public.households
  FOR DELETE
  USING (owner_id = auth.uid());

-- ============================================================
-- household_members：
--   - SELECT：成员可看自己 household 的全部成员
--   - INSERT：用户可加入自己；或 owner 可加入他人（用于邀请接受）
--   - DELETE：owner 可移除任何人；用户可移除自己（退出）
-- ============================================================
DROP POLICY IF EXISTS "members_select_same_household" ON public.household_members;
CREATE POLICY "members_select_same_household" ON public.household_members
  FOR SELECT
  USING (household_id IN (SELECT public.current_household_ids()));

DROP POLICY IF EXISTS "members_insert_self" ON public.household_members;
CREATE POLICY "members_insert_self" ON public.household_members
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "members_delete_owner_or_self" ON public.household_members;
CREATE POLICY "members_delete_owner_or_self" ON public.household_members
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR household_id IN (
      SELECT id FROM public.households WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- household_invites：
--   - 成员可读自己 household 的（用于显示已生成邀请码）
--   - 任何登录用户可读未过期未使用的邀请码（按 code 匹配）— 用于加入流程
--   - owner 可创建邀请
--   - 任何用户可在使用时更新 used_at/used_by（应用层校验）
-- ============================================================
DROP POLICY IF EXISTS "invites_select_household_or_unused_code" ON public.household_invites;
CREATE POLICY "invites_select_household_or_unused_code" ON public.household_invites
  FOR SELECT
  USING (
    household_id IN (SELECT public.current_household_ids())
    OR (used_at IS NULL AND expires_at > NOW())
  );

DROP POLICY IF EXISTS "invites_insert_owner" ON public.household_invites;
CREATE POLICY "invites_insert_owner" ON public.household_invites
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND household_id IN (
      SELECT id FROM public.households WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invites_update_self_use" ON public.household_invites;
CREATE POLICY "invites_update_self_use" ON public.household_invites
  FOR UPDATE
  USING (
    used_at IS NULL
    AND expires_at > NOW()
  )
  WITH CHECK (used_by = auth.uid());

-- ============================================================
-- 直接含 household_id 的业务表：properties / tenants / leases /
-- reminders / activity_logs / attachments
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'properties', 'tenants', 'leases',
      'reminders', 'activity_logs', 'attachments'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%I_household_members" ON public.%I', t, t);
    EXECUTE format($q$
      CREATE POLICY "%I_household_members" ON public.%I
        FOR ALL
        USING (household_id IN (SELECT public.current_household_ids()))
        WITH CHECK (household_id IN (SELECT public.current_household_ids()))
    $q$, t, t);
  END LOOP;
END
$$;

-- ============================================================
-- lease_tenants：无 household_id，通过 lease_id → leases 鉴权
-- ============================================================
DROP POLICY IF EXISTS "lease_tenants_via_lease" ON public.lease_tenants;
CREATE POLICY "lease_tenants_via_lease" ON public.lease_tenants
  FOR ALL
  USING (
    lease_id IN (
      SELECT id FROM public.leases
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  )
  WITH CHECK (
    lease_id IN (
      SELECT id FROM public.leases
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  );

-- ============================================================
-- bills：无 household_id，通过 lease_id → leases 鉴权
-- ============================================================
DROP POLICY IF EXISTS "bills_via_lease" ON public.bills;
CREATE POLICY "bills_via_lease" ON public.bills
  FOR ALL
  USING (
    lease_id IN (
      SELECT id FROM public.leases
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  )
  WITH CHECK (
    lease_id IN (
      SELECT id FROM public.leases
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  );

-- ============================================================
-- payments：无 household_id，通过 bill_id → bills → leases 鉴权
-- ============================================================
DROP POLICY IF EXISTS "payments_via_bill" ON public.payments;
CREATE POLICY "payments_via_bill" ON public.payments
  FOR ALL
  USING (
    bill_id IN (
      SELECT b.id FROM public.bills b
      JOIN public.leases l ON l.id = b.lease_id
      WHERE l.household_id IN (SELECT public.current_household_ids())
    )
  )
  WITH CHECK (
    bill_id IN (
      SELECT b.id FROM public.bills b
      JOIN public.leases l ON l.id = b.lease_id
      WHERE l.household_id IN (SELECT public.current_household_ids())
    )
  );

-- ============================================================
-- meter_readings：无 household_id，通过 property_id → properties 鉴权
-- ============================================================
DROP POLICY IF EXISTS "meter_readings_via_property" ON public.meter_readings;
CREATE POLICY "meter_readings_via_property" ON public.meter_readings
  FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  )
  WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties
      WHERE household_id IN (SELECT public.current_household_ids())
    )
  );


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0003_fix_households_select_policy.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- 0003 — 修复 households SELECT 策略的循环依赖
--
-- 问题：
--   当新用户首次创建 household 时，UserProvider 调用：
--     supabase.from("households").insert({...}).select("id").single()
--   .select() 会触发 SELECT 策略检查（PostgREST RETURNING）：
--     USING (id IN (SELECT public.current_household_ids()))
--   但此时用户还没插入 household_members（那是下一步操作），
--   current_household_ids() 返回空集合，新行不可见，整个 INSERT 报 RLS 错误。
--
-- 修复：让 owner 总能看到自己的 household（无需依赖成员表）。
--   语义上也合理：你拥有的，你当然能看。
--
-- 该 migration 是幂等的，可重复执行。
-- ============================================================

DROP POLICY IF EXISTS "households_select_members" ON public.households;
CREATE POLICY "households_select_members" ON public.households
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.current_household_ids())
  );


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0004_storage_contracts_policies.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- 0004 — contracts Storage Bucket 的访问策略
--
-- 前提：在 Supabase Dashboard → Storage 已手动创建 bucket "contracts"
--       （private、allowed mime: image/*,application/pdf、size limit 10MB）
--
-- 路径规范：contracts/{household_id}/{entity_id}/{timestamp}-{filename}
-- 用户只能管理自己 household_id 下的文件，跨家庭组完全隔离。
--
-- 该 migration 是幂等的（DROP IF EXISTS / CREATE）。
-- ============================================================

DROP POLICY IF EXISTS "contracts_authenticated_household_access" ON storage.objects;

CREATE POLICY "contracts_authenticated_household_access"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'contracts'
  AND (storage.foldername(name))[1] IN (
    SELECT household_id::text FROM public.household_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'contracts'
  AND (storage.foldername(name))[1] IN (
    SELECT household_id::text FROM public.household_members WHERE user_id = auth.uid()
  )
);


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0005_recalc_bill_status.sql
-- ████████████████████████████████████████████████████████████

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


-- ████████████████████████████████████████████████████████████
-- supabase/migrations/0006_meter_ai_columns.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- 0006: meter_readings 增加 AI 识别相关字段
-- ============================================================
-- 背景：第一阶段杀手锏是"拍一下抄表照片，AI 自动识别读数"。
-- 为追溯识别质量、未来对比模型效果，记录：
--   - ai_recognized: 是否由 AI 识别（用户手动录入时为 false）
--   - ai_confidence: 0.00-1.00 置信度（用户可决定是否需要复核）
--   - ai_provider: 哪个 Provider 识别的（dashscope / anthropic）
--   - ai_raw_value: AI 原始识别值（用户改过 value 后这里保留原值，便于复盘）
-- ============================================================

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS ai_recognized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS ai_provider   TEXT,
  ADD COLUMN IF NOT EXISTS ai_raw_value  NUMERIC(10,3);

COMMENT ON COLUMN public.meter_readings.ai_recognized IS '是否由 AI 识别（false = 手动录入）';
COMMENT ON COLUMN public.meter_readings.ai_confidence IS 'AI 识别置信度，0.00-1.00';
COMMENT ON COLUMN public.meter_readings.ai_provider IS 'AI 识别服务商：dashscope / anthropic';
COMMENT ON COLUMN public.meter_readings.ai_raw_value IS 'AI 原始识别值（用户修改后保留对比）';

