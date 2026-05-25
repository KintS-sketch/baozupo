-- ============================================================
-- 0015: bills.bill_type（房租 vs 押金）+ tenants.id_card_image_url
-- ============================================================
-- #5 反馈：押金独立为一张「押金账单」，不混在月租账单里
-- #4 反馈：租客身份证拍照后图片留存（不只识别字段）
--
-- 该 migration 是幂等的，可重复执行。
-- ============================================================

-- ---- bills.bill_type ----
-- 'rent' = 普通月租账单（含历史所有数据）
-- 'deposit' = 押金账单（创建租约时如果 deposit>0 自动生成 1 张）

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'rent'
    CHECK (bill_type IN ('rent', 'deposit'));

-- 顺手加个索引，未来按 type 过滤会快一些
CREATE INDEX IF NOT EXISTS idx_bills_lease_type ON public.bills(lease_id, bill_type);

COMMENT ON COLUMN public.bills.bill_type IS 'rent = 月租账单，deposit = 押金账单';


-- ---- tenants.id_card_image_url ----
-- 存 Supabase Storage 内 contracts bucket 下的相对路径
-- 路径规范：<household_id>/tenant-<tenant_id>/<timestamp>-<filename>
-- 客户端要看图时调 /api/mp/tenants/id-card 拿 signed URL

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS id_card_image_url TEXT;

COMMENT ON COLUMN public.tenants.id_card_image_url IS '身份证正面图片在 contracts bucket 内的路径';
