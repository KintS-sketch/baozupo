# 🚚 养房 Tend 迁移到阿里云 RDS Supabase

> 假设你已经在阿里云完成：
> - ✅ RDS Supabase 实例 `tendapp` 已运行
> - ✅ Project `ra-supabase-8xfoq7zxvpcyy8` 已运行
> - ✅ 外网地址 `http://8.168.17.14` 可访问
> - ✅ 拿到了 AnonKey 和 ServiceKey

---

## 流程总览

```
[你做] 1. 登录 Studio
[你做] 2. SQL Editor 跑 aliyun-supabase-init.sql  (建表 + RLS + 触发器)
[你做] 3. 创建 contracts Storage Bucket
[你做] 4. 告诉我做完了
[我做] 5. 切换 .env.local 到新地址
[我做] 6. 启动本地 dev server
[你做] 7. 浏览器访问 localhost:3000 验证
```

---

## 步骤 1：登录 Supabase Studio

1. 浏览器打开：**http://8.168.17.14**（不加 https）
2. 用户名：`supabase`
3. 密码：你之前设的 Dashboard 密码

**进入后应该看到一个绿色 Logo 的管理后台**，左侧有这些菜单：
- 🏠 Home / Project Home
- 📊 Database / Table Editor
- 🛠 SQL Editor ← 等下会用
- 🔐 Authentication
- 📁 Storage ← 等下会用
- ⚡ Realtime
- 📈 Logs
- ⚙️ Settings

如果左侧菜单缺了 Storage 或 Authentication，**立刻截图发我**（说明 RDS Supabase 不完整，要换方案）。

---

## 步骤 2：跑数据库初始化 SQL

1. 左侧菜单 → 点 **"SQL Editor"**
2. 点 **"New query"** 或 **"+ 新建查询"** 按钮
3. 在 SQL 输入框里粘贴 `deploy/aliyun-supabase-init.sql` 的**全部内容**
   - 文件路径：`K:\baozupo\.claude\worktrees\zealous-kilby-ebac57\deploy\aliyun-supabase-init.sql`
   - 或主项目同步后位于：`K:\baozupo\deploy\aliyun-supabase-init.sql`
   - 用记事本打开 → Ctrl+A 全选 → Ctrl+C 复制 → 粘贴到 SQL Editor
4. 点右下角 **"Run"** 按钮（或快捷键 Ctrl+Enter）
5. **等待执行**（应该几秒钟）

**成功标志**：底部出现绿色 "Success. No rows returned" 或类似的提示。

**如果有红色错误**：截图发我，我看是什么问题。

---

## 步骤 3：验证表是否建好

1. 左侧菜单 → 点 **"Database"** → 子菜单 **"Tables"** （或直接点 "Table Editor"）
2. 应该看到 13 张表：
   - households, household_members, household_invites
   - user_profiles
   - properties, tenants, leases
   - bills, payments
   - meter_readings, reminders
   - app_settings, audit_logs

**如果不到 13 张，告诉我数量**，可能有部分 SQL 没跑过。

---

## 步骤 4：创建 contracts Storage Bucket

1. 左侧菜单 → 点 **"Storage"**
2. 点 **"New bucket"** 或 **"创建 Bucket"** 按钮
3. 填写：
   - **Name**：`contracts`（必须**一字不差**，否则代码连不上）
   - **Public bucket**：**不勾选**（保持私有）
   - **File size limit**：`10 MB`
   - **Allowed MIME types**：`image/jpeg, image/png, image/webp, application/pdf`
4. 点 **"Create bucket"**

**成功标志**：左侧 Storage 菜单下出现一个 `contracts` 文件夹图标。

---

## 步骤 5：告诉我

做完上面 4 步后，告诉我"**SQL 跑完了 + bucket 也建了**"。

然后我做：
- 自动切换 `.env.local` 到新 Supabase
- 启动本地 dev server
- 给你一个 `http://localhost:3000` 链接，你直接浏览器打开就能登录测试

---

## ❓ 常见问题

### Q：跑 SQL 报错 "permission denied for schema auth"
说明 service_role 没有 auth schema 权限。RDS Supabase 通常默认有，告诉我具体报错信息。

### Q：Storage 菜单找不到
说明 RDS Supabase 版本可能不支持 Storage，回头报告我，走"PG + 阿里云 OSS"备选方案。

### Q：我能继续用 Supabase Cloud 吗？
能。`.env.local` 备份了旧配置，30 秒可回滚。

---

## ⚠️ 安全提醒

你刚才截图发我了 **ServiceKey** —— 这是绝密。等迁移成功后，建议：
1. 阿里云控制台 → Project 详情页 → 顶部 **"重置密码"** 按钮 → 重新生成
2. 重新生成后旧 key 失效，对话历史里的截图作废
3. 我帮你把新 key 重新配到 `.env.local`

不急，先把迁移跑通再说。
