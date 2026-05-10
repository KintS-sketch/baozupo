# 养房 Tend · 接手手册

> 给明天的 Claude：这是 2026-05-10 这天工作的整体收尾。
> 用户是小白（非工程师），中文沟通，喜欢"能你做的就你做"。
> 今天主要完成了上线、内测包、UX 大量打磨，并定下后续路线。
> 当前 git HEAD：`b538af7`，已部署到 https://baozupo.vercel.app

---

## 0. 三十秒摘要

**养房 Tend** 是面向中国大陆个人房东的轻量管理 PWA：房源 / 租客 / 租约 / 账单 / 收款 / 抄表 / 提醒 / 家庭组 / AI 截图识别。

**当下状态**：
- ✅ 已上线（Vercel + Supabase Cloud）
- ✅ 已发内测 APK（uber-apk-signer 签好的 TWA 壳）
- ⚠️ 国内访问需要 VPN（Vercel + Supabase 都在境外）
- ⏳ 用户在并行办软著 + ICP 备案，等备案下证就迁到阿里云

**明天的工作重心（用户已确认的三个方向）**：
1. **迁移**：Vercel + Supabase Cloud → 阿里云 ECS + 自建 Supabase + 阿里云 OSS
2. **新功能 + 收费模型**：定下电子合同、个税助手等高 ROI 增值功能
3. **辅助办软著 + 服务器**：用户截图就重生成手册、ECS 一买就远程搭建

---

## 1. 项目快照

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/KintS-sketch/baozupo（私有） |
| 生产 URL | https://baozupo.vercel.app |
| Supabase Project | `hrcvurckhbmxsbxzhwfw.supabase.co` |
| Vercel Team | `kints-sketchs-projects`（Hobby） |
| 主分支 HEAD | `b538af7` |
| 代码量 | ~9700 行 / 75 个源文件 |
| 数据库 | 13 张表 + 5 个 migrations |
| 测试 | Vitest 28/28 全过 |
| Build | TypeScript 0 错 / next build 0 警 |

**技术栈**：Next.js 15 / React 19 / TypeScript / Tailwind 3 / shadcn-ui (Radix) / Supabase (Postgres + Auth + Storage) / Anthropic Claude Sonnet 4.6 (AI 识别) / date-fns 3 / Zod / react-hook-form

**关键路径**：
- `src/app/page.tsx` 首页（含人设问候 + 状态鼓励语）
- `src/app/properties/[id]/page.tsx` 房源详情聚合页（租约/抄表/账单/合同四个区块）
- `src/components/forms/bill-payment-form.tsx` 收款表单（含 AI 截图识别）
- `src/components/contract-upload.tsx` 合同上传组件
- `src/contexts/user-context.tsx` 全局用户上下文 + ensureHousehold
- `src/lib/billing.ts` 账单生成算法（已 28 单元测试覆盖）
- `src/app/api/ai/recognize-payment/route.ts` AI 识别接口
- `supabase/migrations/0001 ~ 0005` 数据库结构 + RLS 策略

---

## 2. 用户画像与协作规则

**用户**：编程小白，英文不好，全程中文沟通。看不懂代码但能跟着做。

**铁律**（详见 `~/.claude/projects/K--baozupo/memory/feedback_communication.md`）：
1. **能你做就你做**：写代码、跑命令、生成文件、调 API、用 MCP 浏览器自动化——不要把简单事推给他。
2. **必须他做的才教他**：登录他自己的账号、点真实按钮、扫码绑定、手机操作。
3. **每一步细致到颗粒**：在哪点 / 点什么 / 看到什么算成功 / 失败长什么样。涉及英文界面要附中文翻译。
4. **决策性问题主动给方案 + 主推一个**，不要一次抛 5 个让他选。

---

## 3. 三大方向（用户明日重点）

### 3.1 平台迁移路线 — 自建 Supabase（避免推倒重写）

**为什么不直接换技术栈**：原本想过"自建 Postgres + 自建 Auth + 阿里云 OSS"。后来定为**自建 Supabase（开源版）**——因为 Supabase 是开源的，docker-compose 一键起，**前端代码一行不用改**，只是把 `.env.local` 里 SUPABASE_URL 换成自己的域名。

**用户已确认**走这条路。

