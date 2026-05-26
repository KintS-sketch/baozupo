-- ============================================================
-- 0019: 邮箱验证码（OTP）登录注册支持
-- ============================================================
-- 背景：mp 端用微信一键登录；PWA 用手机号 OTP 为主，邮箱 OTP 为备选。
-- 取代原邮箱+密码方式，注册和登录都用「邮箱 + 6 位验证码」。
--
-- 邮件经由阿里云 DirectMail 发送，需提前在阿里云控制台：
--   1. 开通 DirectMail 服务
--   2. 配置发信域名 mail.tendapp.cn（解析 SPF/DKIM/MX）
--   3. 申请发信地址（如 noreply@mail.tendapp.cn）
--   4. 申请触发型「验证码」邮件模板（标签 LoginOtp）
--
-- 设计完全镜像 0018 短信 OTP：
--   - email_otp_verifications 表保存「邮箱 -> code hash」短期映射
--   - 验证码 10 分钟过期 + 限频（同邮箱每分钟 1 条 / 每日 10 条）
--   - 失败 5 次锁
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_otp_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  -- sha256(email || code || PEPPER) — PEPPER 在环境变量里
  code_hash       TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('register', 'login', 'bind')),
  attempts        INT  NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otp_email_recent
  ON public.email_otp_verifications(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_otp_expires
  ON public.email_otp_verifications(expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.email_otp_verifications IS '邮箱验证码临时表；验证后置 consumed_at，每日 cron 清理过期';

ALTER TABLE public.email_otp_verifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.email_otp_verifications TO service_role;

-- ============================================================
-- 限频辅助函数：按邮箱查最近 OTP 计数（业务层 send-email-otp 调）
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_recent_email_otp(p_email TEXT, p_minutes INT)
RETURNS INT AS $$
  SELECT COUNT(*)::INT FROM public.email_otp_verifications
   WHERE email = p_email
     AND created_at > NOW() - (p_minutes || ' minutes')::INTERVAL;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.count_recent_email_otp TO service_role;

-- ============================================================
-- user_profiles.email 字段（业务侧按邮箱查用户用）
-- ============================================================
-- 原来 auth.users.email 是真理源，但业务侧要 join 太麻烦，profile 上冗余一份。
-- verify-email-otp 时同步写入，跟 phone 字段对称。
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles(email)
  WHERE email IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.email IS '用户邮箱（由 verify-email-otp 或 wechat 绑邮箱时同步）';

-- ============================================================
-- 回填：把现有 auth.users.email 同步到 user_profiles.email
-- ============================================================
-- 老邮箱密码用户 (.email 是真实邮箱)，phone OTP 用户（.email 是 phone_xxx@tend.internal，跳过）
DO $$
BEGIN
  UPDATE public.user_profiles p
     SET email = u.email
    FROM auth.users u
   WHERE p.id = u.id
     AND p.email IS NULL
     AND u.email IS NOT NULL
     AND u.email NOT LIKE '%@tend.internal';  -- 跳过虚拟邮箱
END $$;

