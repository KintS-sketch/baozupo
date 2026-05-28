# 中介居间电子合同（轻签约 v2） — 设计文档

- **日期**：2026-05-28
- **作者**：Tend 房东俩团队
- **状态**：草案 / 待用户审核
- **关联项目**：养房 Tend（baozupo）
- **前置文档**：[2026-05-23 轻签约 v1](2026-05-23-light-econtract-design.md)

---

## 1. 背景与目标

### 1.1 现状

v1 已上线，只支持"房东直租"（`lease.rental_source = "direct"`）电子合同。
当 `rental_source = "agent"`（通过中介）的租约点"发起电子合同"时，后端硬编码拦截：

```ts
// src/app/api/contracts/create/route.ts:140
// src/app/api/mp/contracts/create/route.ts:198
if (templateType === "agent") {
  return { error: "中介居间模式正在开发中" }  // 501
}
```

### 1.2 目标

让通过中介找到租客的房东也能走完整的电子签字流程。同时反映中国房屋租赁居间业务的**法律实践**：
**租赁合同**和**居间服务协议**是两个独立法律关系，应分别签订。

### 1.3 非目标

- 不做"中介费由房东 + 租客分摊"（暂只支持房东付）
- 不做中介公司/工商主体签约（暂只支持中介个人）
- 不做合同关联三方修改（一份签完不影响另一份的修改）

---

## 2. 业务流程

```
房东在 mp 端「租约 → 编辑」
  │
  ├─ rental_source 选「中介」
  ├─ 填中介姓名 / 手机 / 居间费
  └─ 保存

房东点「发起电子合同」
  │
  ├─ 系统校验：房东实名 / 租客手机号 / 中介手机号都有
  └─ 系统创建 contract_group（一个 UUID 标识一组合同）
        │
        ├─ 创建《租赁合同》contract A（template_type=direct）
        │     └─ signers: landlord (order 1) + tenant (order 2)
        │
        └─ 创建《居间服务协议》contract B（template_type=broker）
              └─ signers: landlord (order 1) + broker (order 2)

房东进入"合同详情"页 → 看到两份合同并列展示
  │
  ├─ 步骤 1：房东先签字两份合同（房东方）
  │     ├─ 短信 OTP 验证房东手机号
  │     ├─ 手写签名（两份共用一张签名图，省事）
  │     └─ A.status="landlord_signed" + B.status="landlord_signed"
  │
  ├─ 步骤 2：系统自动发短信给租客 + 中介
  │     ├─ 租客收到「请签订租赁合同」短信 + 链接
  │     └─ 中介收到「请签订居间服务协议」短信 + 链接
  │
  ├─ 步骤 3：租客点击链接 → /sign/[token]
  │     ├─ 输手机号 + OTP 验证
  │     ├─ 看到 PDF 预览（仅租赁合同）
  │     ├─ 手写签名
  │     └─ A.status="completed"
  │
  └─ 步骤 4：中介点击链接 → /sign/[token]
        ├─ 输手机号 + OTP 验证
        ├─ ⚠️ 首次签字要求填身份证号（中介专属步骤）
        ├─ 看到 PDF 预览（仅居间协议）
        ├─ 手写签名
        └─ B.status="completed"

两份都 "completed" → contract_group.status = "completed"
  └─ 房东在合同详情页看到「全部签订完成」+ 下载按钮
```

---

## 3. 数据模型变更

### 3.1 `contracts` 表

**新增字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `contract_group_id` | UUID NULLABLE | 关联同一组的多份合同。直租场景为 NULL（向后兼容），居间场景两份合同共享同一个 group_id |

**枚举扩展：**

`template_type` 已支持 `'direct'`，加 `'broker'`。

**SQL（migration 0023）：**

```sql
-- supabase/migrations/0023_contract_group.sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_contracts_group_id ON contracts(contract_group_id);

-- contract_signers.role 已支持 'landlord' | 'tenant'，加 'broker'
-- 如果用的是 CHECK 约束，需要重建
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_signers_role_check'
  ) THEN
    ALTER TABLE contract_signers DROP CONSTRAINT contract_signers_role_check;
  END IF;
END $$;

ALTER TABLE contract_signers
  ADD CONSTRAINT contract_signers_role_check
  CHECK (role IN ('landlord', 'tenant', 'broker'));
```

