-- ============================================================
-- 0006: meter_readings 增加 AI 识别相关字段
-- ============================================================
-- 背景：第一阶段杀手锏是"拍一下抄表照片，AI 自动识别读数"。
-- 为追溯识别质量、未来对比模型效果，记录：
--   - ai_recognized: 是否由 AI 识别（用户手动录入时为 false）
--   - ai_confidence: 0.00-1.00 置信度（用户可决定是否需要复核）
--   - ai_provider: 哪个 Provider 识别的（dashscope / anthropic）
--   - ai_raw_value: AI 原始识别值（用户改过 value 后这里保留原值，便于复盘）
-- ============================================================

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS ai_recognized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS ai_provider   TEXT,
  ADD COLUMN IF NOT EXISTS ai_raw_value  NUMERIC(10,3);

COMMENT ON COLUMN public.meter_readings.ai_recognized IS '是否由 AI 识别（false = 手动录入）';
COMMENT ON COLUMN public.meter_readings.ai_confidence IS 'AI 识别置信度，0.00-1.00';
COMMENT ON COLUMN public.meter_readings.ai_provider IS 'AI 识别服务商：dashscope / anthropic';
COMMENT ON COLUMN public.meter_readings.ai_raw_value IS 'AI 原始识别值（用户修改后保留对比）';
