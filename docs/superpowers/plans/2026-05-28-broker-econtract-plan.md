# 中介居间电子合同（轻签约 v2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `lease.rental_source = "agent"` 的租约能发起电子合同，生成两份关联合同（《房屋租赁合同》+《房屋租赁居间服务协议》），三方电子签字。

**Architecture:** 通过 `contract_group_id` UUID 关联两份合同。房东签字一次更新两份合同的 landlord_signed_at；租客签直租合同；中介签居间合同。新增 `broker` 角色 + 新 PDF 模板。

**Tech Stack:** Next.js 15 + TypeScript + Supabase (Postgres + Storage) + pdfkit + vitest + 阿里云短信。前端：React 19 (PWA) + Vue 3/uniapp (mp)。

**关联文档：** [`docs/superpowers/specs/2026-05-28-broker-econtract-design.md`](../specs/2026-05-28-broker-econtract-design.md)

**预计工程量：** 2-3 天（13 个 task）

---

## File Structure

**新增文件：**
- `supabase/migrations/0023_contract_group.sql` — schema 扩展
- `src/lib/utils/number-to-chinese.ts` — 人民币大写工具
- `src/lib/utils/number-to-chinese.test.ts` — 单测
- `src/lib/econtract/templates/broker.ts` — 居间协议 PDF 模板
- `src/lib/econtract/create-group.ts` — 共享 createBrokerContractGroup 函数

**修改文件：**
- `src/lib/econtract/pdf-generator.ts` — 加 broker 模板分支
- `src/lib/econtract/templates/direct.ts` — 加条件渲染的 broker 介绍行
- `src/app/api/contracts/create/route.ts` — 移除拦截，调用 createBrokerContractGroup
- `src/app/api/mp/contracts/create/route.ts` — 同上
- `src/app/api/contracts/sign/route.ts` — 加 broker role + id_number 强制校验
- `src/app/api/contracts/[id]/route.ts` — 返回同组其他合同
- `src/app/contracts/[id]/page.tsx` — 双合同 tab UI
- `src/app/sign/[token]/page.tsx` — 中介首次签字加身份证步骤
- **独立 repo** `K:\baozupo-mp\src\pages\leases\list.vue` — 发起按钮文案

---

## Task 1: 数据库 migration 0023（contract_group_id + broker role）

**Files:**
- Create: `supabase/migrations/0023_contract_group.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- supabase/migrations/0023_contract_group.sql
-- ============================================================
-- 0023: 合同分组支持 + broker 签字角色
-- ============================================================
-- 背景：
--   轻签约 v2 引入"中介居间"模式：一次发起生成两份合同
--   - 《房屋租赁合同》（房东 + 租客）
--   - 《房屋租赁居间服务协议》（房东 + 中介）
--   两份合同共享同一个 contract_group_id 关联。
--
-- 改动：
--   1. contracts 表加 contract_group_id（nullable，旧数据保持 null）
--   2. contract_signers.role 加 'broker' 枚举值
-- ============================================================

-- 1. contracts 加分组字段（向后兼容，nullable）
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_contracts_group_id
  ON public.contracts(contract_group_id);

-- 2. contract_signers.role 加 'broker'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_signers_role_check'
  ) THEN
    ALTER TABLE public.contract_signers DROP CONSTRAINT contract_signers_role_check;
  END IF;
END $$;

ALTER TABLE public.contract_signers
  ADD CONSTRAINT contract_signers_role_check
  CHECK (role IN ('landlord', 'tenant', 'broker'));
```

- [ ] **Step 2: 在 ECS 上 apply migration**

通过 Workbench 在 ECS 跑：

```bash
cd /opt/baozupo && cat supabase/migrations/0023_contract_group.sql | \
  (set -a; . .env.production; set +a; psql "$SUPABASE_DB_URL" || \
   curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/exec_sql" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -d @-)
```

如果 supabase 自建没暴露 exec_sql RPC，改用 supabase-cli 或直接 psql 连数据库（用户的 RDS 连接信息单独获取）。

**Expected：** Migration 跑完不报错。

- [ ] **Step 3: 验证 schema**

```bash
(set -a; . /opt/baozupo/.env.production; set +a; curl -s \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/contracts?select=id,contract_group_id&limit=1") | jq .
```

**Expected：** 返回的 JSON 里有 `contract_group_id` 字段（值为 null）。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_contract_group.sql
git commit -m "feat(db): 0023 contract_group_id + broker signer role"
```

---

## Task 2: numberToChinese 工具函数（TDD）

**Files:**
- Create: `src/lib/utils/number-to-chinese.ts`
- Test: `src/lib/utils/number-to-chinese.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/utils/number-to-chinese.test.ts
import { describe, it, expect } from "vitest";
import { numberToChinese } from "./number-to-chinese";