### 3.2 `contract_signers` 表

**无 schema 变更**，复用现有字段：
- `name` ← 中介姓名（来自 `lease.agent_name`）
- `phone` ← 中介手机（来自 `lease.agent_phone`）
- `id_number` ← 中介身份证号（中介签字时自己填，最初为 NULL）
- `public_token` ← 短信链接的 token

**新增 role 值：`'broker'`**

### 3.3 `lease` 表

**无 schema 变更**。`agent_name / agent_phone / agent_fee` 都已存在。**不加 `agent_id_number`**——身份证号在中介签字时填进 `contract_signers.id_number`，避免房东端的录入压力。

---

## 4. PDF 模板设计

### 4.1 直租合同模板 `direct.ts`

**保持不动**。仅在 broker 场景下，**直租合同里也加一行**：

> 居间方信息：本租赁合同由 **{agent_name}**（{agent_phone}）居间介绍，居间费用见《居间服务协议》。

### 4.2 居间服务协议模板 `broker.ts`（新建）

文件位置：`src/lib/econtract/templates/broker.ts`

**核心条款：**

```
房屋租赁居间服务协议

委托方（甲方）：{landlord_name}  手机：{landlord_phone}  身份证号：{landlord_id_number}
居间方（乙方）：{broker_name}    手机：{broker_phone}    身份证号：{broker_id_number}

一、委托事项
甲方委托乙方就坐落于 {property_address} 的房屋寻找承租人并促成租赁合同签订。

二、居间费用
1. 居间费金额：人民币 {agent_fee} 元（大写：{agent_fee_chinese}）
2. 支付方式：在《租赁合同》正式签订后 7 个自然日内由甲方一次性支付给乙方
3. 支付方式：银行转账 / 微信 / 支付宝 / 现金（双方约定）

三、乙方义务
1. 提供真实、合法的承租人信息
2. 协助甲方与承租人完成租赁合同签订
3. 协助甲方完成房屋交接

四、甲方义务
1. 提供真实、合法的房屋出租信息
2. 按约定足额支付居间费

五、违约责任
1. 居间费拖延支付超过 30 日，甲方需按每日 5% 支付违约金
2. 乙方提供虚假信息导致租赁合同解除，乙方应全额退还居间费

六、争议解决
本协议适用中华人民共和国法律。争议由 {property_city} 有管辖权的人民法院管辖。

七、其他
本协议自双方签字之日起生效。

──────────────────
甲方签字：{landlord_signature}    日期：{landlord_signed_at}
乙方签字：{broker_signature}      日期：{broker_signed_at}
```

`agent_fee_chinese` 通过 `numberToChinese()` 工具函数生成（人民币大写）。

### 4.3 字段映射

| 模板字段 | 数据来源 |
|---|---|
| `landlord_*` | `user_profiles` 表（房东实名信息） |
| `broker_name / broker_phone` | `lease.agent_name / lease.agent_phone` |
| `broker_id_number` | `contract_signers.id_number`（中介签字时填） |
| `agent_fee` | `lease.agent_fee` |
| `property_*` | `property` 表 |
| `*_signature` | `contract_signers.signature_image_url` |

---

## 5. API 改造

### 5.1 `POST /api/contracts/create` + `POST /api/mp/contracts/create`

**当前**（line 140-147 / 198-204）：
```ts
if (templateType === "agent") {
  return { error: "中介居间模式正在开发中" }
}
```

**改造为：**
```ts
if (lease.rental_source === "agent") {
  // 必要字段校验：agent_name / agent_phone / agent_fee 都必须有
  if (!lease.agent_name || !lease.agent_phone || !lease.agent_fee) {
    return { error: "请先在租约里补全中介姓名 / 手机 / 居间费" }
  }
  return await createBrokerContractGroup({ lease, landlord, primaryTenant, admin })
}

// 直租流程（不变）
return await createDirectContract(...)
```

**新函数 `createBrokerContractGroup()`：**

