# 轻签约 v1（在线租房电子合同） — 设计文档

- **日期**：2026-05-23
- **作者**：Tend 房东俩团队
- **状态**：草案 / 待用户审核
- **关联项目**：养房 Tend（baozupo）

---

## 1. 背景与目标

### 1.1 痛点

种子轮反馈期间，多位房东反映线下纸面签合同流程繁琐：
- 房东和租客 / 中介需要约时间见面
- 异地租赁尤其困难
- 合同丢失 / 字迹模糊后，房东无据可凭

### 1.2 目标

在养房 Tend 内置「电子签约」能力，让房东在 PWA 内：
1. 一键生成标准化租赁合同 PDF
2. 房东 → 租客（双签）或 房东 → 中介 → 租客（三签）走完整电子签字流程
3. 签字完成后合同自动归档到对应租约下，可随时查看 / 下载

### 1.3 非目标（v1 不做）

- 不接腾讯电子签 / 法大大 / e签宝等第三方 CA 服务（v2 再说）
- 不做企业 / 机构客户的合规对接
- 不做合同模板的可视化编辑器（v1 用法务审过的两个固定模板）
- 不做合同到期自动续签
- 不做合同变更 / 补充协议（v1 只能签新合同）

---

## 2. 法律依据

### 2.1 适用法规

**《中华人民共和国电子签名法》（2005 实施，2019 修订）**

关键条款：

- **第 3 条**：当事人约定使用电子签名、数据电文的文书，**不得仅因为其采用电子签名形式而否定其法律效力**。
- **第 13 条**：电子签名同时符合下列条件的，视为**可靠的电子签名**：
  1. 签名制作数据为电子签名人专有
  2. 签署时签名制作数据仅由电子签名人控制
  3. 签署后对电子签名的任何改动能够被发现
  4. 签署后对数据电文内容和形式的任何改动能够被发现
- **第 14 条**：**可靠的电子签名与手写签名或盖章具有同等的法律效力**。

### 2.2 「轻签约 v1」的法律合规设计

| 第 13 条要求 | 本设计的对应实现 |
|---|---|
| (1) 签名数据**专有** | 用签名人**手机号 + 身份证号**（来自租约表）作为身份锚点 |
| (2) 签署时**仅签名人控制** | 短信验证码只发至签名人手机；手写画板要求当场实时绘制 |
| (3) 签名**改动可发现** | 签名图嵌入 PDF + 时间戳；最终 PDF SHA256 哈希存数据库 |
| (4) 内容**改动可发现** | 同上，文件级哈希；上链**可信时间戳**（可选增强） |

### 2.3 司法实践参考

- 北京 / 杭州 / 广州互联网法院多次判决支持「短信验证码 + 操作日志 + PDF 哈希」类电子合同效力
- 自如、贝壳、链家、淘宝等头部平台均长期使用类似机制
- 阿里 / 腾讯系电商订单本质即「点击 = 同意 + IP 日志」级电子合同

### 2.4 v1 的法律强度评估

**适用场景**：标的额低（千级 - 万级）的个人对个人民事合同。
**不适用**：上百万元的商业租赁、机构客户合规合同。

养房 Tend 目标客户（个体房东 + 散户租客）的全部使用场景，均在 v1 适用范围内。

---

## 3. 功能范围

### 3.1 模式

| 模式 | 触发条件 | 签署方 |
|---|---|---|
| **直租双签** | 租约 `rental_source = 'direct'` | 房东 + 租客 |
| **中介居间三签** | 租约 `rental_source = 'agent'` | 房东 + 中介 + 租客 |

签署顺序固定：**房东 → 中介（若有）→ 租客**。

中介在 v1 中以「居间方」身份签字（介绍人、收取居间费），不承担房屋瑕疵连带责任。

### 3.2 入口

- 租约详情页新增「发起电子签」按钮
- 仅租约 `status = 'active'` 时显示
- 同一租约只能发起一份合同（重复点击复用现有 contract，进入对应签字状态）

### 3.3 用户身份要求

- **房东**：已登录养房账号 + 手机号 + 身份证号（在养房 user_profile 中已采集）
- **中介**：以中介姓名 + 手机号（在 lease 表的 agent_name/agent_phone 字段中）作为身份锚
- **租客**：以租客姓名 + 手机号 + 身份证号（在 tenants 表中）作为身份锚

v1 不强制活体人脸（这是 v2 / 接 CA 时再加的能力）。

---

## 4. 系统架构

