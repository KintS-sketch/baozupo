-- ============================================================
-- 0008: 订阅表 + 新用户默认免费的触发器
-- ============================================================
-- 设计：
--   - 每个 auth.users 对应一行 subscription（注册时自动创建）
--   - plan: 'free' | 'pro'
--   - source: 来源（trial / early_bird / standard / manual_grant）
--   - expires_at: NULL 表示永久（如终身版）；free 永远不过期
--   - 写入仅 service_role（防止用户自己改成 pro）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  source      TEXT,
  started_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_expires
  ON public.subscriptions(plan, expires_at)
  WHERE plan = 'pro';

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 新用户注册时自动创建免费订阅
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, source)
  VALUES (NEW.id, 'free', 'trial')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_subscription();

-- 回填：给现有用户都创建一条 free subscription（如果还没有）
INSERT INTO public.subscriptions (user_id, plan, source)
SELECT id, 'free', 'trial' FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.subscriptions)
ON CONFLICT (user_id) DO NOTHING;

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_self_read" ON public.subscriptions;
CREATE POLICY "subscriptions_self_read" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- 写入仅 service_role（cron 任务 + 支付 webhook 用）
DROP POLICY IF EXISTS "subscriptions_service_write" ON public.subscriptions;
CREATE POLICY "subscriptions_service_write" ON public.subscriptions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL    ON public.subscriptions TO service_role;

COMMENT ON TABLE public.subscriptions IS '用户订阅状态：每个 auth.users 一行';
COMMENT ON COLUMN public.subscriptions.plan IS 'free 或 pro';
COMMENT ON COLUMN public.subscriptions.source IS 'trial / early_bird / standard / manual_grant';
COMMENT ON COLUMN public.subscriptions.expires_at IS 'NULL = 永久；过期后业务层应当作 free 处理';