```ts
async function createBrokerContractGroup({ lease, landlord, primaryTenant, admin }) {
  const groupId = crypto.randomUUID()

  // 1. 创建直租合同
  const contractA = await admin.from("contracts").insert({
    household_id: lease.household_id,
    lease_id: lease.id,
    template_type: "direct",
    contract_group_id: groupId,
    status: "draft",
  }).select().single()

  // 2. 创建居间合同
  const contractB = await admin.from("contracts").insert({
    household_id: lease.household_id,
    lease_id: lease.id,
    template_type: "broker",
    contract_group_id: groupId,
    status: "draft",
  }).select().single()

  // 3. 生成两份 PDF
  const pdfA = await generateInitialPdf("direct", { ... })  // 含 broker 信息一行
  const pdfB = await generateInitialPdf("broker", { ... })

  // 4. 上传 storage
  await admin.storage.from("contracts").upload(
    `${lease.household_id}/${contractA.id}/initial.pdf`, pdfA, { ... })
  await admin.storage.from("contracts").upload(
    `${lease.household_id}/${contractB.id}/initial.pdf`, pdfB, { ... })

  // 5. 创建 signers
  await admin.from("contract_signers").insert([
    // 直租合同
    { contract_id: contractA.id, role: "landlord", sign_order: 1, ... },
    { contract_id: contractA.id, role: "tenant",   sign_order: 2, ... },
    // 居间协议
    { contract_id: contractB.id, role: "landlord", sign_order: 1, ... },
    { contract_id: contractB.id, role: "broker",   sign_order: 2,
      name: lease.agent_name, phone: lease.agent_phone, id_number: null,
      public_token: crypto.randomUUID() },
  ])

  return { success: true, contract_group_id: groupId,
           contracts: [contractA.id, contractB.id] }
}
```

### 5.2 `POST /api/contracts/sign`（broker 角色处理）

**现状：** 处理 `landlord` 和 `tenant` 两种 role 的签字。

**改造：** 加 `broker` role 分支。

```ts
// 现有逻辑
if (signer.role === "landlord") { ... }
if (signer.role === "tenant") { ... }

// 新增
if (signer.role === "broker") {
  // 中介签字前必须填 id_number
  if (!signer.id_number) {
    if (!body.id_number) {
      return { error: "请填写身份证号", code: "ID_NUMBER_REQUIRED" }
    }
    // 校验身份证号格式
    if (!isValidChineseId(body.id_number)) {
      return { error: "身份证号格式不正确" }
    }
    // 更新 signer.id_number
    await admin.from("contract_signers").update({
      id_number: body.id_number
    }).eq("id", signer.id)
  }
  // 其余跟 tenant 同样：签字、生成最终 PDF、更新 status
}
```

### 5.3 `GET /api/contracts/[id]`（返回 group 内所有合同）

**改造：** 在原返回基础上加 `group_contracts` 字段。

```ts
if (contract.contract_group_id) {
  const { data: groupContracts } = await admin
    .from("contracts")
    .select("id, template_type, status, pdf_final_path")
    .eq("contract_group_id", contract.contract_group_id)
    .neq("id", contract.id)
  return { ...contract, group_contracts: groupContracts }
}
```

### 5.4 `GET /api/sign-lookup`（broker 进入签字页时识别身份）

**复用现有逻辑**：通过 `public_token` 找 signer → 通过 `signer.contract_id` 找 contract → 返回 contract.template_type 让前端决定渲染哪个 PDF。

---

## 6. UI 改造

### 6.1 mp 端 - `pages/leases/list.vue` 详情 / `pages/contracts/[id].vue`（如果有）

**改造：**
- "发起电子合同"按钮点击后，弹窗不再显示"开发中"
- 改为「将自动生成 2 份合同：《租赁合同》和《居间服务协议》。是否继续？」
- 跳转到合同列表（参考 contracts 详情结构）

### 6.2 PWA 端 - `src/app/contracts/[id]/page.tsx`

**改造：**
- 如果 contract.contract_group_id 不为 null：显示一个 tab 切换条「租赁合同 / 居间协议」
- 房东视角下，两个 tab 都可见且都能下载
- 整体 status 显示为 "全部签订完成" / "部分完成" / "等待租客 + 中介"

### 6.3 公开签字页 - `src/app/sign/[token]/page.tsx`

**改造：**
- 现有：手机号 + OTP + 手写签名
- 新增：如果 signer.role === "broker" && 没填过身份证号，**在 OTP 验证后、手写签名前**加一个输入身份证号的 step
- 输完身份证号 → 后端写入 → 再进入手写签名步骤

---

## 7. 测试场景

