-- ============================================================
-- 0012: tenants 表加 wechat_id (微信号)
-- ============================================================
-- 反馈 #11: 用户希望租客必填微信号，方便房东联系。
-- 旧租客没填的话保持 NULL，不影响显示。

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS wechat_id text;

COMMENT ON COLUMN tenants.wechat_id IS '微信号（反馈 #11，方便房东复制联系）';