#### 用户已购的 / 在做的（B、C 任务）
- [ ] 注册阿里云账号 + 实名认证（用户独立做）
- [ ] 买域名（推荐 `yangfang.cn`，¥55-100/年）
- [ ] 买 ECS：**必须 2 核 4G 内存以上**（轻量服务器升级版或 ECS 计算型，¥260/年起）
- [ ] OSS Bucket（默认配置就行）
- [ ] ICP 备案：阿里云后台一键备案，10-20 工作日

⚠️ **关键提示给用户**：
- ECS **千万别买 1 核 1G**，跑不动 Supabase 全栈
- 域名先买，备案绑定 ECS

#### 我（Claude）等用户备案过后做的事

**自建 Supabase 部署清单**：
1. SSH 到 ECS，装 Docker + docker-compose
2. 拉 Supabase OSS：`git clone --depth 1 https://github.com/supabase/supabase`
3. 进入 `docker/`，编辑 `.env`：
   - `POSTGRES_PASSWORD`（强密码）
   - `JWT_SECRET`（32+ 随机字符）
   - `ANON_KEY`、`SERVICE_ROLE_KEY`（用 jwt 工具基于 JWT_SECRET 生成）
   - `SITE_URL=https://yangfang.cn`
   - `API_EXTERNAL_URL=https://api.yangfang.cn`
4. nginx 反向代理 + Let's Encrypt SSL
5. `docker-compose up -d`
6. 用 pg_dump 把云 Supabase 的数据迁过来：
   ```bash
   pg_dump postgresql://...@db.hrcvurckhbmxsbxzhwfw.supabase.co:5432/postgres > backup.sql
   psql -h <new_db> -U postgres -f backup.sql
   ```
7. **包括 `auth.users` 表**——朋友们的密码哈希一起带过来，不用重新注册
8. 更新 Vercel（或一并迁过来的）`.env.local`：
   - `NEXT_PUBLIC_SUPABASE_URL=https://api.yangfang.cn`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<新生成的>`
9. 把 `contracts` Storage Bucket 内容从云端拷贝到自建 Storage 或阿里云 OSS
10. 测试所有页面端到端跑通

**Vercel 也要迁过来**：
- 简化方案：Next.js 也在同一台 ECS 跑（npm run build && pm2 start），nginx 反代
- 或：用阿里云函数计算 / Web 应用托管（更接近 Vercel 模式）
- 推荐前者（简单），等用户 ICP 备案过了再起

**风险提醒**：
- Supabase 自建后日常运维（备份/监控）需要写 cron + 阿里云告警
- ECS 挂了、磁盘满了、续费忘了，数据就没了——必须**自动备份到 OSS**
- 我会写好 cron 备份脚本

---

### 3.2 APP 未来功能 + 收费模型（已经决定）

**用户原本想做的**：
- 想法 1：AI 识别截图收费 → ❌ 我建议**保持免费当获客钩子**
- 想法 2：AI 生成房源文案 + 图 → 🟡 文案做，AI 出图先别做（损信任）

**最终定下的收费组合**：

```
🆓 免费版（永久免费）
   ├─ 1 套房源、基础记账
   ├─ AI 截图自动识别（不限次！）  ← 引流神器
   └─ 家庭组协作

⭐ Pro 月卡 ¥9.9 / 季卡 ¥19.9 / 年卡 ¥69（早鸟 ¥49）
   ├─ 无限房源
   ├─ AI 房源文案生成（58 同城/小红书/朋友圈三种文风）
   ├─ AI 催租话术生成（不限次）
   ├─ 邮件/短信到期提醒
   ├─ 数据导出 Excel
   └─ 优先客服

💼 增值服务（按次/按年付）
   ├─ 电子合同：¥25 / 份（接腾讯电子签 / 法大大 API）
   ├─ 个人房东个税年度申报报告：¥99 / 年（最赚钱、报税季流量爆增）
   └─ 租金市场比价：¥9.9 / 次（抓贝壳数据，注意合规）

💎 终身版 ¥299（早鸟 ¥199）
   └─ Pro 全部 + 永久免费
