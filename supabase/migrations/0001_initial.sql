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
