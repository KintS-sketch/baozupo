-- ============================================================
-- 0007: user_profiles 增加微信公众号绑定相关字段
-- ============================================================
-- 背景：第一阶段杀手锏是"AI 抄表 / 收租日 → 微信自动提醒"。
-- 流程：用户在 PWA 内点"绑定微信" → OAuth2 网页授权 →
--      微信回调到 /api/wechat/oauth/callback → 拿到 openid 后写入本表
--
-- 字段：
--   wechat_openid      公众号 OpenID（每个用户对每个公众号唯一）
--   wechat_nickname    微信昵称（仅展示）
--   wechat_bound_at    绑定时间
--   wechat_subscribed  是否已订阅"长期订阅消息"（小程序 / 服务号订阅消息额度）
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS wechat_openid     TEXT,
  ADD COLUMN IF NOT EXISTS wechat_nickname   TEXT,
  ADD COLUMN IF NOT EXISTS wechat_bound_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wechat_subscribed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_wechat_openid
  ON public.user_profiles(wechat_openid)
  WHERE wechat_openid IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.wechat_openid IS '微信公众号 OpenID（每用户 + 每公众号唯一）';
COMMENT ON COLUMN public.user_profiles.wechat_nickname IS '微信昵称（仅展示，可能为空）';
COMMENT ON COLUMN public.user_profiles.wechat_bound_at IS '绑定时间，NULL = 未绑定';
COMMENT ON COLUMN public.user_profiles.wechat_subscribed IS '是否已订阅模板消息（决定能否推送）';

-- ============================================================
-- 提醒推送记录表（防止重复推送 + 失败重试）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wechat_push_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  openid       TEXT NOT NULL,
  template_key TEXT NOT NULL,         -- 模板类型：bill_due / meter_due / lease_expiry
  related_type TEXT,                  -- bill / lease / property
  related_id   UUID,                  -- 关联实体 ID（防止同一账单推两次）
  status       TEXT NOT NULL,         -- success / failed / pending
  error_msg    TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wechat_push_logs_user ON public.wechat_push_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_wechat_push_logs_dedup
  ON public.wechat_push_logs(user_id, template_key, related_id)
  WHERE related_id IS NOT NULL;

ALTER TABLE public.wechat_push_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wechat_push_logs_self_read" ON public.wechat_push_logs;
CREATE POLICY "wechat_push_logs_self_read" ON public.wechat_push_logs
  FOR SELECT USING (auth.uid() = user_id);

-- 只有 service_role 能写入（cron 任务用 service_role 调用）
DROP POLICY IF EXISTS "wechat_push_logs_service_write" ON public.wechat_push_logs;
CREATE POLICY "wechat_push_logs_service_write" ON public.wechat_push_logs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.wechat_push_logs TO authenticated;
GRANT ALL    ON public.wechat_push_logs TO service_role;

COMMENT ON TABLE public.wechat_push_logs IS '微信公众号模板消息推送日志，用于去重 + 排查问题';