### 4.1 模块拆分

```
┌─────────────────────────────────────────────┐
│            养房 Tend Next.js App            │
├─────────────────────────────────────────────┤
│ /leases/[id]               (租约详情 + 入口) │
│ /sign/[token]              (公开签字页)     │
│ /api/contracts/create      (创建合同)       │
│ /api/contracts/sign        (签字提交)       │
│ /api/contracts/sms-code    (发送短信验证码) │
│ /api/contracts/[id]/pdf    (下载最终 PDF)   │
└──────────┬───────────────────┬──────────────┘
           │                   │
   ┌───────▼─────┐    ┌────────▼─────────┐
   │ PDF 生成服务 │    │ 短信网关         │
   │ (pdfkit)    │    │ (阿里云短信 SDK) │
   └───────┬─────┘    └──────────────────┘
           │
   ┌───────▼──────────────────────────────┐
   │ Supabase (PostgreSQL + Storage)      │
   │ - contracts 表                       │
   │ - contract_signers 表                │
   │ - Storage: contracts/<id>/initial.pdf │
   │ - Storage: contracts/<id>/final.pdf   │
   └──────────────────────────────────────┘
```

### 4.2 关键依赖

| 组件 | 选型 | 备注 |
|---|---|---|
| PDF 生成 | `pdfkit` 或 `@react-pdf/renderer` | 服务端渲染，两个标准模板 |
| 手写签字 | `react-signature-canvas` | 客户端画板，输出 PNG base64 |
| 短信网关 | 阿里云短信服务 SDK (`@alicloud/dysmsapi20170525`) | 用户已在阿里云生态，复用 |
| PDF 哈希 | Node 原生 `crypto.createHash('sha256')` | |
| 可信时间戳 | （v1.1 增强）联合信任 / 中国信通院 | v1 先不接，留接口 |

---

## 5. 数据模型

### 5.1 新增表：`contracts`

```sql
CREATE TABLE contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id),
  lease_id        UUID NOT NULL REFERENCES leases(id),
  template_type   TEXT NOT NULL CHECK (template_type IN ('direct', 'agent')),
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'partial', 'signed', 'void', 'expired')),
  pdf_initial_url TEXT,                    -- 初稿 PDF（无签字）
  pdf_final_url   TEXT,                    -- 最终 PDF（含签字+审计页）
  pdf_hash_sha256 TEXT,                    -- 最终 PDF 的 SHA256
  ts_token        TEXT,                    -- 可信时间戳（v1.1 加，预留字段）
  expires_at      TIMESTAMPTZ,             -- 签字过期时间（默认创建后 7 天）
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  signed_at       TIMESTAMPTZ,             -- 所有方签完的时间
  deleted_at      TIMESTAMPTZ              -- 软删
);

CREATE INDEX idx_contracts_lease ON contracts(lease_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_household ON contracts(household_id) WHERE deleted_at IS NULL;
```

### 5.2 新增表：`contract_signers`

```sql
CREATE TABLE contract_signers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  role                TEXT NOT NULL CHECK (role IN ('landlord', 'agent', 'tenant')),
  sign_order          INT  NOT NULL,              -- 1, 2, 3 签字顺序
  name                TEXT NOT NULL,
  phone               TEXT NOT NULL,
  id_number           TEXT,                       -- 中介可无身份证号
  public_token        TEXT UNIQUE,                -- 公开签字页的访问令牌 (32 位随机串)
  signed_at           TIMESTAMPTZ,
  sign_ip             TEXT,
  sign_ua             TEXT,
  signature_image_url TEXT,                       -- 手写签名 PNG 存 Storage
  sms_code_hash       TEXT,                       -- 验证码 SHA256（不留明文）
  sms_sent_at         TIMESTAMPTZ,                -- 验证码发送时间
  sms_verified_at     TIMESTAMPTZ,                -- 验证码验证通过时间
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_signers_contract ON contract_signers(contract_id);
CREATE INDEX idx_signers_token ON contract_signers(public_token) WHERE public_token IS NOT NULL;
```

### 5.3 RLS（行级安全）

- `contracts`：房东只能看到自己 household 下的合同（同 leases 表的策略）
- `contract_signers`：房东可看，匿名用户可通过 `public_token` 单条查看（用于公开签字页）

### 5.4 状态机

```
draft ─[房东点发起]─▶ partial ─[最后一方签完]─▶ signed
                       │
                       ├─[超过 expires_at]──▶ expired
                       │
                       └─[房东撤销]─────────▶ void
```