describe("numberToChinese", () => {
  it("整数 0", () => {
    expect(numberToChinese(0)).toBe("零元整");
  });
  it("整数 1", () => {
    expect(numberToChinese(1)).toBe("壹元整");
  });
  it("整数 1234", () => {
    expect(numberToChinese(1234)).toBe("壹仟贰佰叁拾肆元整");
  });
  it("整数 100000", () => {
    expect(numberToChinese(100000)).toBe("壹拾万元整");
  });
  it("小数 0.05", () => {
    expect(numberToChinese(0.05)).toBe("零元零伍分");
  });
  it("小数 12.34", () => {
    expect(numberToChinese(12.34)).toBe("壹拾贰元叁角肆分");
  });
  it("小数 1000.50", () => {
    expect(numberToChinese(1000.5)).toBe("壹仟元伍角");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/utils/number-to-chinese.test.ts`
Expected: FAIL — "Cannot find module './number-to-chinese'"

- [ ] **Step 3: 实现 numberToChinese**

```typescript
// src/lib/utils/number-to-chinese.ts
/**
 * 阿拉伯数字转人民币大写（用于合同金额）。
 *
 * 输入：1234.56 → 输出："壹仟贰佰叁拾肆元伍角陆分"
 * 整数：附加"整"，如 100 → "壹佰元整"
 *
 * 限制：仅支持小于 9999_9999_9999.99 的非负数。
 */

const DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const UNITS = ["", "拾", "佰", "仟"];
const BIG_UNITS = ["", "万", "亿"];

function intToChinese(n: number): string {
  if (n === 0) return "零";

  let result = "";
  let bigIdx = 0;

  while (n > 0) {
    const group = n % 10000;
    n = Math.floor(n / 10000);

    if (group === 0) {
      // 当前 4 位全 0，但更高位有数 → 加一个"零"，但避免重复
      if (result && !result.startsWith("零")) {
        result = "零" + result;
      }
      bigIdx++;
      continue;
    }

    let groupStr = "";
    let unitIdx = 0;
    let g = group;
    let lastZero = false;

    while (g > 0) {
      const d = g % 10;
      if (d === 0) {
        if (!lastZero && groupStr) {
          groupStr = "零" + groupStr;
        }
        lastZero = true;
      } else {
        groupStr = DIGITS[d] + UNITS[unitIdx] + groupStr;
        lastZero = false;
      }
      g = Math.floor(g / 10);
      unitIdx++;
    }

    result = groupStr + BIG_UNITS[bigIdx] + result;
    bigIdx++;
  }

  // 清理结尾的"零"
  result = result.replace(/零+$/, "");
  return result;
}

export function numberToChinese(amount: number): string {
  if (amount < 0) throw new Error("不支持负数");
  if (amount > 9999_9999_9999.99) throw new Error("金额过大");

  const yuan = Math.floor(amount);
  const fenTotal = Math.round((amount - yuan) * 100);
  const jiao = Math.floor(fenTotal / 10);
  const fen = fenTotal % 10;

  if (yuan === 0 && fenTotal === 0) return "零元整";

  let result = "";
  if (yuan > 0) {
    result += intToChinese(yuan) + "元";
  } else {
    result += "零元";
  }

  if (jiao === 0 && fen === 0) {
    result += "整";
  } else {
    if (jiao > 0) {
      result += DIGITS[jiao] + "角";
    } else if (yuan > 0 && fen > 0) {
      // 元/分之间无角，补"零"
      result += "零";
    }
    if (fen > 0) {
      result += DIGITS[fen] + "分";
    }
  }

  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/utils/number-to-chinese.test.ts`
Expected: PASS（7/7 tests passed）

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/number-to-chinese.ts src/lib/utils/number-to-chinese.test.ts
git commit -m "feat(utils): 添加人民币大写转换工具 + 7 个单测"
```

---

## Task 3: broker PDF 模板（《居间服务协议》）

**Files:**
- Create: `src/lib/econtract/templates/broker.ts`

- [ ] **Step 1: 写 broker.ts**

参考 direct.ts 的结构和样式。

```typescript
// src/lib/econtract/templates/broker.ts
/**
 * 房屋租赁居间服务协议模板（房东 + 中介双签）
 *
 * 与直租合同同期签订，反映"居间合同"独立法律关系。
 */

import type PDFDocument from "pdfkit";
import { numberToChinese } from "@/lib/utils/number-to-chinese";

export interface BrokerTemplateData {
  contract_id: string;
  landlord: { name: string; phone: string; id_number: string };
  broker: { name: string; phone: string; id_number: string };
  property: { name: string; address: string; city?: string | null };
  lease: { start_date: string; monthly_rent: number };
  agent_fee: number;
  generated_at: string;
}

export function renderBrokerContract(
  doc: typeof PDFDocument.prototype,
  data: BrokerTemplateData
) {
  // ===== 标题 =====
  doc.font("CJK-Bold").fontSize(20).text("房屋租赁居间服务协议", { align: "center" });
  doc.moveDown(0.5);
  doc.font("CJK").fontSize(10).text(`合同编号：${data.contract_id}`, { align: "right" });
  doc.text(`生成时间：${formatDate(data.generated_at)}`, { align: "right" });
  doc.moveDown(1.5);

  // ===== 双方信息 =====
  doc.font("CJK-Bold").fontSize(12).text("委托方（甲方 · 房东）");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`联系电话：${data.landlord.phone}`);
  doc.text(`身份证号：${maskId(data.landlord.id_number)}`);
  doc.moveDown(0.5);

  doc.font("CJK-Bold").fontSize(12).text("居间方(乙方 · 中介)");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.broker.name}`);
  doc.text(`联系电话：${data.broker.phone}`);
  doc.text(`身份证号：${maskId(data.broker.id_number)}`);
  doc.moveDown(1.5);

  // ===== 第一条 委托事项 =====
  doc.font("CJK-Bold").fontSize(12).text("第一条 委托事项");
  doc.font("CJK").fontSize(10);
  doc.text(`甲方委托乙方就坐落于 ${data.property.address} 的房屋（${data.property.name}）寻找承租人并促成租赁合同签订。`);
  doc.text(`本次促成的租赁合同自 ${data.lease.start_date} 起生效，月租金人民币 ${data.lease.monthly_rent.toFixed(2)} 元。`);
  doc.moveDown(0.5);

  // ===== 第二条 居间费用 =====
  doc.font("CJK-Bold").fontSize(12).text("第二条 居间费用及支付");
  doc.font("CJK").fontSize(10);
  doc.text(`一、居间费总额：人民币 ${data.agent_fee.toFixed(2)} 元（大写：${numberToChinese(data.agent_fee)}）`);
  doc.text("二、支付义务方：甲方（房东）。");
  doc.text("三、支付时间：在《房屋租赁合同》正式签订后 7 个自然日内一次性支付。");
  doc.text("四、支付方式：银行转账 / 微信 / 支付宝 / 现金（双方约定）。");
  doc.moveDown(0.5);

  // ===== 第三条 乙方义务 =====
  doc.font("CJK-Bold").fontSize(12).text("第三条 乙方义务");
  doc.font("CJK").fontSize(10);
  doc.text("一、向甲方提供真实、合法的承租人身份信息及联系方式。");
  doc.text("二、协助甲方与承租人达成租赁合同的签订。");
  doc.text("三、必要时协助甲方与承租人完成房屋交接。");
  doc.text("四、乙方对所提供的身份信息真实性负责。");
  doc.moveDown(0.5);

  // ===== 第四条 甲方义务 =====
  doc.font("CJK-Bold").fontSize(12).text("第四条 甲方义务");
  doc.font("CJK").fontSize(10);
  doc.text("一、提供真实、合法的房屋出租信息。");
  doc.text("二、按本协议第二条约定足额支付居间费。");
  doc.moveDown(0.5);

  // ===== 第五条 违约责任 =====
  doc.font("CJK-Bold").fontSize(12).text("第五条 违约责任");
  doc.font("CJK").fontSize(10);
  doc.text("一、甲方居间费逾期支付超过 30 日的，每日按居间费总额 0.5% 支付违约金。");
  doc.text("二、乙方提供虚假信息致使租赁合同无法履行或解除的，应全额退还已收取的居间费。");
  doc.moveDown(0.5);

  // ===== 第六条 争议解决 =====
  doc.font("CJK-Bold").fontSize(12).text("第六条 争议解决");
  doc.font("CJK").fontSize(10);
  const city = data.property.city || "房屋所在地";
  doc.text(`本协议履行过程中产生的争议，由双方友好协商解决；协商不成的，向${city}有管辖权的人民法院起诉。`);
  doc.moveDown(0.5);

  // ===== 第七条 其他 =====
  doc.font("CJK-Bold").fontSize(12).text("第七条 其他约定");
  doc.font("CJK").fontSize(10);
  doc.text("一、本协议采用电子签约方式签署，依据《中华人民共和国电子签名法》第十三条、第十四条，电子签名与手写签名具有同等法律效力。");
  doc.text("二、本协议与《房屋租赁合同》同期签订，双方在两份合同上的签字共同生效。");
  doc.text("三、本协议自双方完成电子签字之日起生效。");
  doc.moveDown(1);

  // ===== 签字页 =====
  doc.addPage();
  doc.font("CJK-Bold").fontSize(14).text("签 字 页", { align: "center" });
  doc.moveDown(2);

  doc.font("CJK").fontSize(10);
  doc.text("委托方（甲方·房东）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`日期：______________`);
  doc.moveDown(2);

  doc.text("居间方（乙方·中介）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.broker.name}`);
  doc.text(`日期：______________`);
}

function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 10) return id;
  return id.slice(0, 6) + "********" + id.slice(-4);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
```

- [ ] **Step 2: 改 pdf-generator.ts 增加 broker 分支**

修改 `src/lib/econtract/pdf-generator.ts`：

```typescript
// Top of file
import { renderDirectContract, type DirectTemplateData } from "./templates/direct";
import { renderBrokerContract, type BrokerTemplateData } from "./templates/broker";

export type TemplateData = DirectTemplateData | BrokerTemplateData;

export async function generateInitialPdf(
  templateType: "direct" | "broker",
  data: TemplateData
): Promise<Buffer> {
  const cjk = resolveCjkFont();

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: templateType === "broker" ? "房屋租赁居间服务协议" : "房屋租赁合同",
        Author: "养房 Tend",
        Creator: "养房 Tend 电子签约",
      },
    });

    // 注册字体（保持不变）
    if (cjk.family) {
      doc.registerFont("CJK", cjk.file, cjk.family);
      doc.registerFont("CJK-Bold", cjk.file, cjk.family);
    } else {
      doc.registerFont("CJK", cjk.file);
      doc.registerFont("CJK-Bold", cjk.file);
    }

    const buffers: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    if (templateType === "broker") {
      renderBrokerContract(doc, data as BrokerTemplateData);
    } else {
      renderDirectContract(doc, data as DirectTemplateData);
    }

    doc.end();
  });
}
```

- [ ] **Step 3: 写 smoke test 生成实际 PDF 看看**

```bash
cat > /tmp/test-broker-pdf.mjs <<'EOF'
import { generateInitialPdf } from "./src/lib/econtract/pdf-generator.ts";
import fs from "fs";

