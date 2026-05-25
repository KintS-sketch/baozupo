-- ============================================================
-- 0018: 短信验证码（OTP）登录注册支持
-- ============================================================
-- 背景：用户反馈邮箱注册门槛高，要支持「手机号 + 验证码」登录注册。
-- 阿里云短信模板 Code：SMS_506955201（审核通过后启用）
--
-- 设计：
--   - sms_otp_verifications 表保存「手机号 -> 验证码 hash」短期映射
--   - 验证码 5 分钟过期 + 限频（同号每分钟 1 条 / 每日 5 条）
--   - 验证通过后立刻删除该条（一次性）
--   - 同一手机号失败 5 次锁定 15 分钟
--
-- user_profiles.phone：业务侧用手机号做联系/索引（auth.users.phone 也有，但需要服务端调用拿）
-- ============================================================

-- ============================================================
-- 1. sms_otp_verifications 临时表（自动清理过期记录）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sms_otp_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL,
  -- 不存明文，存 sha256(phone||code||PEPPER) — PEPPER 在环境变量里
  code_hash       TEXT NOT NULL,
  -- 用途：register（注册）/ login（登录）/ bind（绑定手机号）
  purpose         TEXT NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('register', 'login', 'bind')),
  attempts        INT  NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_otp_phone_recent
  ON public.sms_otp_verifications(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_otp_expires
  ON public.sms_otp_verifications(expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.sms_otp_verifications IS '短信验证码临时表；验证后置 consumed_at，每日 cron 清理过期';

-- 仅 service_role 能访问，普通 anon/authenticated 完全无权（保护用户隐私）
ALTER TABLE public.sms_otp_verifications ENABLE ROW LEVEL SECURITY;
-- 默认没有任何 policy = 默认拒绝。service_role 绕过 RLS 仍可访问。

GRANT ALL ON public.sms_otp_verifications TO service_role;

-- ============================================================
-- 2. user_profiles.phone 字段
-- ============================================================
-- 加在 user_profiles 而不是只用 auth.users.phone：
-- · auth.users 业务侧不直接 join，多查一步
-- · 加索引方便按手机号搜
-- · 用户改手机号时也好维护
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_phone
  ON public.user_profiles(phone)
  WHERE phone IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.phone IS '用户手机号（E.164 格式 +86xxx 或 11 位裸数字，由 send-sms-otp 写入）';

-- ============================================================
-- 3. 限频辅助函数：按手机号查最近的 OTP 计数
-- ============================================================
-- 业务层 send-sms-otp 接口先调一次，超过阈值拒绝
CREATE OR REPLACE FUNCTION public.count_recent_otp(p_phone TEXT, p_minutes INT)
RETURNS INT AS $$
  SELECT COUNT(*)::INT FROM public.sms_otp_verifications
   WHERE phone = p_phone
     AND created_at > NOW() - (p_minutes || ' minutes')::INTERVAL;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.count_recent_otp TO service_role;
