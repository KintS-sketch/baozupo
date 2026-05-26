-- ============================================================
-- 0021: user_profiles 补齐微信公众号绑定字段
-- ============================================================
-- 背景：0007 当时规划走 OAuth，但 RDS 上没跑过那条 migration（OAuth 方案搁置了）。
-- 现在用「带参数二维码 + 服务号关注回调」绑定 OpenID，必须用到这 4 个字段。
--
-- 字段：
--   wechat_openid      公众号 OpenID（每用户 + 每公众号唯一）
--   wechat_nickname    微信昵称（保留字段，目前用不上）
--   wechat_bound_at    绑定时间
--   wechat_subscribed  是否已订阅推送（关注 = true，取消关注 = false）
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS wechat_openid     TEXT,
  ADD COLUMN IF NOT EXISTS wechat_nickname   TEXT,
  ADD COLUMN IF NOT EXISTS wechat_bound_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wechat_subscribed BOOLEAN NOT NULL DEFAULT FALSE;

-- 防止同一个 OpenID 绑到多个账号
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_wechat_openid
  ON public.user_profiles(wechat_openid)
  WHERE wechat_openid IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.wechat_openid     IS '微信公众号 OpenID（来自服务号关注回调）';
COMMENT ON COLUMN public.user_profiles.wechat_nickname   IS '微信昵称，目前未填充';
COMMENT ON COLUMN public.user_profiles.wechat_bound_at   IS '绑定时间，NULL = 未绑定';
COMMENT ON COLUMN public.user_profiles.wechat_subscribed IS '是否已关注服务号';

-- 让 PostgREST 立即看见新列（不刷的话 supabase-js 还会报 schema cache 错）
NOTIFY pgrst, 'reload schema';
