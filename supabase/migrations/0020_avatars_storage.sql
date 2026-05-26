-- ============================================================
-- 0020 — avatars Storage Bucket（用户头像）
--
-- 用途：微信小程序登录后用户用 chooseAvatar 选了头像，上传到这里。
-- PWA 端将来也可以用同一个 bucket。
--
-- 路径规范：avatars/{user_id}/{timestamp}.{ext}
--   - user_id 是 auth.users.id（UUID）
--   - 每个用户文件夹是自己 user_id，互相隔离
--   - 文件名带时间戳，避免缓存
--
-- bucket 是 public 的（头像 URL 要能直接 <img src> 显示），
-- 但只有本人能 INSERT/UPDATE/DELETE 自己文件夹下的文件。
--
-- 该 migration 是幂等的。
-- ============================================================

-- 1. 建 bucket（如果还没有）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true, -- public：URL 直接可访问
  2097152, -- 2 MB 单文件上限
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. 删旧策略（幂等）
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;

-- 3. 任何人都能读（public 头像）
CREATE POLICY "avatars_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- 4. 登录用户只能上传到自己文件夹
CREATE POLICY "avatars_owner_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. 登录用户只能改自己文件夹下的文件
CREATE POLICY "avatars_owner_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 6. 登录用户只能删自己文件夹下的文件
CREATE POLICY "avatars_owner_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