```

**优先级建议**（按 ROI 排）：

| 排名 | 功能 | 理由 | 预估开发工时 |
|---|---|---|---|
| 1️⃣ | **电子合同** | 房东痛点强（怕赖账），单价高（¥25），接 API 即可 | 3-5 天 |
| 2️⃣ | **个税年度申报报告** | 单次 ¥99 + 报税季流量爆增 + 高情绪价值（解决焦虑） | 5-7 天 |
| 3️⃣ | **AI 催租话术** | 契合"养房 Tend"温柔品牌定位，免费 3 次/月吸引上瘾 | 1-2 天 |
| 4️⃣ | **AI 房源文案生成** | 中等价值，做成 Pro 标配 | 2-3 天 |
| 5️⃣ | **租金市场比价** | 数据合规风险大，谨慎做 | 5+ 天（含合规调研） |

**用户暂时还没在做哪个**——当前重心是上线（迁阿里云）+ 软著。等迁完再开发新功能。

---

### 3.3 我的辅助任务清单

#### A. 软著 V1.0 申请（材料已生成）

**位置**：`K:\baozupo\软著申请材料\`

**已生成的**：
- `源代码-前30页.html` / `.txt`（1500 行）
- `源代码-后30页.html` / `.txt`（1500 行）
- `软件操作手册-V1.0.html`（15 页 HTML，每个功能模块带占位截图）
- `软著申请傻瓜式指南.html`（每一步在哪点都写清楚了）
- `代码统计.txt`

**用户在做**：
- [ ] 截 11 张图（命名 `01-login.png` ~ `11-household.png`），放到 `软著申请材料/screenshots/`
- [ ] 注册 register.ccopyright.com.cn + 实名认证
- [ ] 跟着指南填申请表 + 上传 PDF

**用户截图齐了之后我要做的**：
```bash
node scripts/generate-manual.mjs
```
脚本会自动检测 `screenshots/` 下的 PNG，重新嵌入手册再输出 HTML。然后告诉用户在浏览器打 PDF。

**软著影响说明**（用户问过）：
- V1.0 提交后**新加功能（电子合同、AI 文案等）不影响**已经在审的版本
- 等新功能成型后再申请 **V2.0 软著**（免费 + 30-45 天），两个证书并存
- 应用市场审核员**不会去比对代码**和软著一致性，有 V1.0 软著就够上华为/应用宝

#### B. 服务器搭建（等用户 ICP 通过后）

**预计时间线**：
- D+10 用户备案下证
- D+11 我帮远程登录 ECS，跑 docker-compose 拉起 Supabase
- D+12 数据迁移 + DNS 切换
- D+13 全部页面端到端测试
- D+15 国内访问验证（让朋友试不挂 VPN）

**需要用户提供**：
- ECS 公网 IP + SSH 凭据（或他在阿里云控制台跟我配合操作）
- 域名（已购买并 DNS 解析到 ECS）
- ICP 备案号（开 80/443 端口必须）
- 阿里云 OSS AccessKey ID / Secret（写到 `.env`）

#### C. 内测包刷新（用户每发新版要做）

**已装的本地工具**：
- Microsoft OpenJDK 21（路径：`C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot`）
- uber-apk-signer.jar（路径：`K:\baozupo\build-tools\uber-apk-signer.jar`，已 gitignore）

**流程**：
1. 用户在 PWABuilder 重生成 unsigned APK（"Other Android" 标签）
2. 我用 uber-apk-signer 签名（可重复用同一 keystore，朋友升级不用重装）
3. 生成 `养房助手-内测版.apk`，放到 `C:\Users\KintS&Mia\Downloads\`
4. 用户发微信群里给朋友

**注意**：当前签名用的是 debug keystore，**正式上架时换正式 keystore**（有效期更长，可注册到自己名下）。

#### D. Capacitor 原生壳重打 APK（中长期，等 ICP + 软著都准备好了再做）

**为什么必做**：国内应用市场（华为/小米/应用宝）对 TWA 包装的 APK 不友好，Capacitor 把 web 资源打包进 APK 内部，看起来更"原生"。

**预估工时**：1-2 天
- 装 Android Studio（~3GB）
- `npm install @capacitor/cli @capacitor/core @capacitor/android`
- `npx cap init` + 配置
- Next.js 改 static export OR 用 `<capacitor-config>` 指向远程 URL
- `npx cap add android` → 用 Android Studio 打 release APK
- 用正式 keystore 签名

---

## 4. 今天搞定的关键修复（commit 倒序）

| Commit | 改动 |
|---|---|
| `b538af7` | feat: 软著申请材料生成脚本（3 个 .mjs） |
| `11f3575` | polish: 首页称呼兜底（数字邮箱前缀回退到"房东"）+ 提醒卡片美化 |
| `6180a8e` | polish: 收款金额输入 ¥ 与数字垂直居中对齐 |
| `26d1464` | fix: 取消按钮 sticky 定位让其与表单一起滚动 |
| `befdcc4` | fix: dialog grid → flex flex-col 解决内容溢出 + 柔和动画 |
| `999a014` | fix: dialog 改用 w-[95vw] 确保 Android Chrome 兼容 |
| `e2feec6` | feat: 退租 → 归档 + 租客卡片显示生效租约 + 收款表单手机适配 |
| `947ae5a` | feat: 租约软删除 + 租约详情合同上传 + 账单状态按 due_date 自动判定 |
| `4772ac4` | fix: dialog 第三轮兼容修复 |
| `c7321f3` | fix: dialog Android calc 缺空格 + 首页温馨人设 |
| `2ec9a26` | feat: PWABuilder manifest 完善（评分 17 → 26 → ...）+ 截图生成 |
| `ba6eab0` | feat: 房源详情页 + 自动账单 + 合同上传 + 导航调整 |
| `4e51065` | fix(rls): households SELECT 加 owner 兜底，修首次注册卡 loading |
| `b5fb3bb` | chore: gitignore 排除设计稿/日志/本地配置 |
| `47e0877` | feat: 养房 Tend MVP 首版 |

**用户当前看到的页面状态**：
- 首页问候有人设、有状态鼓励语、底部 slogan
- 房源/租客/账单/抄表/提醒所有页都正常
- 收款表单在手机和桌面都正确显示，按钮跟表单一起滚动
- 所有弹窗用柔和的"从底部上滑 + 半透明毛玻璃"动画

---

## 5. 重要技术细节 / 凭证位置

```
K:\baozupo\.env.local                   # 包含 SUPABASE 凭据 + ANTHROPIC_API_KEY
K:\baozupo\public\manifest.json         # PWA 清单（已优化到 PWABuilder 评分 30+）
K:\baozupo\public\icon-*.png            # 5 套 PWA 图标（180/192/512 + maskable）
K:\baozupo\build-tools\uber-apk-signer.jar  # APK 签名工具（gitignore）
K:\baozupo\软著申请材料\                # 软著材料（gitignore）
C:\Users\KintS&Mia\Downloads\养房助手-内测版.apk  # 当前内测 APK
C:\Users\KintS&Mia\.claude\projects\K--baozupo\memory\
   ├─ user_profile.md                   # 用户画像（小白、英文不好）
   ├─ feedback_communication.md         # 沟通规则（细致、代办、中文）
   └─ project_baozupo.md                # 项目背景（注意：可能略陈旧，已在 V1.0 之后大改）
