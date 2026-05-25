-- ============================================================
-- 0017: 新用户注册时自动创建家庭组 + 加入为 owner
-- ============================================================
-- 背景：
--   旧版 PWA 邮箱注册（/login signup）只会触发 handle_new_user() 建 user_profiles，
--   但**不会**建 household，导致：
--   - 用户登 mp 端首页 → /api/mp/me 返回 household_id=null
--   - mp 首页 v-else-if "!householdId" 永远卡在 "登录态正在恢复"
--   微信小程序 wechat-mp-login 路由有手动建 household 的代码，但邮箱注册路径没有。
--
-- 修复：扩展 handle_new_user() 触发器，新用户进来时一并建 household + member
--   - household.name 默认「我的家庭组」（用户可以后改）
--   - household_members.role = 'owner'
--   - 幂等：ON CONFLICT DO NOTHING + user_profiles.household_id 也写一份
--
-- 历史用户（已有 user_profiles 但没 household）：
--   单独跑 RPC 修补：见文件末尾的 backfill 语句
-- ============================================================

-- 重写 trigger function（保留 user_profiles 创建逻辑 + 加 household 创建）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_household_id UUID;
BEGIN
  -- 1. 建 user_profiles（跟 0001 一致）
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;

  -- 2. 检查是否已有 household（防止重复触发或多重 trigger 兜底）
  SELECT household_id INTO new_household_id
  FROM public.household_members
  WHERE user_id = NEW.id
  LIMIT 1;

  IF new_household_id IS NULL THEN
    -- 3. 建 household
    INSERT INTO public.households (name, owner_id)
    VALUES ('我的家庭组', NEW.id)
    RETURNING id INTO new_household_id;

    -- 4. 把自己加进 household_members（owner）
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (new_household_id, NEW.id, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- trigger 已经在 0001 装好（on_auth_user_created），不用重新建

-- ============================================================
-- Backfill：给历史「无 household」的老用户补一份
-- ============================================================
-- 找所有 auth.users 里没有 household_members 记录的，给每人建一个家庭组
DO $$
DECLARE
  orphan_user RECORD;
  new_hh_id UUID;
BEGIN
  FOR orphan_user IN
    SELECT u.id
    FROM auth.users u
    LEFT JOIN public.household_members hm ON hm.user_id = u.id
    WHERE hm.user_id IS NULL
  LOOP
    INSERT INTO public.households (name, owner_id)
    VALUES ('我的家庭组', orphan_user.id)
    RETURNING id INTO new_hh_id;

    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (new_hh_id, orphan_user.id, 'owner')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