---

## 6. API 设计

### 6.1 `POST /api/contracts/create`

**用途**：房东点「发起电子签」，创建合同 + 生成初稿 PDF + 给房东准备签字。

**入参**：
```json
{
  "lease_id": "uuid"
}
```

**逻辑**：
1. 检查租约存在且属于当前 household
2. 检查该 lease 上无未撤销合同；若有 → 返回已存在的 contract_id
3. 根据 `rental_source` 选模板：direct → 双签；agent → 三签
4. 渲染初稿 PDF（用 lease + tenants + properties 数据填字段）
5. 存 `contracts` + `contract_signers`（每方一行）
6. 各方生成 `public_token`（房东方实际不会用，仅一致性）

**返回**：
```json
{
  "success": true,
  "contract_id": "uuid",
  "signers": [
    { "role": "landlord", "sign_order": 1, "name": "...", "phone": "139..." },
    { "role": "tenant", "sign_order": 3, "name": "...", "phone": "186...", "public_token": "..." }
  ]
}
```

### 6.2 `POST /api/contracts/sms-code`

**用途**：给当前签字方发短信验证码。

**入参**：
```json
{
  "contract_id": "uuid",
  "role": "landlord",
  "public_token": "..."  // 非房东方必填
}
```

**逻辑**：
1. 校验：
   - 房东方：检查登录用户 + household_id 匹配
   - 非房东方：检查 public_token 匹配
2. 检查上一方已签字（顺序约束）
3. 检查 60 秒频控
4. 生成 6 位验证码 → 调阿里云短信
5. 存 `sms_code_hash` + `sms_sent_at`

**返回**：`{ "success": true, "next_request_at": "ISO8601" }`

### 6.3 `POST /api/contracts/sign`

**用途**：当前签字方提交签字。

**入参**：
```json
{
  "contract_id": "uuid",
  "role": "landlord",
  "public_token": "...",          // 非房东方必填
  "sms_code": "123456",
  "signature_image": "data:image/png;base64,..."
}
```

**逻辑**：
1. 同上鉴权
2. 验 sms_code：哈希比对 + 时效（5 分钟）
3. 上传签名图到 Storage：`contracts/<id>/sig-<role>.png`
4. 写 `contract_signers`：`signed_at`、`sign_ip`、`sign_ua`、`signature_image_url`、`sms_verified_at`
5. 判断是否所有人都签了：
   - 否 → contract.status = 'partial'；给下一方发签字提醒短信
   - 是 → 合成最终 PDF + 计算哈希 + 存 Storage；contract.status = 'signed'；通知所有方

**返回**：`{ "success": true, "contract_status": "partial" | "signed" }`

### 6.4 `GET /api/contracts/[id]/pdf`

**用途**：下载合同 PDF（初稿 / 最终）。

**鉴权**：
- 房东（登录态）始终可下
- 其他方需带 public_token

**返回**：PDF 二进制流，`Content-Type: application/pdf`

### 6.5 `GET /api/contracts/[id]`

**用途**：拿合同状态 + 各方签字情况。前端轮询展示。

---

## 7. 前端页面

### 7.1 入口：租约详情 / 列表

- 租约卡片右下角加「电子签」状态徽章：
  - 无合同 → 「发起电子签」按钮
  - partial → 「等待 XX 签字」灰条
  - signed → 「已签 · 查看」链接
- 点「发起电子签」 → 调 `/api/contracts/create` → 跳转 `/contracts/[id]/sign`（房东签字页）

### 7.2 房东签字页 `/contracts/[id]/sign`

- 顶部显示合同信息（房源 / 租客 / 金额 / 期限）
- 中部 PDF 预览（用 `react-pdf` viewer）
- 底部：
  1. 「我已阅读合同全部条款」勾选
  2. 手写签名画板（`react-signature-canvas`）
  3. 「发送验证码」按钮 → 输入 6 位验证码
  4. 「确认签字」按钮 → 提交
- 签完跳到「等待租客 / 中介签字」状态页

### 7.3 公开签字页 `/sign/[public_token]`

- 同上结构，但无养房登录态
- 顶部加「养房 Tend」品牌头部 + 说明：「您正在签署《XX 房屋租赁合同》，房东 XXX 已签字。请仔细阅读后再签。」
- 同样手写画板 + 短信验证码 + 提交
- 提交后显示「签字完成」+「下载合同 PDF」按钮

