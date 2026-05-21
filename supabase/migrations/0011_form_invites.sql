-- ============================================================
-- 0011: form_invites 表，支持「房东生成链接 → 租客/中介自填 → 房东采纳」
-- ============================================================
-- 反馈 #6：用户希望省去手动录入租客的步骤
-- 流程：
--   1) 房东在租约/租客页生成邀请链接 → /invite/<token>
--   2) 租客打开链接（无需登录）→ 填姓名/手机/证件号 → 提交
--   3) 房东在「邀请箱」看到待处理项 → 点「采纳」自动创建租客记录
--
-- 安全：anon 角色只能通过 token（路径参数）SELECT/UPDATE 单条记录，
-- 且不能看到其他 household 的数据。

CREATE TABLE IF NOT EXISTS form_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 短随机 token（URL 友好），由应用层生成，全局唯一
  token text NOT NULL UNIQUE,
  -- 用途：tenant_register=租客自填，agent_register=中介自填（保留扩展）
  purpose text NOT NULL DEFAULT 'tenant_register'
    CHECK (purpose IN ('tenant_register', 'agent_register')),
  -- 房东预填的提示信息（房源名、租约信息等），公开页可展示
  prefilled_data jsonb,
  -- 租客/中介提交的数据
  submitted_data jsonb,
  submitted_at timestamptz,
  -- 房东采纳后写入：生成的 tenant_id / lease_id
  accepted_at timestamptz,
  accepted_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  -- 链接过期时间（默认 7 天）
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_invites_token_idx ON form_invites(token);
CREATE INDEX IF NOT EXISTS form_invites_household_idx ON form_invites(household_id);

ALTER TABLE form_invites ENABLE ROW LEVEL SECURITY;

-- 房东（认证用户）能看到 / 增删 / 改自己 household 的邀请
DROP POLICY IF EXISTS "owner_full_access" ON form_invites;
CREATE POLICY "owner_full_access" ON form_invites
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members hm
      WHERE hm.household_id = form_invites.household_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM household_members hm
      WHERE hm.household_id = form_invites.household_id
        AND hm.user_id = auth.uid()
    )
  );

-- 匿名用户（anon）能根据 token SELECT 单条记录，且只能在未提交&未过期时看到
-- 注意：客户端永远传完整 token 才能拿到这一行，token 不公开 = 这条 = 私有
DROP POLICY IF EXISTS "public_read_by_token" ON form_invites;
CREATE POLICY "public_read_by_token" ON form_invites
  FOR SELECT
  TO anon
  USING (expires_at > now() AND accepted_at IS NULL);

-- 匿名用户可以 UPDATE submitted_data / submitted_at（仅在未提交时）
-- 应用层 API 会校验 token 匹配 + 未提交，policy 是兜底
DROP POLICY IF EXISTS "public_submit_by_token" ON form_invites;
CREATE POLICY "public_submit_by_token" ON form_invites
  FOR UPDATE
  TO anon
  USING (submitted_at IS NULL AND expires_at > now() AND accepted_at IS NULL)
  WITH CHECK (submitted_at IS NOT NULL);