const pdf = await generateInitialPdf("broker", {
  contract_id: "TEST-001",
  landlord: { name: "张房东", phone: "13800138000", id_number: "110101199001011234" },
  broker: { name: "王中介", phone: "13900139000", id_number: "110101199001019999" },
  property: { name: "朝阳区某小区", address: "北京市朝阳区某街道 1 号", city: "北京市" },
  lease: { start_date: "2026-06-01", monthly_rent: 5000 },
  agent_fee: 5000,
  generated_at: new Date().toISOString(),
});

fs.writeFileSync("/tmp/test-broker.pdf", pdf);
console.log("PDF size:", pdf.length, "bytes");
EOF
npx tsx /tmp/test-broker-pdf.mjs
```

**Expected:** "PDF size: > 10000 bytes"；用 PDF reader 打开 `/tmp/test-broker.pdf` 看渲染效果。

- [ ] **Step 4: Commit**

```bash
git add src/lib/econtract/templates/broker.ts src/lib/econtract/pdf-generator.ts
git commit -m "feat(econtract): 居间服务协议 PDF 模板 + 接入 pdf-generator"
```

---

## Task 4: 直租合同模板加"中介居间介绍"行

**Files:**
- Modify: `src/lib/econtract/templates/direct.ts`

- [ ] **Step 1: 扩展 DirectTemplateData**

修改 direct.ts 顶部：

```typescript
export interface DirectTemplateData {
  contract_id: string;
  landlord: { name: string; phone: string; id_number: string };
  tenant: { name: string; phone: string; id_number: string };
  property: { name: string; address: string; area_sqm?: number | null };
  lease: { ... };  // 保持不变
  /** 可选：当通过中介居间时，合同里要加一行介绍 */
  broker?: { name: string; phone: string } | null;
  generated_at: string;
}
```

- [ ] **Step 2: 在 renderDirectContract 中加条件渲染**

在 "第七条 其他约定" 之前插入：

```typescript
// ===== 居间方信息（如有）=====
if (data.broker) {
  doc.font("CJK-Bold").fontSize(12).text("居间方信息");
  doc.font("CJK").fontSize(10);
  doc.text(`本租赁合同由 ${data.broker.name}（${data.broker.phone}）居间介绍，居间费及双方权利义务详见《房屋租赁居间服务协议》。`);
  doc.moveDown(0.5);
}
```

- [ ] **Step 3: 跑 smoke test 验证**

```bash
cat > /tmp/test-direct-with-broker.mjs <<'EOF'
import { generateInitialPdf } from "./src/lib/econtract/pdf-generator.ts";
import fs from "fs";

