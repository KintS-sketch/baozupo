-- ============================================================
-- 0004 — contracts Storage Bucket 的访问策略
--
-- 前提：在 Supabase Dashboard → Storage 已手动创建 bucket "contracts"
--       （private、allowed mime: image/*,application/pdf、size limit 10MB）
--
-- 路径规范：contracts/{household_id}/{entity_id}/{timestamp}-{filename}
-- 用户只能管理自己 household_id 下的文件，跨家庭组完全隔离。
--
-- 该 migration 是幂等的（DROP IF EXISTS / CREATE）。
-- ============================================================

DROP POLICY IF EXISTS "contracts_authenticated_household_access" ON storage.objects;

CREATE POLICY "contracts_authenticated_household_access"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'contracts'
  AND (storage.foldername(name))[1] IN (
    SELECT household_id::text FROM public.household_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'contracts'
  AND (storage.foldername(name))[1] IN (
    SELECT household_id::text FROM public.household_members WHERE user_id = auth.uid()
  )
);
