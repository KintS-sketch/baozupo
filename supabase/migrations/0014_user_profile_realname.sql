-- ============================================================
-- 0014 — user_profiles 增加实名信息
--
-- 用途：电子签约（0013）需要房东的真实姓名 + 身份证号写入合同。
-- 手机号沿用 auth.users.phone（Supabase Auth 内置）。
-- 字段全部可空：未实名的房东仍能用应用基础功能，只在发起电子签时被引导补全。
-- ============================================================

alter table public.user_profiles
  add column if not exists real_name  text,
  add column if not exists id_number  text;

comment on column public.user_profiles.real_name is '房东真实姓名（电子签约用，需与身份证一致）';
comment on column public.user_profiles.id_number is '房东身份证号 18 位（电子签约用）';