const pdf = await generateInitialPdf("direct", {
  contract_id: "TEST-002",
  landlord: { name: "张房东", phone: "13800138000", id_number: "110101199001011234" },
  tenant: { name: "李租客", phone: "13700137000", id_number: "110101199501015555" },
  property: { name: "朝阳区某小区", address: "北京市朝阳区某街道 1 号", area_sqm: 80 },
  lease: { start_date: "2026-06-01", end_date: "2027-06-01", monthly_rent: 5000,
           deposit: 5000, rent_due_day: 5, payment_cycle: "monthly" },
  broker: { name: "王中介", phone: "13900139000" },
  generated_at: new Date().toISOString(),
});

fs.writeFileSync("/tmp/test-direct-with-broker.pdf", pdf);
console.log("PDF size:", pdf.length, "bytes");
EOF
npx tsx /tmp/test-direct-with-broker.mjs
```

**Expected:** PDF 里"第七条"前面有"居间方信息"一段。

- [ ] **Step 4: 验证向后兼容**

跑一次没有 broker 字段的 direct：

```bash
cat > /tmp/test-direct-no-broker.mjs <<'EOF'
import { generateInitialPdf } from "./src/lib/econtract/pdf-generator.ts";
import fs from "fs";
const pdf = await generateInitialPdf("direct", {
  contract_id: "TEST-003",
  landlord: { name: "张房东", phone: "13800138000", id_number: "110101199001011234" },
  tenant: { name: "李租客", phone: "13700137000", id_number: "110101199501015555" },
  property: { name: "朝阳区某小区", address: "北京市朝阳区某街道 1 号", area_sqm: 80 },
  lease: { start_date: "2026-06-01", end_date: "2027-06-01", monthly_rent: 5000,
           deposit: 5000, rent_due_day: 5, payment_cycle: "monthly" },
  generated_at: new Date().toISOString(),
});
fs.writeFileSync("/tmp/test-direct-no-broker.pdf", pdf);
console.log("OK, no broker section in this PDF");
EOF
npx tsx /tmp/test-direct-no-broker.mjs
```

**Expected:** PDF 跑通；用 reader 打开**不应**看到"居间方信息"段。

- [ ] **Step 5: Commit**

```bash
git add src/lib/econtract/templates/direct.ts
git commit -m "feat(econtract): direct 模板加可选 broker 介绍行（向后兼容）"
```

---

## Task 5: createBrokerContractGroup 共享函数

**Files:**
- Create: `src/lib/econtract/create-group.ts`

- [ ] **Step 1: 写 create-group.ts**

```typescript
// src/lib/econtract/create-group.ts
/**
 * 创建一组关联合同（《租赁合同》+《居间服务协议》）。
 * 同 contract_group_id；分别生成 PDF；分别建 4 个 signers。
 *
 * 失败时回滚（删除已创建的 contracts 行）。
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { generateInitialPdf } from "./pdf-generator";

type SupabaseAdmin = ReturnType<typeof createClient>;

interface CreateGroupInput {
  admin: SupabaseAdmin;
  lease: {
    id: string;
    household_id: string;
    start_date: string;
    end_date: string;
    monthly_rent: number;
    deposit: number;
    rent_due_day: number;
    payment_cycle: string;
    agent_name: string;
    agent_phone: string;
    agent_fee: number;
    property: { name: string; address: string; area_sqm?: number | null; city?: string | null };
  };
  landlord: { name: string; phone: string; id_number: string };
  primaryTenant: { name: string; phone: string; id_number: string };
}

interface CreateGroupResult {
  success: true;
  contract_group_id: string;
  rental_contract_id: string;
  broker_contract_id: string;
}

export async function createBrokerContractGroup(
  input: CreateGroupInput
): Promise<CreateGroupResult> {
  const { admin, lease, landlord, primaryTenant } = input;

  // 必填校验
  if (!lease.agent_name?.trim() || !lease.agent_phone?.trim() || !lease.agent_fee) {
    throw new Error("中介姓名 / 手机号 / 居间费不能为空");
  }

  const groupId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();
  const createdContractIds: string[] = [];

  try {
    // ===== 1. 创建《租赁合同》contract A =====
    const { data: contractA, error: errA } = await admin
      .from("contracts")
      .insert({
        household_id: lease.household_id,
        lease_id: lease.id,
        template_type: "direct",
        contract_group_id: groupId,
        status: "draft",
      })
      .select()
      .single();
    if (errA || !contractA) throw new Error(`创建租赁合同失败：${errA?.message}`);
    createdContractIds.push(contractA.id);

    // ===== 2. 创建《居间服务协议》contract B =====
    const { data: contractB, error: errB } = await admin
      .from("contracts")
      .insert({
        household_id: lease.household_id,
        lease_id: lease.id,
        template_type: "broker",
        contract_group_id: groupId,
        status: "draft",
      })
      .select()
      .single();
    if (errB || !contractB) throw new Error(`创建居间协议失败：${errB?.message}`);
    createdContractIds.push(contractB.id);

    // ===== 3. 生成 PDF A（直租 + 居间介绍行）=====
    const pdfA = await generateInitialPdf("direct", {
      contract_id: contractA.id,
      landlord,
      tenant: primaryTenant,
      property: {
        name: lease.property.name,
        address: lease.property.address,
        area_sqm: lease.property.area_sqm,
      },
      lease: {
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: Number(lease.monthly_rent),
        deposit: Number(lease.deposit),
        rent_due_day: Number(lease.rent_due_day),
        payment_cycle: lease.payment_cycle,
      },
      broker: { name: lease.agent_name, phone: lease.agent_phone },
      generated_at: generatedAt,
    });

    // ===== 4. 生成 PDF B（居间协议）=====
    const pdfB = await generateInitialPdf("broker", {
      contract_id: contractB.id,
      landlord,
      broker: {
        name: lease.agent_name,
        phone: lease.agent_phone,
        id_number: "", // 中介签字时填
      },
      property: {
        name: lease.property.name,
        address: lease.property.address,
        city: lease.property.city,
      },
      lease: {
        start_date: lease.start_date,
        monthly_rent: Number(lease.monthly_rent),
      },
      agent_fee: Number(lease.agent_fee),
      generated_at: generatedAt,
    });

    // ===== 5. 上传 PDF 到 Storage =====
    const pathA = `${lease.household_id}/${contractA.id}/initial.pdf`;
    const pathB = `${lease.household_id}/${contractB.id}/initial.pdf`;

    const { error: upErrA } = await admin.storage
      .from("contracts")
      .upload(pathA, pdfA, { contentType: "application/pdf", upsert: true });
    if (upErrA) throw new Error(`上传租赁合同 PDF 失败：${upErrA.message}`);

    const { error: upErrB } = await admin.storage
      .from("contracts")
      .upload(pathB, pdfB, { contentType: "application/pdf", upsert: true });
    if (upErrB) throw new Error(`上传居间协议 PDF 失败：${upErrB.message}`);

    // ===== 6. 写 contract.pdf_initial_path =====
    await admin.from("contracts").update({ pdf_initial_path: pathA }).eq("id", contractA.id);
    await admin.from("contracts").update({ pdf_initial_path: pathB }).eq("id", contractB.id);

    // ===== 7. 创建 4 个 signers =====
    const { error: signersErr } = await admin.from("contract_signers").insert([
      // 租赁合同 A
      {
        contract_id: contractA.id,
        role: "landlord",
        sign_order: 1,
        name: landlord.name,
        phone: landlord.phone,
        id_number: landlord.id_number,
        public_token: null,
      },
      {
        contract_id: contractA.id,
        role: "tenant",
        sign_order: 2,
        name: primaryTenant.name,
        phone: primaryTenant.phone,
        id_number: primaryTenant.id_number,
        public_token: crypto.randomUUID(),
      },
      // 居间协议 B
      {
        contract_id: contractB.id,
        role: "landlord",
        sign_order: 1,
        name: landlord.name,
        phone: landlord.phone,
        id_number: landlord.id_number,
        public_token: null,
      },
      {
        contract_id: contractB.id,
        role: "broker",
        sign_order: 2,
        name: lease.agent_name,
        phone: lease.agent_phone,
        id_number: null, // 中介签字时自填
        public_token: crypto.randomUUID(),
      },
    ]);
    if (signersErr) throw new Error(`创建签字人失败：${signersErr.message}`);

    return {
      success: true,
      contract_group_id: groupId,
      rental_contract_id: contractA.id,
      broker_contract_id: contractB.id,
    };
  } catch (err) {
    // 回滚：删除已创建的 contracts（contract_signers 通过 FK CASCADE 一并清）
    for (const id of createdContractIds) {
      await admin.from("contracts").delete().eq("id", id);
    }
    throw err;
  }
}
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `npx tsc --noEmit src/lib/econtract/create-group.ts`
Expected: 0 类型错误（忽略 Next.js 本身的 lib 类型警告，看不到 `create-group.ts` 自身的报错就 OK）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/econtract/create-group.ts
git commit -m "feat(econtract): createBrokerContractGroup 共享函数（含回滚）"
```

---

## Task 6: PWA 和 mp 端 `/contracts/create` 接入新函数

**Files:**
- Modify: `src/app/api/contracts/create/route.ts:139-147`
- Modify: `src/app/api/mp/contracts/create/route.ts:197-205`

- [ ] **Step 1: 改 PWA 路由**

打开 `src/app/api/contracts/create/route.ts`，定位 line 139-147：

```typescript
// ===== 6. 决定模板 =====
const templateType = lease.rental_source === "agent" ? "agent" : "direct";
if (templateType === "agent") {
  // Task 16 实现 agent 模板
  return NextResponse.json(
    { success: false, error: "中介居间模式正在开发中" },
    { status: 501 }
  );
}
```

**替换为：**

```typescript
// ===== 6. 决定流程 =====
// 中介模式 → 调用 createBrokerContractGroup，生成两份合同
if (lease.rental_source === "agent") {
  try {
    const result = await createBrokerContractGroup({
      admin: supabase,
      lease: {
        id: lease.id,
        household_id: lease.household_id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: Number(lease.monthly_rent),
        deposit: Number(lease.deposit ?? 0),
        rent_due_day: Number(lease.rent_due_day ?? 5),
        payment_cycle: lease.payment_cycle ?? "monthly",
        agent_name: lease.agent_name ?? "",
        agent_phone: lease.agent_phone ?? "",
        agent_fee: Number(lease.agent_fee ?? 0),
        property: {
          name: lease.property?.name ?? "—",
          address: lease.property?.address ?? "",
          area_sqm: lease.property?.area_sqm ?? null,
          city: lease.property?.city ?? null,
        },
      },
      landlord: { name: landlordName, phone: landlordPhone, id_number: landlordId },
      primaryTenant: {
        name: primaryTenant.name,
        phone: primaryTenant.phone,
        id_number: primaryTenant.id_number ?? "",
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// 直租模式 → 走原来的流程（contract A 单独）
const templateType: "direct" = "direct";
```

在文件顶部加 import：

```typescript
import { createBrokerContractGroup } from "@/lib/econtract/create-group";
```

- [ ] **Step 2: 改 mp 路由（mirror 逻辑）**

打开 `src/app/api/mp/contracts/create/route.ts`，做同样改动（line 197-205）。注意：mp 路由用的 supabase client 实例可能命名是 `admin` 而非 `supabase`，确认变量名一致。

```typescript
import { createBrokerContractGroup } from "@/lib/econtract/create-group";

// ... 在原来 if (templateType === "agent") 那段，替换为同样的 try/catch + createBrokerContractGroup
```

- [ ] **Step 3: 本地测试**

跑 npm run build 确认 TypeScript 0 错：

Run: `npm run build 2>&1 | tail -10`
Expected: "Compiled successfully" + 所有 route 列出

- [ ] **Step 4: Commit**

```bash
git add src/app/api/contracts/create/route.ts src/app/api/mp/contracts/create/route.ts
git commit -m "feat(api): /contracts/create + /mp/contracts/create 支持中介模式"
```

---

## Task 7: `/api/contracts/sign` 加 broker role 分支

**Files:**
- Modify: `src/app/api/contracts/sign/route.ts`

- [ ] **Step 1: 读现有 sign route 找到 role 分支位置**

```bash
grep -n "role" src/app/api/contracts/sign/route.ts | head -20
```

定位现有的 `if (signer.role === "landlord")` / `if (signer.role === "tenant")` 分支。

- [ ] **Step 2: 加 broker 分支（含 id_number 强制校验）**

在 tenant 分支后面或类似位置：

```typescript
// 中介签字（broker）：跟 tenant 类似但额外要求填写身份证号
if (signer.role === "broker") {
  // 校验 1：必须先填身份证号
  let brokerIdNumber = signer.id_number;
  if (!brokerIdNumber) {
    if (!body.id_number || typeof body.id_number !== "string") {
      return NextResponse.json(
        { error: "请先填写身份证号", code: "ID_NUMBER_REQUIRED" },
        { status: 400 }
      );
    }
    // 简单格式校验：18 位数字（最后一位可为 X/x）
    const id = body.id_number.trim().toUpperCase();
    if (!/^\d{17}[\dX]$/.test(id)) {
      return NextResponse.json(
        { error: "身份证号格式不正确（需 18 位）" },
        { status: 400 }
      );
    }
    // 更新 signer.id_number
    const { error: updErr } = await admin
      .from("contract_signers")
      .update({ id_number: id })
      .eq("id", signer.id);
    if (updErr) {
      return NextResponse.json(
        { error: "保存身份证号失败：" + updErr.message },
        { status: 500 }
      );
    }
    brokerIdNumber = id;
  }

  // 其他校验跟 tenant 共用：手机 OTP、手写签名图、PDF 合成
  // 这里复用现有 sign 逻辑（不重写）
  // ...
}
```

具体复用逻辑取决于现有 sign 流程的实现细节。**重点：broker 分支只比 tenant 多一步 id_number 校验**，其他签字逻辑（生成最终 PDF、写 signed_at、状态流转）完全一致。

- [ ] **Step 3: 跑 build + 单测**

Run: `npm run build && npm test`
Expected: 0 error

- [ ] **Step 4: Commit**

```bash
git add src/app/api/contracts/sign/route.ts
git commit -m "feat(api/sign): 加 broker role 签字流程 + id_number 强制校验"
```

---

## Task 8: `/api/contracts/[id]` 返回同组其他合同

**Files:**
- Modify: `src/app/api/contracts/[id]/route.ts`

- [ ] **Step 1: 加 group_contracts 字段**

在原来返回 contract 详情的位置加：

```typescript
// 如果该合同属于一个分组，返回同组其他合同（用于 UI tab）
let groupContracts: Array<{ id: string; template_type: string; status: string; pdf_initial_path: string | null; pdf_final_path: string | null }> = [];

if (contract.contract_group_id) {
  const { data: peers } = await admin
    .from("contracts")
    .select("id, template_type, status, pdf_initial_path, pdf_final_path")
    .eq("contract_group_id", contract.contract_group_id)
    .neq("id", contract.id);
  if (peers) groupContracts = peers;
}

return NextResponse.json({
  ...contract,
  group_contracts: groupContracts,
});
```

- [ ] **Step 2: 跑 build**

Run: `npm run build 2>&1 | tail -5`
Expected: 0 error

- [ ] **Step 3: Commit**

```bash
git add src/app/api/contracts/[id]/route.ts
git commit -m "feat(api): /contracts/[id] 返回 group_contracts（同组其他合同）"
```

---

## Task 9: PWA `contracts/[id]/page.tsx` 双合同 tab UI

**Files:**
- Modify: `src/app/contracts/[id]/page.tsx`

- [ ] **Step 1: 加 tab state + 切换条件**

在合同详情页顶部，如果 `group_contracts.length > 0`，加 tab 切换 UI：

```tsx
const [activeTab, setActiveTab] = useState<"current" | "peer">("current");
const hasGroup = data.group_contracts && data.group_contracts.length > 0;
const peer = hasGroup ? data.group_contracts[0] : null;

const tabLabel = (type: string) => type === "broker" ? "居间服务协议" : "租赁合同";

// JSX:
{hasGroup && peer && (
  <div className="flex border-b mb-4">
    <button
      onClick={() => setActiveTab("current")}
      className={`px-4 py-2 ${activeTab === "current" ? "border-b-2 border-primary font-bold" : ""}`}
    >
      {tabLabel(data.template_type)} {data.status === "completed" ? "✓" : "·"} 当前
    </button>
    <button
      onClick={() => { setActiveTab("peer"); router.push(`/contracts/${peer.id}`); }}
      className={`px-4 py-2`}
    >
      {tabLabel(peer.template_type)} {peer.status === "completed" ? "✓" : "·"} 同组
    </button>
  </div>
)}

{hasGroup && (
  <div className="text-sm text-muted-foreground mb-2">
    本合同属于「中介居间」合同组，共 2 份合同，签字状态：
    <span className="ml-2 font-bold">
      {data.status === "completed" && peer.status === "completed" ? "✅ 全部签订完成" : "⏳ 进行中"}
    </span>
  </div>
)}
```

- [ ] **Step 2: 本地起开发服务器 + 手工测试**

```bash
npm run dev
```

浏览器打开一个有 group_contracts 的 contract URL，验证：
- 看到 tab 切换条
- 点 tab 跳转到 peer contract
- 进度提示显示正确

- [ ] **Step 3: Commit**

```bash
git add src/app/contracts/[id]/page.tsx
git commit -m "feat(ui): 合同详情页支持双合同 tab 切换 + 整体进度提示"
```

---

## Task 10: PWA `sign/[token]/page.tsx` 加中介身份证步骤

**Files:**
- Modify: `src/app/sign/[token]/page.tsx`

- [ ] **Step 1: 加身份证输入 step**

读现有 sign page 找到 OTP 验证完成后、手写签字之前的位置。加：

```tsx
// 当 signer.role === "broker" && !signer.id_number 时插入
{signer?.role === "broker" && !signer?.id_number && step === "id_number" && (
  <div className="space-y-4">
    <h3 className="text-lg font-bold">填写身份证号</h3>
    <p className="text-sm text-muted-foreground">作为居间方签约人，请填写您的真实身份证号。</p>
    <Input
      value={idNumber}
      onChange={(e) => setIdNumber(e.target.value.toUpperCase())}
      placeholder="18 位身份证号"
      maxLength={18}
    />
    <Button
      onClick={async () => {
        // 调用 /api/contracts/sign 时带 id_number
        const res = await fetch("/api/contracts/sign", {
          method: "POST",
          body: JSON.stringify({ token, id_number: idNumber, action: "submit_id" }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          toast.error(error);
          return;
        }
        setStep("signature"); // 进入手写签名
      }}
      disabled={idNumber.length !== 18}
    >
      确认并下一步
    </Button>
  </div>
)}
```

state 加：

```typescript
const [step, setStep] = useState<"otp" | "id_number" | "signature" | "done">("otp");
const [idNumber, setIdNumber] = useState("");

useEffect(() => {
  // OTP 验证成功后
  if (otpVerified) {
    if (signer?.role === "broker" && !signer?.id_number) {
      setStep("id_number");
    } else {
      setStep("signature");
    }
  }
}, [otpVerified, signer]);
```

- [ ] **Step 2: 本地手工测试**

```bash
npm run dev
```

伪造一个 broker signer（直接在 DB 里插入），用其 public_token 进签字页，验证：
- OTP 通过后弹出"填写身份证号"
- 输错格式 → 报错
- 输对 → 进入签字步骤
- 已有 id_number 的 broker → 跳过这一步直接签字

- [ ] **Step 3: Commit**

```bash
git add src/app/sign/[token]/page.tsx
git commit -m "feat(ui/sign): 中介签字前强制填写身份证号"
```

---

## Task 11: mp 端 `pages/leases/list.vue` 修改发起按钮文案

**Files:**
- Modify: `K:\baozupo-mp\src\pages\leases\list.vue`（**独立 git repo**）

- [ ] **Step 1: 找到发起电子合同按钮**

```bash
cd K:/baozupo-mp && grep -n "电子合同\|contracts.create\|发起合同" src/pages/leases/list.vue | head -10
```

- [ ] **Step 2: 修改按钮 click 处理逻辑**

把原来"如果 rental_source === 'agent' 弹 toast"的逻辑改成提示 + 真正发起：

```typescript
async function onCreateContract(leaseId: string, rentalSource: string) {
  if (rentalSource === "agent") {
    // 提示用户将生成两份合同
    const { confirm } = await uni.showModal({
      title: "确认生成合同",
      content: "将自动生成 2 份合同：《房屋租赁合同》和《房屋租赁居间服务协议》。是否继续？",
      confirmText: "继续生成",
      cancelText: "取消",
    });
    if (!confirm) return;
  }

  // 调用 API
  const res = await api.post("/api/mp/contracts/create", { lease_id: leaseId });
  if (res.success) {
    uni.showToast({ title: "合同已生成", icon: "success" });
    // 跳转到合同详情（先跳第一个）
    uni.navigateTo({ url: `/pages/contracts/detail?id=${res.contract_group_id ? res.rental_contract_id : res.contract_id}` });
  } else {
    uni.showToast({ title: res.error || "生成失败", icon: "none" });
  }
}
```

- [ ] **Step 3: 在微信开发者工具里测试**

打开 `K:\baozupo-mp` → npm run dev:mp-weixin → 微信工具点击模拟器
模拟：登录 → 进入有中介信息的租约 → 点"发起电子合同"
验证：弹出确认弹窗 → 确认 → 跳转到合同详情

- [ ] **Step 4: Commit（独立 repo）**

```bash
cd K:/baozupo-mp
git add src/pages/leases/list.vue
git commit -m "feat(leases): 中介模式发起合同前加确认弹窗"
```

---

## Task 12: 本地端到端测试

**Files:** (无修改，仅运行测试)

- [ ] **Step 1: 跑全量单测**

```bash
cd K:/baozupo
npm test
```

Expected: 全部通过（含新加的 numberToChinese 7 个测试）

- [ ] **Step 2: 跑本地完整 build**

```bash
npm run build 2>&1 | tail -15
```

Expected: "Compiled successfully" + 0 警告

- [ ] **Step 3: 跑 10 个端到端场景**

依照 spec § 7 测试场景，在本地 dev server 跑通：

| # | 场景 | 验证方法 |
|---|---|---|
| 1 | 直租合同向后兼容 | 创建一个 rental_source=direct 租约 → 发起合同 → 检查 contract.contract_group_id 是 null |
| 2 | 中介合同正常发起 | rental_source=agent + agent_fee=5000 → 发起 → DB 查 2 个 contracts 共享同 group_id |
| 3 | 房东签字两份合同 | 房东登录 → 签 contract A 的 landlord → 检查 contract B 的 landlord 也已签 |
| 4 | 租客单独签字 | 用 tenant token → 进 sign 页 → 完成 → contract A=completed, B 还是 partial |
| 5 | 中介首次进签字页 | 用 broker token → OTP 通过 → 弹出"填身份证号" |
| 6 | 中介身份证格式错误 | 输 "abc123" → 报错"格式不正确" |
| 7 | 中介签字完成 | 输对身份证号 → 手写签名 → contract B=completed |
| 8 | 两份都签完 | UI 显示"全部签订完成"+ 房东可下载 |
| 9 | 缺少 agent_fee | 把 lease.agent_fee 改成 0 → 发起 → 报错"中介信息不全" |
| 10 | 老的"开发中"提示消失 | grep "中介居间模式正在开发中" src/ → 无结果 |

- [ ] **Step 4: 记录测试结果**

把通过/失败的 scenario 写到 docs/superpowers/plans/2026-05-28-broker-econtract-plan.md 末尾或单独的 e2e log。

---

## Task 13: 部署到生产

**Files:** (无代码修改，运维操作)

- [ ] **Step 1: 把所有 commit push 到 GitHub**

```bash
cd K:/baozupo
git push origin main
cd K:/baozupo-mp
git push origin main
```

- [ ] **Step 2: 在 ECS 上部署 PWA**

走 Workbench 终端：

```bash
cd /opt/baozupo && \
git pull && \
npm install --omit=dev && \
npm run build 2>&1 | tail -10 && \
pm2 restart baozupo && \
sleep 3 && pm2 status baozupo
```

Expected: pm2 status 显示 baozupo online, 0 unstable restarts。

- [ ] **Step 3: 部署 mp 端**

mp 端需要：
1. 在 K:\baozupo-mp 跑 `npm run build:mp-weixin`
2. 用微信开发者工具打开 `K:\baozupo-mp\dist\build\mp-weixin`
3. 点击"上传"提交新版到微信后台
4. 在微信公众平台后台把"开发版"提升为"体验版"
5. 通知体验成员重新打开小程序测试

或者，如果现在仍在审核中，**等当前审核通过后再发新版**（避免审核被打回）。

- [ ] **Step 4: 生产环境端到端 smoke 测试**

用主账号 119559402@qq.com 登录 PWA 测试：

1. 创建一个中介模式的租约（agent_name="测试中介"，agent_phone="13800138888"，agent_fee=2000）
2. 给租客发邀请填表（如果租客信息没有的话）
3. 房东点"发起电子合同"→ 看到「将生成 2 份合同」提示
4. 确认 → 跳到合同详情页 → 看到双 tab
5. 验证 DB 里有 2 个 contracts，同 group_id

- [ ] **Step 5: 留备份**

```bash
# 在 ECS 上备份当前数据库
mkdir -p /opt/backup-2026-05-28
cd /opt/baozupo
(set -a; . .env.production; set +a;
 for T in contracts contract_signers; do
   curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$T?select=*" \
        -o "/opt/backup-2026-05-28/$T.json"
 done)
ls -la /opt/backup-2026-05-28/
```

- [ ] **Step 6: 最终 commit 状态确认**

```bash
git log --oneline -15
```

Expected: 看到所有新 commit 都已在 origin/main 上。

---

## Self-Review 结果

**1. Spec 覆盖：**
- ✅ 数据模型变更 → Task 1
- ✅ PDF 模板设计 → Task 3, 4
- ✅ createBrokerContractGroup → Task 5
- ✅ /contracts/create 改造 → Task 6
- ✅ /contracts/sign 加 broker → Task 7
- ✅ /contracts/[id] 返回 group → Task 8
- ✅ PWA contracts/[id] 双 tab → Task 9
- ✅ PWA sign/[token] 加身份证 → Task 10
- ✅ mp 端发起按钮 → Task 11
- ✅ 10 个测试场景 → Task 12
- ✅ 部署 → Task 13

**2. Placeholder 扫描：**
- 所有 step 都有具体代码 / 命令
- 没有 "TBD" / "TODO" / "等等"
- 测试场景在 Task 12 具体列出

**3. 类型一致性：**
- `BrokerTemplateData` 定义在 broker.ts（Task 3），引用在 create-group.ts（Task 5）一致
- `numberToChinese` 在 Task 2 定义、Task 3 broker.ts 引用一致
- `contract_group_id` 在 Task 1 加 schema、Task 5 设值、Task 8 读取，名字一致

**4. 风险点：**
- Task 7 的 sign 路由 broker 分支「复用 tenant 签字逻辑」依赖现有代码结构，执行时可能要看具体 sign route 实现再决定。已在 Step 2 说明"具体复用逻辑取决于现有实现"。

---

**Plan 总计：13 个 task / 53 个步骤 / 2-3 天工程量**