### 7.4 房东查看合同状态页 `/contracts/[id]`

- 显示三方签字进度条
- 已签方显示姓名 + 签字时间 + 签字 IP（隐去后几位）
- 未签方显示「等待中」+「重发短信提醒」按钮
- 全部签完后显示「下载最终合同 PDF」+「合同哈希：xxx」+「可信时间戳：xxx」（v1.1）

---

## 8. PDF 模板

### 8.1 模板 A：房屋租赁合同 · 直租

包含条款（**需法务审核**）：
1. 出租方（房东）信息
2. 承租方（租客）信息
3. 房屋情况（地址、面积、户型）
4. 租赁期限
5. 租金、押金、付款方式
6. 双方权利义务
7. 维修责任
8. 违约责任
9. 争议解决
10. 其他约定
11. 签字页（房东 + 租客 签名区 + 日期）
12. **审计附页**（自动生成，见 8.3）

### 8.2 模板 B：房屋租赁合同 · 中介居间

在模板 A 基础上：
- 增加「居间方」（中介）信息条款
- 增加「居间费用 / 服务范围」条款（金额从 `lease.agent_fee` 取）
- 中介在签字页签居间方位

### 8.3 审计附页（必含）

最终 PDF 的最后一页自动追加：

```
─────────────────────────────────────
电子签约审计信息（《电子签名法》第 13 条凭证）

合同 ID：c8f2a1bc-...
签署方：
  房东   王XX  139****1234  ✓ 已签字 2026-05-23 14:33:21
         签字 IP: 223.104.***.142   签字 UA: Mozilla/5.0 ...
         短信验证：2026-05-23 14:31:08 已通过
  租客   李XX  186****5678  ✓ 已签字 2026-05-23 16:02:08
         签字 IP: 117.136.***.211   签字 UA: ...
         短信验证：2026-05-23 16:00:42 已通过

PDF 文件 SHA256：a1b2c3d4...（共 64 字符）
可信时间戳：2026-05-23T16:02:09Z  签发：联合信任时间戳服务

依据《中华人民共和国电子签名法》第 13、14 条，
本合同电子签名与手写签名具有同等法律效力。

养房 Tend 平台（运营主体：[公司全称待 Tend 团队补]）作为
存证服务方，负责存储签署记录、审计日志 5 年以上。
─────────────────────────────────────
```

### 8.4 模板字段绑定

PDF 模板用 handlebars / mustache 风格变量绑定 lease + tenants + properties + signers 数据，避免手拼字符串。

---

## 9. 错误处理与边界情况

| 场景 | 处理 |
|---|---|
| 房东发起合同时，租约关键字段（金额 / 日期）有空 | 前端校验拦截，不发起 |
| 签字过程中租约被房东编辑 | 提示房东「合同已发起，编辑租约会作废现有合同，是否继续？」 |
| 短信验证码超时（>5 分钟） | 提示用户「验证码已过期，请重发」 |
| 短信验证码错误 3 次 | 锁定该方 30 分钟 |
| 签字后租客手机号变更 | v1 不支持改，需房东撤销当前合同重发 |
| 中介拒签 | 房东可在 `/contracts/[id]` 点「撤销合同」→ status = 'void'；可重新发起 |
| 7 天未签完 | 状态自动转 expired，房东需重发 |
| PDF 生成失败 | 重试 3 次，仍失败回滚 `contracts` 记录，前端提示「合同生成失败请重试」 |
| 短信发送失败 | 重试 1 次；仍失败提示用户用备用方式 |
| 合同已签字后试图删除租约 | leases.handleDelete 检查 contracts 是否存在 status='signed'；若有则拦截 |

---

## 10. 安全 & 隐私

### 10.1 数据安全

- 短信验证码**不留明文**，存 SHA256(code + contract_id + role) 哈希
- 身份证号在前端展示**统一脱敏**（前 6 后 4 显示，中间星号）
- 签字图、PDF 存 Supabase Storage **私有桶**，通过签名 URL（有效期 1 小时）下发
- `public_token` 用 `crypto.randomBytes(32).toString('hex')` 生成

### 10.2 防滥用

- 短信发送频控：单手机号 60 秒一条，单日 10 条
- 短信成本上限：单合同最多发 8 条短信（房东 + 三方各 ≤2 次重发 + 完成通知）
- 公开签字页 `/sign/[token]`：每个 IP 5 分钟最多请求 10 次

### 10.3 审计日志

