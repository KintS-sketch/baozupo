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
