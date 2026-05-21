-- Migration: 0009_unique_household_per_owner
--
-- 背景：之前 user-context.tsx 的 ensureHousehold 函数没有并发锁，
-- getSession + onAuthStateChange("SIGNED_IN") 会并发触发 insert，
-- 加上 maybeSingle 多行时返回 error 但代码没检查，导致每个用户
-- 累积 30+ 个 "我的家庭组" 重复 household，用户数据看着像"丢失"。
--
-- 这个 migration 是**双重防御**：即使应用层再出现类似 bug，
-- DB 层 UNIQUE 约束也能阻止重复创建。
--
-- ⚠️ 跑这个 migration 之前必须先跑数据清理脚本：
--   node scripts/fix-duplicate-households.mjs --apply
-- 否则现有重复数据会让 UNIQUE 创建失败。

-- 1. households 表：每个用户最多 own 一个 household
-- （PWA 房东工具场景：一个房东只需要一个家庭组）
-- 如果未来要支持"一个 user own 多个 household"，把这个约束删掉即可。
ALTER TABLE public.households
  ADD CONSTRAINT households_owner_id_unique UNIQUE (owner_id);

-- 2. household_members 表：每个 (user_id, household_id) 只能有一对关系
-- 之前没有这个约束，并发 insert 会出现重复 member 行。
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_user_household_unique UNIQUE (user_id, household_id);

COMMENT ON CONSTRAINT households_owner_id_unique ON public.households IS
  '每个 user 最多 own 一个 household，防止 onboarding 并发重复创建。';

COMMENT ON CONSTRAINT household_members_user_household_unique ON public.household_members IS
  '同一个 (user, household) 关系只能有一行。';