新增 `contract_audit_log` 表（可选，v1.1 实现），记录每次创建 / 签字 / 撤销操作。

---

## 11. 部署与灰度

### 11.1 数据库迁移

新增 `supabase/migrations/0013_econtract.sql`：
- 建 contracts、contract_signers 表
- RLS 策略
- 必要索引

### 11.2 环境变量

```
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=养房Tend
ALIYUN_SMS_TEMPLATE_CODE_CONTRACT_INVITE=SMS_XXX
ALIYUN_SMS_TEMPLATE_CODE_CONTRACT_VERIFY=SMS_XXX
ALIYUN_SMS_TEMPLATE_CODE_CONTRACT_DONE=SMS_XXX
```

短信模板需先在阿里云控制台申请：
- "邀请签字"：xx 邀请您签订租房合同，请打开链接 ${url} 完成签字
- "验证码"：您正在签订租房合同，验证码 ${code}，5 分钟有效
- "签字完成"：您的租房合同已完成签字，下载链接 ${url}

### 11.3 灰度

v1 上线先**全开**给所有种子轮用户（与 SEED_ALL_PRO 一致），收集真实使用反馈。

---

## 12. 测试计划

### 12.1 单元测试

- PDF 模板渲染：字段绑定、缺失字段降级
- 短信验证码生成与哈希校验
- 状态机转换边界
- public_token 唯一性

### 12.2 集成测试

- 双签全流程：房东发起 → 房东签 → 租客签 → 合同完成
- 三签全流程：房东 → 中介 → 租客
- 顺序约束：租客在房东未签前不能签
- 过期自动转 expired
- 撤销 + 重发

### 12.3 手工验收

- 用 5 个种子用户跑真实流程
- 检查 PDF 在 iOS / 安卓 / PC 浏览器渲染一致
- 检查短信送达率 ≥ 95%

---

## 13. 未来路线（v2、v3）

### v1.1（接近 v1，1 周内可加）
- 接联合信任 / 信通院 **可信时间戳** API（单条 ~¥1）
- 审计日志表 + 后台查询

### v2（Pro Premium 升级，3-6 个月后）
- 接 **腾讯电子签** 高级版作为「Pro Premium」会员专属权益
- 单合同走 CA 实名 + 人脸 + 司法鉴定级证书
- 价格：用户单独购买 ¥10/份

### v3（机构 / 长期方向）
- 法大大 / e签宝企业版对接
- 多语言模板（普通话 + 粤语版？外籍租客英文版？）

---

## 14. 工时与里程碑

| 里程碑 | 内容 | 工时估算 |
|---|---|---|
| M1 | DB migration + 后端 API（create / sms-code / sign）+ PDF 模板（无签字） | 1.5 天 |
| M2 | 前端：房东发起页 + 房东签字页 + 公开签字页 | 1 天 |
| M3 | PDF 合成 + 签字图嵌入 + 审计附页 | 0.5 天 |
| M4 | 短信集成 + 模板申请 | 0.5 天 |
| M5 | 法务审标准模板 A、B（外包） | 法务出时间 |
| M6 | 真实环境联调 + 5 用户验收 | 0.5 天 |
| **合计** | | **~4 天开发 + 法务并行** |

法务审核可与开发并行，开发期间走通流程后再用真模板替换。

---

## 15. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 法务模板未审完 | 上线延期 | 找有合作律师 / 法律咨询平台外包，~1500-3000 元/版 |
| 短信送达失败 | 用户无法签字 | 阿里云短信日常送达率 ≥ 98%；失败 retry + 客服补救 |
| 用户翻脸抵赖签字 | 法律纠纷 | v1 已含 IP/UA/手机号/PDF哈希；v1.1 加可信时间戳进一步加强 |
| iOS PWA 拍照 / 画板兼容性 | 用户签不上 | 提前在 5 台不同 iOS 设备测试；用浏览器原生 canvas 兜底 |
| 用户 5 年后翻历史合同找不到 | 数据丢失 | Supabase Storage 默认永久 + 每月备份；不下线后人工导出归档 |

---

## 16. 结论

本设计在不引入第三方 CA 服务的前提下，依据《电子签名法》第 13、14 条提供等同手写签名的法律效力，覆盖养房 Tend 个体房东客群的全部签约场景。

v1 投入低（~4 天开发 + 几千元法务），运营成本低（短信 ¥0.05/条），适合种子轮快速验证用户对「电子签」功能的真实需求。验证后再决定是否升级到 CA 版本。
