-- ============================================================
-- 0022: 回填已注册但没 household 的孤儿用户
-- ============================================================
-- 背景：
--   0017_auto_household_on_signup.sql 的 trigger 如果没在 RDS 上跑过 / 跑失败，
--   就会出现新用户登录后 household_id = null，首页卡死 + 接口报"无家庭组"。
--   wechat-mp-login / verify-sms-otp / verify-email-otp 路由代码各自的 explicit
--   建 household 兜底也可能因 RLS / unique 冲突 silent fail 掉。
--
--   今天种子用户测试时确实复现了这个问题。
--   后端代码已新增 ensureHousehold() 兜底，今后新登录不会再出问题。
--   但已经卡在 household_id=null 的用户必须 backfill 一次。
--
-- 这个 migration 幂等可重跑：用 EXISTS / UNIQUE 兜底，已有 household 的用户跳过。
--
-- 副作用：每个孤儿用户拿到一个名为「我的家庭组」的 household + owner 身份。
-- ============================================================

DO $$
DECLARE
  orphan_user RECORD;
  hh_id UUID;
BEGIN
  FOR orphan_user IN
    SELECT u.id
    FROM auth.users u
    LEFT JOIN public.household_members hm ON hm.user_id = u.id
    WHERE hm.user_id IS NULL
  LOOP
    -- 1. 查这个用户名下是否已有 households（孤儿 household：建好了但没 member）
    SELECT id INTO hh_id
    FROM public.households
    WHERE owner_id = orphan_user.id
    LIMIT 1;

    IF hh_id IS NULL THEN
      -- 2. 新建 household
      INSERT INTO public.households (name, owner_id)
      VALUES ('我的家庭组', orphan_user.id)
      RETURNING id INTO hh_id;
    END IF;

    -- 3. 补 household_members
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (hh_id, orphan_user.id, 'owner')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 让 PostgREST 刷一下 schema cache（虽然这条 backfill 没改 schema，
-- 但保险起见，避免 cache 残留旧关系）
NOTIFY pgrst, 'reload schema';