```

**git 配置**：
- `user.email = 282295294+KintS-sketch@users.noreply.github.com`（local config，仅这个仓库）
- 原因：用户 163.com 邮箱不在 GitHub 账号上，Vercel 拦截。用 noreply 即可永久过审。

**Supabase Storage Bucket**：
- 名字：`contracts`，私有
- 限 10MB，仅 image/* + application/pdf
- 路径规范：`{household_id}/{entity_id}/{timestamp}-{filename}`
- RLS 策略已配置：用户只能管自己 household_id 下的文件（migration 0004）

**当前 SQL 迁移列表**（已在云 Supabase 全部跑过）：
1. `0001_initial.sql` — 13 张表 + 触发器 + 索引
2. `0002_household_invites_and_rls.sql` — 邀请码 + RLS 策略全开
3. `0003_fix_households_select_policy.sql` — 修复 households SELECT 循环依赖（owner 兜底）
4. `0004_storage_contracts_policies.sql` — contracts bucket 的 RLS
5. `0005_recalc_bill_status.sql` — 一次性重算账单状态（修早期 bug）

---

## 6. 待办优先级（明天起）

### 🔴 P0（用户主导，他在做或要做）
- [ ] 用户继续阿里云账号 + 域名 + ECS 购买
- [ ] 用户提交 ICP 备案
- [ ] 用户截 11 张软著用截图，放 `screenshots/` 文件夹
- [ ] 用户注册中国版权保护中心 + 提交软著申请

### 🟡 P1（我在等，用户给信号就动）
- [ ] 用户截图齐了 → 我重跑 `node scripts/generate-manual.mjs` 嵌入截图
- [ ] 用户 ICP 通过 → 我远程搭建自建 Supabase + 数据迁移 + Vercel 迁过来
- [ ] 用户报新 bug → 修

### 🟢 P2（中期，等迁移完成）
- [ ] Capacitor 原生壳重打 APK（为应用市场上架准备）
- [ ] 自建服务器的自动备份脚本（cron + OSS）
- [ ] 自建服务器的监控告警（阿里云云监控接入）

### 🔵 P3（长期，等收费功能阶段）
- [ ] 电子合同模块（接腾讯电子签 API）
- [ ] 个税年度申报助手（5-7 天工时）
- [ ] AI 催租话术 + AI 文案生成（Pro 功能）
- [ ] 收费计费系统（订阅 + 按次付）

---

## 7. 给明日 Claude 的一些坑提醒

1. **Tailwind 任意值里的减号**必须用下划线：`w-[calc(100vw_-_1rem)]`，**不能直接写空格**。Android Chrome 严格 CSS，会拒绝。今天因为这个调了 3 轮才修对（最终用 `w-[95vw]` 绕过）。

2. **`display: grid` + 子元素 min-content 大** 会撑大 grid 容器。Dialog 用 `flex flex-col` 而不是 `grid` 才不会被 4 列布局撑爆。已修复。

3. **Supabase `.insert(...).select()` 链** 会触发 SELECT RLS 检查。新用户首次创建 household 时，因为他还没在 household_members 里，SELECT 检查失败 → INSERT 报 RLS 错误。修复见 `0003` 迁移：让 owner 总能看到自己的 household。

4. **PWABuilder 的"Other Android"默认生成 unsigned APK**（认为你后续自己签）。**Google Play 标签生成的也是 unsigned**。给小白用户必须**本地签名**（用 uber-apk-signer + JDK，已就位）。

5. **TWA APK 的本质是 Chrome Custom Tab**。所以 web 端 dialog/CSS 改了，TWA 立刻就反映出来——**没有缓存层除了浏览器自身**。如果用户说"改了没生效"，多半是手机 Chrome 缓存了 HTML，让他完全杀掉 app 重开。

6. **Vercel 拦截 commit 作者邮箱不匹配 GitHub** 的提交。如果未来用户用别的邮箱 commit，会被 Blocked。已用 GitHub noreply 邮箱固定到这个仓库的 git config。

7. **用户 .env.local 不在 git** 但 .env.example 在。任何环境变量改动要同步两边，并且**记得告诉用户也改一份在 Vercel 控制台**（不然部署用不上）。

8. **`auto memory`**：写记忆文件用全英文键名（user_profile.md，feedback_*.md），但**内容用中文**。MEMORY.md 是索引，每条 1 行。不要直接在 MEMORY.md 里写大段内容。

9. **Chrome MCP** 当前不允许 `pwabuilder.com`、`github.com`、`supabase.com`、`vercel.app`。允许的有 `vercel.com`。要绕过得让用户自己浏览器操作。

10. **用户的产品定位**："养房 Tend"——温柔、关怀、像养花一样轻松。文案、动画、配色都要呼应这个调性（用 #C8553D 陶土主色 + #FBEEE9 暖纸软色）。**不要写"高效"、"专业"、"管理"这种冷冰冰的字眼**。

---

## 8. 用户当前情绪状态

很投入，主动思考产品方向（已经在想电子合同、个税这些没和我提前商量过的方向了——是个好信号）。
担心 Vercel + Supabase 国内访问问题（朋友实测要 VPN 才行），所以认定要走自建。
对软著、ICP、应用市场上架流程**完全陌生**，但愿意一步步做。
预算敏感（小成本 ¥260/年 ECS 接受，¥3000 软著加急犹豫）。

**别这样跟他说话**：
- ❌ "建议你考虑使用 Capacitor 重构"
- ❌ "这是因为 CSS Grid 的 implicit track sizing 行为导致的"
- ❌ 一次给 5 个选项让他挑

**这样跟他说话**：
- ✅ "我帮你装好工具，你只要点这一下"
- ✅ "这个 bug 是 Android 浏览器对一种 CSS 写法严格，我用别的写法绕过去就行"
- ✅ "三条路 A/B/C，我推荐 B，理由是..."

---

**祝明天工作顺利。**