| # | 场景 | 预期 |
|---|---|---|
| 1 | 直租合同不变（向后兼容） | rental_source=direct 走原流程，contract_group_id 为 null |
| 2 | 中介合同正常发起 | 生成 2 份合同，4 个 signers，2 份 PDF 上传到 storage |
| 3 | 房东签字两份合同 | 一次手写签名 → 同时更新 A 和 B 的 landlord_signed_at |
| 4 | 租客单独签字（不影响居间） | A.status=completed, B 还在 draft |
| 5 | 中介首次进签字页 | 强制要求填身份证号 + OTP |
| 6 | 中介身份证格式错误 | 报错"格式不正确"，不进入签字步骤 |
| 7 | 中介签字完成 | B.status=completed |
| 8 | 两份都签完 | UI 上展示「全部签订完成」（无 DB 字段，从两份合同 status 推导：`A.status === "completed" && B.status === "completed"`）；房东收到通知 |
| 9 | 缺少 agent_fee 发起 | 报错"请先在租约里补全中介信息" |
| 10 | 老的"开发中"提示 | 完全消失（grep 验证 if templateType === "agent" 拦截无残留） |

---

## 8. 工程量评估 + 里程碑

### Phase 1 — 数据模型 + 后端 API（0.5-1 天）

- [ ] migration 0023：contracts 加 contract_group_id 列 + contract_signers role 加 broker
- [ ] `createBrokerContractGroup()` 函数
- [ ] PWA `/api/contracts/create` + mp `/api/mp/contracts/create` 改造（移除拦截 + 调用新函数）
- [ ] `/api/contracts/sign` 加 broker 分支 + id_number 校验
- [ ] `/api/contracts/[id]` 返回 group_contracts

### Phase 2 — PDF 模板（0.5 天）

- [ ] 新建 `src/lib/econtract/templates/broker.ts`
- [ ] `numberToChinese()` 工具函数（人民币大写）
- [ ] `generateInitialPdf("broker", ...)` 改造
- [ ] `direct.ts` 加 "本合同由 XX 中介居间介绍" 一行（条件渲染）

### Phase 3 — UI（0.5-1 天）

- [ ] mp `pages/leases/list.vue` 发起按钮文案 / 跳转
- [ ] PWA `contracts/[id]/page.tsx` 双合同 tab
- [ ] 签字页 `sign/[token]/page.tsx` 加 broker 身份证 step

### Phase 4 — 测试 + 部署（0.5 天）

- [ ] 本地 build + vitest
- [ ] 端到端测试 10 个场景
- [ ] commit + push origin main
- [ ] ECS 部署（git pull + build + pm2 restart）
- [ ] 在 mp 真实环境验证 1 单中介合同走完

**总计：2-3 天**

---

## 9. 风险 + 注意事项

### 9.1 法律风险

- 中介签字身份证号是自填，**可能造假**。我们在合同里写明「乙方对所提供的身份信息真实性负责」，但实际诉讼时可能需要中介公司营业执照等增强证据。这是 v2 限制，v3 可考虑接腾讯电子签做实名验证。

### 9.2 数据迁移

- migration 0023 是**向后兼容**的（新增 nullable 字段），不影响现有数据。所有现有 contracts.contract_group_id = NULL 视为直租合同。

### 9.3 中介中途反悔不签

- 居间协议长期 draft → 房东合同详情页要能看到「中介还未签字」的明显提示
- 提供一键「重新发送签字短信」按钮
- 提供一键「跳过居间协议，仅走租赁合同」（房东自己取消居间协议，contractB.status="cancelled"）

### 9.4 上传中介信息后租约被改

- 如果发起合同后，房东又把租约 rental_source 改回 "direct"——居间合同仍然有效，UI 上保留它的入口。

---

## 10. 决策记录

| 决策 | 选项 | 理由 |
|---|---|---|
| 合同结构 | 两份独立 vs 一份三方 | 中国法律实践 |
| 居间费 | 房东全额付 vs 各付一半 | 个人房东最常见 |
| 中介签字 | 短信 OTP + 手写 vs mp 端签字 | 复用现有租客签字机制 |
| 中介身份证 | 中介自填 vs 房东代填 | 房东不一定有，且增加房东操作压力 |
| 合同号关联 | UUID group_id vs lease_id+type 复合 | 未来如果还要加更多合同类型（押金、转租），group_id 更通用 |
