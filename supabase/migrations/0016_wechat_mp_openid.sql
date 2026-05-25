-- ============================================================
-- 0016: user_profiles 增加微信小程序 openid + unionid
-- ============================================================
-- 背景：小程序「微信一键登录」需要根据 mp openid 查/建用户。
-- 注意：小程序 openid 跟公众号 openid 是**不同的**（不同 appid → 不同 openid）。
--   - wechat_openid     已有，0007 加的，对应公众号 OAuth
--   - wechat_mp_openid  本次加的，对应小程序 jscode2session
-- 未来如果要让"同一微信号在公众号和小程序登录视为同账号"，
-- 需要 unionid（必须在「微信开放平台」绑定公众号 + 小程序）。
-- 这里也加 wechat_unionid 字段，jscode2session 返回 unionid 就保存，
-- 后续做账号合并可用。
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS wechat_mp_openid TEXT,
  ADD COLUMN IF NOT EXISTS wechat_unionid   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_wechat_mp_openid
  ON public.user_profiles(wechat_mp_openid)
  WHERE wechat_mp_openid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_wechat_unionid
  ON public.user_profiles(wechat_unionid)
  WHERE wechat_unionid IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.wechat_mp_openid IS '微信小程序 OpenID（每用户 + 每小程序唯一），由 jscode2session 返回';
COMMENT ON COLUMN public.user_profiles.wechat_unionid IS '微信开放平台 UnionID（同一开放平台账号下的公众号+小程序共享）';
