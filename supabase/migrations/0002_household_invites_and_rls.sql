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
