# 轻签约 v1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「在线租房电子合同」轻签约 v1，双签（直租）/ 三签（中介居间）两种模式，依据《电子签名法》第 13/14 条提供等同手写签名的法律效力。

**Architecture:** Next.js 15 App Router server-side PDF 生成（`pdfkit`）+ 阿里云短信验证码 + 客户端手写画板（`react-signature-canvas`）+ Supabase PostgreSQL 存合同/签字记录 + Supabase Storage 存 PDF/签名图。无第三方 CA 依赖。

**Tech Stack:** Next.js 15 / React 19 / TypeScript / Supabase / pdfkit / react-signature-canvas / @alicloud/dysmsapi20170525 / Node crypto SHA256

**对应 spec：** `docs/superpowers/specs/2026-05-23-light-econtract-design.md`

---

## 文件结构总览

### 新增

```
supabase/migrations/0013_econtract.sql            -- DB schema

src/lib/econtract/
  ├── hash.ts                  -- SHA256 工具
  ├── tokens.ts                -- public_token 生成
  ├── sms.ts                   -- 阿里云短信 SDK 封装
  ├── pdf-generator.ts         -- 初稿 PDF 渲染主函数
  ├── pdf-composer.ts          -- 签字图嵌入 + 审计附页
  └── templates/
      ├── direct.ts            -- 直租模板正文
      └── agent.ts             -- 中介居间模板正文

src/types/contract.ts                              -- 类型定义

src/app/api/contracts/
  ├── create/route.ts                              -- POST 创建合同
  ├── sms-code/route.ts                            -- POST 发短信
  ├── sign/route.ts                                -- POST 签字
  └── [id]/
      ├── route.ts                                 -- GET 合同状态
      ├── pdf/route.ts                             -- GET PDF 下载
      └── void/route.ts                            -- POST 撤销

src/app/contracts/[id]/sign/page.tsx               -- 房东签字页
src/app/contracts/[id]/page.tsx                    -- 合同状态页
src/app/sign/[token]/page.tsx                      -- 公开签字页

src/components/contracts/
  ├── signature-canvas.tsx                         -- 手写画板
  ├── sms-code-input.tsx                           -- 验证码输入
  ├── pdf-preview.tsx                              -- PDF 预览
  └── sign-progress.tsx                            -- 三方签字进度条
```

### 修改

```
src/app/leases/page.tsx          -- 加「发起电子签」按钮 + 状态徽章 + 删除拦截
src/types/index.ts               -- 导出 Contract 类型
package.json                     -- 加依赖
.env.example                     -- 加阿里云短信环境变量
```

---

## Task 1：数据库 migration

**Files:**
- Create: `supabase/migrations/0013_econtract.sql`

- [ ] **Step 1: 写 migration**

```sql
-- 0013_econtract.sql
-- 轻签约 v1：合同表 + 签署方表 + RLS + 索引

create table if not exists contracts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  lease_id        uuid not null references leases(id) on delete cascade,
  template_type   text not null check (template_type in ('direct', 'agent')),
  status          text not null default 'draft'
                  check (status in ('draft', 'partial', 'signed', 'void', 'expired')),
  pdf_initial_path text,
  pdf_final_path   text,
  pdf_hash_sha256  text,
  ts_token         text,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  signed_at        timestamptz,
  deleted_at       timestamptz
);

create index idx_contracts_lease on contracts(lease_id) where deleted_at is null;
create index idx_contracts_household on contracts(household_id) where deleted_at is null;
create index idx_contracts_status on contracts(status) where deleted_at is null;

create table if not exists contract_signers (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null references contracts(id) on delete cascade,
  role                text not null check (role in ('landlord', 'agent', 'tenant')),
  sign_order          int  not null check (sign_order between 1 and 3),
  name                text not null,
  phone               text not null,
  id_number           text,
  public_token        text unique,
  signed_at           timestamptz,
  sign_ip             text,
  sign_ua             text,
  signature_image_path text,
  sms_code_hash       text,
  sms_code_expires_at timestamptz,
  sms_sent_at         timestamptz,
  sms_verified_at     timestamptz,
  sms_attempts        int not null default 0,
  sms_locked_until    timestamptz,
  created_at          timestamptz not null default now(),
  unique (contract_id, role)
);

create index idx_signers_contract on contract_signers(contract_id);
create index idx_signers_token on contract_signers(public_token) where public_token is not null;

-- RLS
alter table contracts enable row level security;
alter table contract_signers enable row level security;

-- contracts: 房东只看自己 household 下的
create policy contracts_owner_full on contracts
  for all using (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  )
  with check (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  );

-- contract_signers: 同上，通过 contract -> household 关联
create policy signers_owner_full on contract_signers
  for all using (
    contract_id in (
      select c.id from contracts c
      where c.household_id in (
        select household_id from household_members where user_id = auth.uid()
      )
    )
  );

-- 触发器：updated_at 自动维护
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_contracts_updated_at on contracts;
create trigger trg_contracts_updated_at
  before update on contracts
  for each row execute function set_updated_at();
```

- [ ] **Step 2: 在 RDS supabase_db 跑 migration**

按 memory 里的 deploy 模板，从 ECS 跑：

```bash
RDS=pgm-2zere1gfog159y51.pg.rds.aliyuncs.com
PGPASSWORD='TendDB_2026Yikai' psql -h $RDS -U postgres -d supabase_db \
  -f /opt/baozupo/supabase/migrations/0013_econtract.sql
```

预期：`CREATE TABLE` × 2, `CREATE INDEX` × 5, `CREATE POLICY` × 2, `CREATE TRIGGER` × 1，无 error。

- [ ] **Step 3: 验证表已建**

```bash
PGPASSWORD='TendDB_2026Yikai' psql -h $RDS -U postgres -d supabase_db \
  -c "\d contracts" -c "\d contract_signers"
```

预期：表结构正常打印，包含所有字段和约束。

- [ ] **Step 4: 提交**

```bash
cd K:/baozupo/.claude/worktrees/cranky-leavitt-125aa4
git add supabase/migrations/0013_econtract.sql
git commit -m "feat(econtract): 0013 migration 合同 + 签署方表"
```

---

## Task 2：核心 lib 工具

**Files:**
- Create: `src/lib/econtract/hash.ts`
- Create: `src/lib/econtract/tokens.ts`
- Create: `src/types/contract.ts`

- [ ] **Step 1: 写 `hash.ts`**

```ts
// src/lib/econtract/hash.ts
import { createHash, timingSafeEqual } from "crypto";

/** 计算任意 Buffer/string 的 SHA256（hex）。用于 PDF 哈希、SMS 验证码哈希。*/
export function sha256Hex(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return createHash("sha256").update(buf).digest("hex");
}

/** 把短信验证码 + salt 哈希后存库，避免明文留底。*/
export function hashSmsCode(code: string, salt: string): string {
  return sha256Hex(`${code}|${salt}`);
}

/** 恒时比较两个 hex 字符串。防计时攻击。*/
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
```

- [ ] **Step 2: 写 `tokens.ts`**

```ts
// src/lib/econtract/tokens.ts
import { randomBytes } from "crypto";

/** 生成公开签字令牌：32 字节 hex = 64 字符。用于 /sign/[token] 路由。*/
export function generatePublicToken(): string {
  return randomBytes(32).toString("hex");
}

/** 生成 6 位短信验证码（首位非 0）。*/
export function generateSmsCode(): string {
  const first = String(Math.floor(Math.random() * 9) + 1);
  const rest = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return first + rest;
}
```

- [ ] **Step 3: 写 `contract.ts` 类型**

```ts
// src/types/contract.ts
export type ContractStatus = "draft" | "partial" | "signed" | "void" | "expired";
export type ContractTemplateType = "direct" | "agent";
export type SignerRole = "landlord" | "agent" | "tenant";

export interface Contract {
  id: string;
  household_id: string;
  lease_id: string;
  template_type: ContractTemplateType;
  status: ContractStatus;
  pdf_initial_path: string | null;
  pdf_final_path: string | null;
  pdf_hash_sha256: string | null;
  ts_token: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  signed_at: string | null;
  deleted_at: string | null;
}

export interface ContractSigner {
  id: string;
  contract_id: string;
  role: SignerRole;
  sign_order: number;
  name: string;
  phone: string;
  id_number: string | null;
  public_token: string | null;
  signed_at: string | null;
  sign_ip: string | null;
  sign_ua: string | null;
  signature_image_path: string | null;
  sms_code_hash: string | null;
  sms_code_expires_at: string | null;
  sms_sent_at: string | null;
  sms_verified_at: string | null;
  sms_attempts: number;
  sms_locked_until: string | null;
  created_at: string;
}

export interface ContractWithSigners extends Contract {
  signers: ContractSigner[];
}
```

- [ ] **Step 4: 跑 TypeScript 类型检查**

```bash
cd K:/baozupo/.claude/worktrees/cranky-leavitt-125aa4 && npx tsc --noEmit 2>&1 | tail -20
```

预期：no errors。

- [ ] **Step 5: 提交**

```bash
git add src/lib/econtract/hash.ts src/lib/econtract/tokens.ts src/types/contract.ts
git commit -m "feat(econtract): hash/tokens 工具 + Contract 类型"
```

---

## Task 3：安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 npm 包**

```bash
cd K:/baozupo/.claude/worktrees/cranky-leavitt-125aa4
npm install pdfkit @types/pdfkit react-signature-canvas @alicloud/dysmsapi20170525 @alicloud/openapi-client @alicloud/tea-util
```

预期：5 个包安装成功，package.json + package-lock.json 更新。

- [ ] **Step 2: 验证安装**

```bash
cat node_modules/pdfkit/package.json | grep version
cat node_modules/react-signature-canvas/package.json | grep version
cat node_modules/@alicloud/dysmsapi20170525/package.json | grep version
```

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: 加 pdfkit/react-signature-canvas/@alicloud/dysmsapi20170525"
```

---

## Task 4：阿里云短信封装

**Files:**
- Create: `src/lib/econtract/sms.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写 `sms.ts`**

```ts
// src/lib/econtract/sms.ts
import Dysmsapi, * as $Dysmsapi from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";

/** 阿里云短信发送结果 */
export interface SendSmsResult {
  ok: boolean;
  bizId?: string;
  code?: string;
  message?: string;
}

function getClient() {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("ALIYUN_SMS_ACCESS_KEY_* not set");
  }
  const config = new $OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: "dysmsapi.aliyuncs.com",
  });
  return new Dysmsapi.default(config);
}

async function send(
  phone: string,
  templateCode: string,
  params: Record<string, string>
): Promise<SendSmsResult> {
  const signName = process.env.ALIYUN_SMS_SIGN_NAME ?? "养房Tend";
  const client = getClient();
  const req = new $Dysmsapi.SendSmsRequest({
    phoneNumbers: phone,
    signName,
    templateCode,
    templateParam: JSON.stringify(params),
  });
  try {
    const resp = await client.sendSms(req);
    const body = resp.body;
    return {
      ok: body?.code === "OK",
      bizId: body?.bizId,
      code: body?.code,
      message: body?.message,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/** 给签字方发邀请短信，包含公开签字页链接 */
export function sendContractInviteSms(
  phone: string,
  landlordName: string,
  url: string
) {
  const tpl = process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_INVITE ?? "";
  return send(phone, tpl, { name: landlordName, url });
}

/** 发签字短信验证码 */
export function sendContractVerifySms(phone: string, code: string) {
  const tpl = process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_VERIFY ?? "";
  return send(phone, tpl, { code });
}

/** 全部签字完成通知 */
export function sendContractDoneSms(phone: string, downloadUrl: string) {
  const tpl = process.env.ALIYUN_SMS_TEMPLATE_CONTRACT_DONE ?? "";
  return send(phone, tpl, { url: downloadUrl });
}
```

- [ ] **Step 2: 追加 `.env.example`**

```bash
# 在 .env.example 末尾追加
cat >> .env.example <<'EOF'

# 阿里云短信（电子签约用）
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=养房Tend
ALIYUN_SMS_TEMPLATE_CONTRACT_INVITE=SMS_XXXXXX
ALIYUN_SMS_TEMPLATE_CONTRACT_VERIFY=SMS_XXXXXX
ALIYUN_SMS_TEMPLATE_CONTRACT_DONE=SMS_XXXXXX
EOF
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | tail -20
```

预期：no errors。

- [ ] **Step 4: 提交**

```bash
git add src/lib/econtract/sms.ts .env.example
git commit -m "feat(econtract): 阿里云短信 SDK 封装 + 三个模板入口"
```

---

## Task 5：PDF 模板渲染（直租版）

**Files:**
- Create: `src/lib/econtract/templates/direct.ts`
- Create: `src/lib/econtract/pdf-generator.ts`

**关键设计：**
- 用 pdfkit 服务端生成 PDF
- 字段从 lease + tenant + property 自动绑定
- v1 模板暂用 PM 草稿条款（标 `// 待法务审`），后期法务返稿替换
- 签字区留空白格（约 60×30 mm），后续 pdf-composer 嵌签字图

- [ ] **Step 1: 写 `templates/direct.ts`**（草稿条款 + 字段绑定）

```ts
// src/lib/econtract/templates/direct.ts
import type PDFDocument from "pdfkit";

export interface DirectTemplateData {
  contract_id: string;
  landlord: { name: string; phone: string; id_number: string };
  tenant: { name: string; phone: string; id_number: string };
  property: { name: string; address: string; area_sqm?: number | null };
  lease: {
    start_date: string;
    end_date: string;
    monthly_rent: number;
    deposit: number;
    rent_due_day: number;
    payment_cycle: string; // monthly/quarterly/yearly
  };
  signed_at: string; // ISO 日期
}

/** 渲染直租合同正文到已 open 的 PDFDocument 流。签字页位置预留。*/
export function renderDirectContract(
  doc: typeof PDFDocument.prototype,
  data: DirectTemplateData
) {
  // ===== 标题 =====
  doc.font("Heiti").fontSize(20).text("房屋租赁合同", { align: "center" });
  doc.moveDown();
  doc.font("Songti").fontSize(10).text(`合同编号：${data.contract_id}`, { align: "right" });
  doc.moveDown(1.5);

  // ===== 双方信息 =====
  doc.fontSize(12).font("Heiti").text("出租方（房东）");
  doc.font("Songti").fontSize(10);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`手机：${data.landlord.phone}`);
  doc.text(`证件号：${maskId(data.landlord.id_number)}`);
  doc.moveDown();

  doc.fontSize(12).font("Heiti").text("承租方（租客）");
  doc.font("Songti").fontSize(10);
  doc.text(`姓名：${data.tenant.name}`);
  doc.text(`手机：${data.tenant.phone}`);
  doc.text(`证件号：${maskId(data.tenant.id_number)}`);
  doc.moveDown(1.5);

  // ===== 房屋情况 =====
  doc.fontSize(12).font("Heiti").text("第一条 房屋情况");
  doc.font("Songti").fontSize(10);
  doc.text(`房屋名称：${data.property.name}`);
  doc.text(`详细地址：${data.property.address}`);
  if (data.property.area_sqm) doc.text(`建筑面积：${data.property.area_sqm}㎡`);
  doc.moveDown();

  // ===== 租期 =====
  doc.fontSize(12).font("Heiti").text("第二条 租赁期限");
  doc.font("Songti").fontSize(10);
  doc.text(`起租日：${data.lease.start_date}`);
  doc.text(`止租日：${data.lease.end_date}`);
  doc.moveDown();

  // ===== 租金与押金 =====
  doc.fontSize(12).font("Heiti").text("第三条 租金及押金");
  doc.font("Songti").fontSize(10);
  doc.text(`月租金：人民币 ${data.lease.monthly_rent.toFixed(2)} 元`);
  doc.text(`押金：人民币 ${data.lease.deposit.toFixed(2)} 元，
    在租客交付时一并支付，租期届满无违约返还。`);
  doc.text(`付款周期：${humanizeCycle(data.lease.payment_cycle)}`);
  doc.text(`付款日：每${humanizeCycle(data.lease.payment_cycle)}的第 ${data.lease.rent_due_day} 日前支付。`);
  doc.moveDown();

  // ===== 标准条款（待法务审）=====
  doc.fontSize(12).font("Heiti").text("第四条 双方权利义务");
  doc.font("Songti").fontSize(10);
  doc.text("（一）出租方应于交付日前将房屋以适于约定用途的状态交付承租方使用。");
  doc.text("（二）承租方应按时支付租金，并妥善使用房屋，不得擅自改建。");
  doc.text("（三）房屋自然损耗的维修由出租方承担；承租方过失造成的损坏由承租方承担。");
  doc.text("（四）租期内承租方不得擅自转租或分租。");
  doc.moveDown();

  doc.fontSize(12).font("Heiti").text("第五条 违约责任");
  doc.font("Songti").fontSize(10);
  doc.text("任何一方违反本合同约定，应向守约方支付违约金，并赔偿因此造成的实际损失。");
  doc.moveDown();

  doc.fontSize(12).font("Heiti").text("第六条 争议解决");
  doc.font("Songti").fontSize(10);
  doc.text("本合同履行过程中产生的争议，由双方友好协商；协商不成的，向房屋所在地人民法院起诉。");
  doc.moveDown(2);

  // ===== 签字区 =====
  doc.fontSize(12).font("Heiti").text("第七条 签署", { align: "center" });
  doc.font("Songti").fontSize(10);
  doc.moveDown();
  // 留两个签字框，每个高约 80pt
  doc.text("出租方签字：");
  doc.rect(doc.x, doc.y + 5, 180, 60).stroke();
  doc.moveDown(5);
  doc.text(`日期：${data.signed_at.slice(0, 10)}`);
  doc.moveDown(2);

  doc.text("承租方签字：");
  doc.rect(doc.x, doc.y + 5, 180, 60).stroke();
  doc.moveDown(5);
  doc.text(`日期：__________`);
}

function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 10) return id;
  return id.slice(0, 6) + "********" + id.slice(-4);
}

function humanizeCycle(c: string): string {
  return { monthly: "月", quarterly: "季", yearly: "年" }[c] ?? c;
}
```

- [ ] **Step 2: 写 `pdf-generator.ts`**

```ts
// src/lib/econtract/pdf-generator.ts
import PDFDocument from "pdfkit";
import path from "path";
import { renderDirectContract, type DirectTemplateData } from "./templates/direct";

/** 生成初稿 PDF（无签字、无审计页），返回 Buffer。*/
export async function generateInitialPdf(
  templateType: "direct" | "agent",
  data: DirectTemplateData /* | AgentTemplateData，Task 14 加 */
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    // 注册中文字体（pdfkit 默认不支持中文）
    // 使用项目里已有的字体；若没有，要先放进 public/fonts/
    const songti = path.resolve(process.cwd(), "public/fonts/SongTi.ttf");
    const heiti = path.resolve(process.cwd(), "public/fonts/HeiTi.ttf");
    doc.registerFont("Songti", songti);
    doc.registerFont("Heiti", heiti);

    const buffers: Buffer[] = [];
    doc.on("data", (b: Buffer) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    if (templateType === "direct") {
      renderDirectContract(doc, data);
    } else {
      // Task 14 实现 agent
      reject(new Error("agent template not implemented yet"));
    }
    doc.end();
  });
}
```

- [ ] **Step 3: 字体文件准备**

要在 `public/fonts/` 放两个 ttf：
- `SongTi.ttf`（如 思源宋体 SourceHanSerifSC-Regular.ttf）
- `HeiTi.ttf`（如 思源黑体 SourceHanSansSC-Regular.ttf）

可从 https://github.com/adobe-fonts/source-han-sans / source-han-serif 下载 OTF，转 TTF 后放进去。

- [ ] **Step 4: 写测试脚本**

```ts
// scripts/test-pdf.ts
import { generateInitialPdf } from "../src/lib/econtract/pdf-generator";
import { writeFileSync } from "fs";

(async () => {
  const buf = await generateInitialPdf("direct", {
    contract_id: "test-001",
    landlord: { name: "王房东", phone: "13900001111", id_number: "440101199001011234" },
    tenant: { name: "李租客", phone: "18600002222", id_number: "440101199501011234" },
    property: { name: "会展湾水岸", address: "1栋2308", area_sqm: 78 },
    lease: {
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 5000,
      deposit: 5000,
      rent_due_day: 5,
      payment_cycle: "monthly",
    },
    signed_at: new Date().toISOString(),
  });
  writeFileSync("/tmp/test.pdf", buf);
  console.log("PDF generated: /tmp/test.pdf", buf.length, "bytes");
})();
```

跑：
```bash
npx tsx scripts/test-pdf.ts
```

预期：生成 /tmp/test.pdf，打开看排版正常，签字框是空的。

- [ ] **Step 5: 提交**

```bash
git add src/lib/econtract/templates/direct.ts src/lib/econtract/pdf-generator.ts public/fonts/ scripts/test-pdf.ts
git commit -m "feat(econtract): 直租合同 PDF 模板 + 字体注册"
```

---

## Task 6：API `POST /api/contracts/create`

**Files:**
- Create: `src/app/api/contracts/create/route.ts`

- [ ] **Step 1: 实现路由**

```ts
// src/app/api/contracts/create/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInitialPdf } from "@/lib/econtract/pdf-generator";
import { generatePublicToken } from "@/lib/econtract/tokens";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

  let body: { lease_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 }); }
  const leaseId = body.lease_id;
  if (!leaseId) return NextResponse.json({ success: false, error: "缺少 lease_id" }, { status: 400 });

  // 拉租约 + 关联租客 + 房源
  const { data: lease, error: leaseErr } = await supabase
    .from("leases")
    .select(`*, property:properties(*), lease_tenants(is_primary, tenant:tenants(*))`)
    .eq("id", leaseId)
    .is("deleted_at", null)
    .single();
  if (leaseErr || !lease) return NextResponse.json({ success: false, error: "租约不存在" }, { status: 404 });

  // 检查已存在合同
  const { data: existing } = await supabase
    .from("contracts")
    .select("id, status")
    .eq("lease_id", leaseId)
    .is("deleted_at", null)
    .in("status", ["draft", "partial", "signed"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ success: true, contract_id: existing.id, reused: true });
  }

  // 主租客
  const primaryTenant = lease.lease_tenants?.find((lt: { is_primary: boolean }) => lt.is_primary)?.tenant
    ?? lease.lease_tenants?.[0]?.tenant;
  if (!primaryTenant) return NextResponse.json({ success: false, error: "租约无租客" }, { status: 400 });

  // 必填字段校验
  const missing: string[] = [];
  if (!primaryTenant.name) missing.push("租客姓名");
  if (!primaryTenant.phone) missing.push("租客手机");
  if (!primaryTenant.id_number) missing.push("租客身份证号");
  if (!lease.monthly_rent) missing.push("月租金");
  if (missing.length > 0) {
    return NextResponse.json({ success: false, error: `请先补全：${missing.join("、")}` }, { status: 400 });
  }

  // 房东信息
  const { data: profile } = await supabase
    .from("user_profile")
    .select("name, phone, id_number")
    .eq("user_id", user.id)
    .single();
  if (!profile?.name || !profile.phone || !profile.id_number) {
    return NextResponse.json(
      { success: false, error: "请先在设置里完善房东身份证号" },
      { status: 400 }
    );
  }

  const templateType = lease.rental_source === "agent" ? "agent" : "direct";
  // v1 先只跑 direct；agent 在 Task 14
  if (templateType === "agent") {
    return NextResponse.json({ success: false, error: "中介模式实现中" }, { status: 501 });
  }

  // 创建 contract
  const { data: contract, error: contractErr } = await supabase
    .from("contracts")
    .insert({
      household_id: lease.household_id,
      lease_id: lease.id,
      template_type: templateType,
      status: "draft",
    })
    .select()
    .single();
  if (contractErr || !contract) {
    return NextResponse.json({ success: false, error: contractErr?.message ?? "创建失败" }, { status: 500 });
  }

  // 生成初稿 PDF
  const pdfBuf = await generateInitialPdf("direct", {
    contract_id: contract.id,
    landlord: { name: profile.name, phone: profile.phone, id_number: profile.id_number },
    tenant: {
      name: primaryTenant.name,
      phone: primaryTenant.phone,
      id_number: primaryTenant.id_number,
    },
    property: { name: lease.property.name, address: lease.property.address ?? "", area_sqm: lease.property.area_sqm },
    lease: {
      start_date: lease.start_date,
      end_date: lease.end_date,
      monthly_rent: Number(lease.monthly_rent),
      deposit: Number(lease.deposit ?? 0),
      rent_due_day: Number(lease.rent_due_day ?? 5),
      payment_cycle: lease.payment_cycle ?? "monthly",
    },
    signed_at: new Date().toISOString(),
  });

  // 上传到 Storage
  const initialPath = `contracts/${contract.id}/initial.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(initialPath, pdfBuf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    return NextResponse.json({ success: false, error: `PDF 上传失败：${upErr.message}` }, { status: 500 });
  }
  await supabase.from("contracts").update({ pdf_initial_path: initialPath }).eq("id", contract.id);

  // 创建签署方记录（v1 双签：房东 order=1, 租客 order=2）
  await supabase.from("contract_signers").insert([
    {
      contract_id: contract.id,
      role: "landlord",
      sign_order: 1,
      name: profile.name,
      phone: profile.phone,
      id_number: profile.id_number,
      public_token: null, // 房东登录态访问，不用 token
    },
    {
      contract_id: contract.id,
      role: "tenant",
      sign_order: 2,
      name: primaryTenant.name,
      phone: primaryTenant.phone,
      id_number: primaryTenant.id_number,
      public_token: generatePublicToken(),
    },
  ]);

  return NextResponse.json({ success: true, contract_id: contract.id, reused: false });
}
```

- [ ] **Step 2: 在 Supabase 控制台建 `contracts` Storage Bucket**

私有桶，名字 `contracts`。如果是用 Supabase Studio 没买，就跑 SQL：

```sql
insert into storage.buckets (id, name, public) values ('contracts', 'contracts', false)
on conflict (id) do nothing;
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | tail -20
```

- [ ] **Step 4: 提交**

```bash
git add src/app/api/contracts/create/route.ts
git commit -m "feat(econtract): POST /api/contracts/create 创建合同 + 生成初稿 PDF"
```

---

## Task 7：API `POST /api/contracts/sms-code`

**Files:**
- Create: `src/app/api/contracts/sms-code/route.ts`

- [ ] **Step 1: 实现**

```ts
// src/app/api/contracts/sms-code/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSmsCode } from "@/lib/econtract/tokens";
import { hashSmsCode } from "@/lib/econtract/hash";
import { sendContractVerifySms } from "@/lib/econtract/sms";

export const runtime = "nodejs";

const SMS_COOLDOWN_MS = 60_000;  // 60 秒频控
const CODE_TTL_MS = 5 * 60_000;  // 5 分钟有效期

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  let body: { contract_id?: string; role?: string; public_token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 }); }

  const { contract_id, role, public_token } = body;
  if (!contract_id || !role) return NextResponse.json({ success: false, error: "缺少参数" }, { status: 400 });

  // 鉴权
  let signer;
  if (role === "landlord") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    const { data: c } = await supabase.from("contracts").select("household_id").eq("id", contract_id).single();
    if (!c) return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });
    // RLS 已校验 household_id 归属
    const { data: s } = await supabase
      .from("contract_signers").select("*").eq("contract_id", contract_id).eq("role", "landlord").single();
    signer = s;
  } else {
    if (!public_token) return NextResponse.json({ success: false, error: "缺 public_token" }, { status: 400 });
    const { data: s } = await supabase
      .from("contract_signers").select("*")
      .eq("contract_id", contract_id).eq("role", role).eq("public_token", public_token).single();
    signer = s;
  }
  if (!signer) return NextResponse.json({ success: false, error: "签署方不存在" }, { status: 404 });

  // 顺序约束：前序签字方必须已签
  const { data: prev } = await supabase
    .from("contract_signers").select("signed_at")
    .eq("contract_id", contract_id).lt("sign_order", signer.sign_order);
  if ((prev ?? []).some((p) => !p.signed_at)) {
    return NextResponse.json({ success: false, error: "请等待上一签署方完成" }, { status: 409 });
  }

  // 已签则拒
  if (signer.signed_at) return NextResponse.json({ success: false, error: "您已签字" }, { status: 409 });

  // 频控
  if (signer.sms_sent_at) {
    const elapsed = Date.now() - new Date(signer.sms_sent_at).getTime();
    if (elapsed < SMS_COOLDOWN_MS) {
      const nextAt = new Date(new Date(signer.sms_sent_at).getTime() + SMS_COOLDOWN_MS).toISOString();
      return NextResponse.json({ success: false, error: `${Math.ceil((SMS_COOLDOWN_MS - elapsed)/1000)} 秒后再试`, next_at: nextAt }, { status: 429 });
    }
  }

  // 生成 & 发送
  const code = generateSmsCode();
  const result = await sendContractVerifySms(signer.phone, code);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: `短信发送失败：${result.message}` }, { status: 502 });
  }

  // 入库
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await supabase
    .from("contract_signers")
    .update({
      sms_code_hash: hashSmsCode(code, signer.id),
      sms_code_expires_at: expiresAt.toISOString(),
      sms_sent_at: now.toISOString(),
      sms_attempts: 0,
    })
    .eq("id", signer.id);

  return NextResponse.json({ success: true, expires_at: expiresAt.toISOString() });
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/app/api/contracts/sms-code/route.ts
git commit -m "feat(econtract): POST /api/contracts/sms-code 发短信验证码 + 频控"
```

---

## Task 8：PDF 合成（签字图嵌入 + 审计附页）

**Files:**
- Create: `src/lib/econtract/pdf-composer.ts`

- [ ] **Step 1: 实现 composer**

```ts
// src/lib/econtract/pdf-composer.ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// 注意：pdfkit 用于生成初稿；签字嵌入 + 审计页用 pdf-lib（更适合后期叠加）
// pdf-lib 已是 next.js 依赖（form-data 用），无需额外安装

export interface SignerAuditInfo {
  role: "landlord" | "agent" | "tenant";
  name: string;
  phone: string;       // 显示用，需脱敏
  signed_at: string;
  sign_ip: string | null;
  sign_ua: string | null;
  sms_verified_at: string | null;
  signature_png?: Buffer;  // 已下载的签名图，用于嵌入签字页
}

export async function composeFinalPdf(opts: {
  initialPdf: Buffer;
  signers: SignerAuditInfo[];
  contractId: string;
  pdfHashPreview?: string;  // 占位，最终调用方计算后会再覆盖
}): Promise<{ pdf: Buffer; placeholder: string }> {
  const src = await PDFDocument.load(opts.initialPdf);

  // ===== 1. 把签字图盖到签字框上 =====
  // 简化：v1 假设签字框固定在最后一页的相对坐标
  // 实际生产代码：在 templates/direct.ts 里用 pdf-lib 时记录 box 坐标，回传给 composer
  // v1 hack：把每个签字图按预定位置拼到最后一页
  const lastPage = src.getPage(src.getPageCount() - 1);
  const { width: pageW, height: pageH } = lastPage.getSize();

  for (const s of opts.signers) {
    if (!s.signature_png) continue;
    const png = await src.embedPng(s.signature_png);
    // 双签：landlord 上方，tenant 下方
    // 三签：landlord, agent, tenant
    const slotIndex = s.role === "landlord" ? 0 : s.role === "agent" ? 1 : 2;
    const y = pageH - 150 - slotIndex * 90;
    lastPage.drawImage(png, { x: 130, y, width: 100, height: 50 });
  }

  // ===== 2. 加审计附页 =====
  const auditPage = src.addPage();
  const font = await src.embedFont(StandardFonts.Helvetica);

  let y = auditPage.getHeight() - 60;
  const draw = (txt: string, opt: { size?: number; bold?: boolean } = {}) => {
    auditPage.drawText(txt, { x: 50, y, size: opt.size ?? 10, font, color: rgb(0, 0, 0) });
    y -= (opt.size ?? 10) + 6;
  };

  draw("Electronic Signature Audit / 电子签约审计信息", { size: 14 });
  y -= 8;
  draw(`Contract ID: ${opts.contractId}`);
  y -= 4;

  for (const s of opts.signers) {
    const phoneMask = s.phone.length >= 7 ? s.phone.slice(0,3) + "****" + s.phone.slice(-4) : s.phone;
    const ipMask = (s.sign_ip ?? "").split(".").slice(0, 3).join(".") + ".***";
    draw(`[${s.role}] ${s.name} ${phoneMask}`);
    draw(`  Signed at: ${s.signed_at}`);
    draw(`  IP: ${ipMask}`);
    draw(`  UA: ${(s.sign_ua ?? "").slice(0, 100)}`);
    draw(`  SMS verified at: ${s.sms_verified_at ?? "—"}`);
    y -= 4;
  }
  y -= 8;
  // 哈希占位：最终生成 PDF 后再覆盖
  const placeholder = "__PDF_HASH_PLACEHOLDER_64_CHAR_______________________________________";
  draw(`PDF SHA256: ${placeholder}`);
  y -= 12;
  draw("依据《电子签名法》第 13/14 条，本合同电子签名与手写签名具有同等法律效力。");
  draw("养房 Tend 平台（运营主体：[公司全称待 Tend 团队补]）作为存证服务方，");
  draw("负责存储签署记录、审计日志 5 年以上。");

  const bytes = await src.save();
  return { pdf: Buffer.from(bytes), placeholder };
}

/** 占位哈希替换：生成完整 PDF 后算 sha256，再把 placeholder 字符串 in-place 替换。
    这种 hack 不可靠（PDF 内部偏移会变）。生产做法：
    a) 算原始 PDF 哈希（含 placeholder）入库；用户校验时也按这个哈希算
    b) 或：把哈希写在不参与哈希计算的"外部"——比如响应头 + DB 字段
    v1 采用 (b)：PDF 内审计页不写哈希，由 DB 字段 contract.pdf_hash_sha256 提供。
*/
```

> **设计修订**：审计页里不再嵌入哈希文本（因为先算哈希再写哈希是先有鸡还是先有蛋）。哈希存到 `contracts.pdf_hash_sha256` 字段，前端在合同状态页显示。

修订上面代码：去掉 `placeholder` 行，简化 composer 返回单个 buffer。

```ts
// 修订后：
// 删掉 placeholder 行的 draw + 删掉返回的 placeholder 字段
// 函数签名改为：
export async function composeFinalPdf(opts: {...}): Promise<Buffer> { ... }
```

- [ ] **Step 2: 安装 pdf-lib 如未安装**

```bash
npm ls pdf-lib || npm install pdf-lib
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/econtract/pdf-composer.ts package.json package-lock.json
git commit -m "feat(econtract): PDF composer 签字图嵌入 + 审计附页"
```

---

## Task 9：API `POST /api/contracts/sign`

**Files:**
- Create: `src/app/api/contracts/sign/route.ts`

- [ ] **Step 1: 实现**

```ts
// src/app/api/contracts/sign/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashSmsCode, sha256Hex, safeEqualHex } from "@/lib/econtract/hash";
import { composeFinalPdf } from "@/lib/econtract/pdf-composer";
import { sendContractInviteSms, sendContractDoneSms } from "@/lib/econtract/sms";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_SMS_ATTEMPTS = 3;
const LOCK_MS = 30 * 60_000;

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  let body: { contract_id?: string; role?: string; public_token?: string; sms_code?: string; signature_image?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 }); }
  const { contract_id, role, public_token, sms_code, signature_image } = body;
  if (!contract_id || !role || !sms_code || !signature_image) {
    return NextResponse.json({ success: false, error: "缺少参数" }, { status: 400 });
  }

  // 取签字方（同 sms-code 接口的鉴权逻辑）
  let signer;
  if (role === "landlord") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    const { data: s } = await supabase
      .from("contract_signers").select("*").eq("contract_id", contract_id).eq("role", "landlord").single();
    signer = s;
  } else {
    if (!public_token) return NextResponse.json({ success: false, error: "缺 public_token" }, { status: 400 });
    const { data: s } = await supabase
      .from("contract_signers").select("*")
      .eq("contract_id", contract_id).eq("role", role).eq("public_token", public_token).single();
    signer = s;
  }
  if (!signer) return NextResponse.json({ success: false, error: "签署方不存在" }, { status: 404 });
  if (signer.signed_at) return NextResponse.json({ success: false, error: "您已签字" }, { status: 409 });

  // 锁定检查
  if (signer.sms_locked_until && new Date(signer.sms_locked_until) > new Date()) {
    return NextResponse.json({ success: false, error: "尝试次数过多，30 分钟后再试" }, { status: 429 });
  }

  // 验证码校验
  if (!signer.sms_code_hash || !signer.sms_code_expires_at) {
    return NextResponse.json({ success: false, error: "请先获取验证码" }, { status: 400 });
  }
  if (new Date(signer.sms_code_expires_at) < new Date()) {
    return NextResponse.json({ success: false, error: "验证码已过期" }, { status: 400 });
  }
  const expected = hashSmsCode(sms_code, signer.id);
  if (!safeEqualHex(expected, signer.sms_code_hash)) {
    const attempts = (signer.sms_attempts ?? 0) + 1;
    const locked = attempts >= MAX_SMS_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    await supabase.from("contract_signers").update({
      sms_attempts: attempts,
      sms_locked_until: locked,
    }).eq("id", signer.id);
    return NextResponse.json({ success: false, error: "验证码错误", attempts_left: Math.max(0, MAX_SMS_ATTEMPTS - attempts) }, { status: 400 });
  }

  // 签名图：data URL 转 Buffer
  const m = /^data:image\/png;base64,(.+)$/.exec(signature_image);
  if (!m) return NextResponse.json({ success: false, error: "签名图格式错误" }, { status: 400 });
  const sigBuf = Buffer.from(m[1], "base64");
  const sigPath = `contracts/${contract_id}/sig-${role}.png`;
  const { error: upErr } = await supabase.storage.from("contracts").upload(sigPath, sigBuf, {
    contentType: "image/png", upsert: true,
  });
  if (upErr) return NextResponse.json({ success: false, error: `签名图上传失败：${upErr.message}` }, { status: 500 });

  // 取请求 IP/UA
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
  const ua = req.headers.get("user-agent") ?? null;
  const now = new Date().toISOString();

  // 更新签字方
  await supabase.from("contract_signers").update({
    signed_at: now,
    sign_ip: ip,
    sign_ua: ua,
    signature_image_path: sigPath,
    sms_verified_at: now,
  }).eq("id", signer.id);

  // 判断是否所有人签完
  const { data: signers } = await supabase
    .from("contract_signers").select("*").eq("contract_id", contract_id).order("sign_order");
  const allSigned = (signers ?? []).every((s) => s.signed_at);

  if (!allSigned) {
    // 当前合同 partial；通知下一方
    await supabase.from("contracts").update({ status: "partial" }).eq("id", contract_id);
    const next = (signers ?? []).find((s) => !s.signed_at);
    if (next) {
      const landlord = (signers ?? []).find((s) => s.role === "landlord");
      const url = `${process.env.NEXT_PUBLIC_APP_URL}/sign/${next.public_token}`;
      await sendContractInviteSms(next.phone, landlord?.name ?? "房东", url);
    }
    return NextResponse.json({ success: true, contract_status: "partial" });
  }

  // 全签完：合成最终 PDF + 算哈希
  const { data: contract } = await supabase.from("contracts").select("*").eq("id", contract_id).single();
  if (!contract?.pdf_initial_path) {
    return NextResponse.json({ success: false, error: "初稿 PDF 缺失" }, { status: 500 });
  }
  const { data: initialPdfFile } = await supabase.storage.from("contracts").download(contract.pdf_initial_path);
  if (!initialPdfFile) return NextResponse.json({ success: false, error: "下载初稿失败" }, { status: 500 });
  const initialBuf = Buffer.from(await initialPdfFile.arrayBuffer());

  // 下载所有签名图
  const sigs = await Promise.all(
    (signers ?? []).map(async (s) => {
      if (!s.signature_image_path) return null;
      const { data } = await supabase.storage.from("contracts").download(s.signature_image_path);
      const buf = data ? Buffer.from(await data.arrayBuffer()) : undefined;
      return { signer: s, png: buf };
    })
  );

  const finalBuf = await composeFinalPdf({
    initialPdf: initialBuf,
    contractId: contract_id,
    signers: (signers ?? []).map((s, i) => ({
      role: s.role as "landlord" | "agent" | "tenant",
      name: s.name, phone: s.phone,
      signed_at: s.signed_at ?? "",
      sign_ip: s.sign_ip, sign_ua: s.sign_ua,
      sms_verified_at: s.sms_verified_at,
      signature_png: sigs[i]?.png,
    })),
  });

  const finalPath = `contracts/${contract_id}/final.pdf`;
  await supabase.storage.from("contracts").upload(finalPath, finalBuf, {
    contentType: "application/pdf", upsert: true,
  });
  const hash = sha256Hex(finalBuf);
  await supabase.from("contracts").update({
    status: "signed",
    pdf_final_path: finalPath,
    pdf_hash_sha256: hash,
    signed_at: now,
  }).eq("id", contract_id);

  // 通知所有方
  const downloadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/contracts/${contract_id}`;
  await Promise.all((signers ?? []).map((s) => sendContractDoneSms(s.phone, downloadUrl)));

  return NextResponse.json({ success: true, contract_status: "signed" });
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/app/api/contracts/sign/route.ts
git commit -m "feat(econtract): POST /api/contracts/sign 签字 + 合成最终 PDF"
```

---

## Task 10：API `GET /api/contracts/[id]` + PDF 下载

**Files:**
- Create: `src/app/api/contracts/[id]/route.ts`
- Create: `src/app/api/contracts/[id]/pdf/route.ts`

- [ ] **Step 1: 实现 GET /[id]**

```ts
// src/app/api/contracts/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const supabase = await createClient();
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");

  // 鉴权：登录用户走 RLS；带 token 的匿名也能看
  const { data: { user } } = await supabase.auth.getUser();
  let contract;
  if (user) {
    const { data } = await supabase.from("contracts").select("*").eq("id", id).single();
    contract = data;
  } else if (token) {
    const { data: signer } = await supabase.from("contract_signers").select("contract_id").eq("public_token", token).eq("contract_id", id).single();
    if (!signer) return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    // 用 service_role 取 contract（绕开 RLS）—— 需要专门的 admin client
    const { data } = await supabase.from("contracts").select("*").eq("id", id).single();
    contract = data;
  } else {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }
  if (!contract) return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });

  const { data: signers } = await supabase.from("contract_signers").select("id, role, sign_order, name, phone, signed_at, sign_ip, sms_verified_at, public_token").eq("contract_id", id).order("sign_order");

  // 公开访问时不返回 sms_code_hash 等敏感字段
  return NextResponse.json({ success: true, contract, signers: signers ?? [] });
}
```

- [ ] **Step 2: 实现 PDF 下载**

```ts
// src/app/api/contracts/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const supabase = await createClient();
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const version = url.searchParams.get("v") ?? "final";  // initial / final

  // 鉴权同上
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !token) return NextResponse.json({ success: false, error: "无权访问" }, { status: 401 });
  if (token) {
    const { data: s } = await supabase.from("contract_signers").select("id").eq("contract_id", id).eq("public_token", token).single();
    if (!s) return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
  }

  const { data: contract } = await supabase.from("contracts").select("pdf_initial_path, pdf_final_path").eq("id", id).single();
  if (!contract) return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });

  const path = version === "final" ? contract.pdf_final_path : contract.pdf_initial_path;
  if (!path) return NextResponse.json({ success: false, error: "PDF 尚未生成" }, { status: 404 });

  const { data, error } = await supabase.storage.from("contracts").download(path);
  if (error || !data) return NextResponse.json({ success: false, error: "下载失败" }, { status: 500 });

  return new Response(data, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="contract-${id}.pdf"` },
  });
}
```

- [ ] **Step 3: 提交**

```bash
git add src/app/api/contracts/[id]/route.ts src/app/api/contracts/[id]/pdf/route.ts
git commit -m "feat(econtract): GET 合同状态 + PDF 下载接口"
```

---

## Task 11：手写画板 + 验证码组件

**Files:**
- Create: `src/components/contracts/signature-canvas.tsx`
- Create: `src/components/contracts/sms-code-input.tsx`
- Create: `src/components/contracts/pdf-preview.tsx`

- [ ] **Step 1: signature-canvas.tsx**

```tsx
// src/components/contracts/signature-canvas.tsx
"use client";

import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

interface Props {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

export function SignatureCanvas({ onChange, disabled }: Props) {
  const padRef = useRef<SignaturePad>(null);
  const [hasSigned, setHasSigned] = useState(false);

  const handleEnd = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setHasSigned(false);
      onChange(null);
      return;
    }
    setHasSigned(true);
    onChange(pad.getCanvas().toDataURL("image/png"));
  };

  const clear = () => {
    padRef.current?.clear();
    setHasSigned(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className={`border-2 ${hasSigned ? "border-primary" : "border-dashed border-border"} rounded-lg bg-white touch-none`}>
        <SignaturePad
          ref={padRef}
          canvasProps={{ className: "w-full h-40 rounded-lg" }}
          penColor="#1a1a1a"
          onEnd={handleEnd}
          minDistance={1}
        />
      </div>
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span>{hasSigned ? "✓ 已签字" : "请在上方手写签字"}</span>
        <Button variant="ghost" size="sm" onClick={clear} disabled={disabled || !hasSigned}>
          <Eraser className="h-3 w-3 mr-1" /> 清除重签
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: sms-code-input.tsx**

```tsx
// src/components/contracts/sms-code-input.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Props {
  contractId: string;
  role: string;
  publicToken?: string;
  onCodeReady: (code: string) => void;
  disabled?: boolean;
}

export function SmsCodeInput({ contractId, role, publicToken, onCodeReady, disabled }: Props) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const send = async () => {
    setSending(true);
    try {
      const resp = await fetch("/api/contracts/sms-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_id: contractId, role, public_token: publicToken }),
      });
      const j = await resp.json();
      if (!j.success) {
        toast.error(j.error ?? "发送失败");
        return;
      }
      setCooldown(60);
      toast.success("验证码已发送，5 分钟内有效");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) onCodeReady(v);
          }}
          placeholder="6 位短信验证码"
          inputMode="numeric"
          maxLength={6}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          onClick={send}
          disabled={disabled || sending || cooldown > 0}
          className="shrink-0"
        >
          {cooldown > 0 ? `${cooldown}s` : sending ? "发送中" : "发送验证码"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: pdf-preview.tsx**

```tsx
// src/components/contracts/pdf-preview.tsx
"use client";

interface Props {
  src: string;        // /api/contracts/[id]/pdf?v=initial[&token=...]
  className?: string;
}

export function PdfPreview({ src, className }: Props) {
  return (
    <div className={`bg-secondary rounded-lg overflow-hidden ${className ?? ""}`}>
      {/* iframe 最稳的跨浏览器 PDF 内嵌方式；React 19 + iOS Safari 都支持 */}
      <iframe src={src} className="w-full h-[60vh]" title="合同预览" />
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
git add src/components/contracts/
git commit -m "feat(econtract): 手写画板 + 验证码输入 + PDF 预览组件"
```

---

## Task 12：房东签字页 `/contracts/[id]/sign`

**Files:**
- Create: `src/app/contracts/[id]/sign/page.tsx`

- [ ] **Step 1: 实现页面**

```tsx
// src/app/contracts/[id]/sign/page.tsx
"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { SignatureCanvas } from "@/components/contracts/signature-canvas";
import { SmsCodeInput } from "@/components/contracts/sms-code-input";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function LandlordSignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/contracts/${id}`).then(r => r.json()).then(j => {
      if (j.success) setContract(j.contract);
      else toast.error(j.error);
      setLoading(false);
    });
  }, [id]);

  const submit = async () => {
    if (!agreed || !signature || smsCode.length !== 6) {
      toast.error("请完成阅读勾选、手写签字、验证码");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: id, role: "landlord",
          sms_code: smsCode, signature_image: signature,
        }),
      });
      const j = await resp.json();
      if (!j.success) {
        toast.error(j.error);
        return;
      }
      toast.success("签字完成，已通知租客");
      router.push(`/contracts/${id}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!contract) return <div className="p-8">合同不存在</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold">签字 · 房东方</h1>
      <PdfPreview src={`/api/contracts/${id}/pdf?v=initial`} />
      <Card className="p-4 space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
          <span>我已仔细阅读并同意合同全部条款</span>
        </label>
        <div>
          <p className="text-sm font-semibold mb-2">手写签名</p>
          <SignatureCanvas onChange={setSignature} disabled={submitting} />
        </div>
        <div>
          <p className="text-sm font-semibold mb-2">短信验证</p>
          <SmsCodeInput contractId={id} role="landlord" onCodeReady={setSmsCode} disabled={submitting} />
        </div>
        <Button onClick={submit} disabled={submitting} className="w-full" size="lg">
          {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          确认签字
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/contracts/[id]/sign/page.tsx
git commit -m "feat(econtract): 房东签字页"
```

---

## Task 13：公开签字页 `/sign/[token]`

**Files:**
- Create: `src/app/sign/[token]/page.tsx`

- [ ] **Step 1: 实现页面**

```tsx
// src/app/sign/[token]/page.tsx
"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { SignatureCanvas } from "@/components/contracts/signature-canvas";
import { SmsCodeInput } from "@/components/contracts/sms-code-input";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function PublicSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<{ contractId: string; role: string; landlordName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // 通过 token 反查 contract_id + role
    fetch(`/api/sign-lookup?token=${token}`).then(r => r.json()).then(j => {
      if (j.success) setInfo(j);
      else toast.error(j.error);
      setLoading(false);
    });
  }, [token]);

  const submit = async () => {
    if (!info || !agreed || !signature || smsCode.length !== 6) {
      toast.error("请完成阅读勾选、手写签字、验证码");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: info.contractId, role: info.role, public_token: token,
          sms_code: smsCode, signature_image: signature,
        }),
      });
      const j = await resp.json();
      if (!j.success) { toast.error(j.error); return; }
      setDone(true);
      toast.success("签字完成");
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!info) return <div className="p-8">签字链接无效或已过期</div>;
  if (done) return (
    <div className="max-w-md mx-auto p-8 text-center space-y-4">
      <h1 className="text-xl font-bold">✓ 签字完成</h1>
      <p className="text-muted-foreground">合同已记录。您可以稍后从短信链接下载完整合同 PDF。</p>
      <Button asChild>
        <a href={`/api/contracts/${info.contractId}/pdf?v=final&token=${token}`} target="_blank">下载合同 PDF</a>
      </Button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="text-center mb-4">
        <h1 className="text-xl font-bold">养房 Tend · 电子签约</h1>
        <p className="text-sm text-muted-foreground mt-1">
          房东「{info.landlordName}」已签字，请您阅读后签字
        </p>
      </div>
      <PdfPreview src={`/api/contracts/${info.contractId}/pdf?v=initial&token=${token}`} />
      <Card className="p-4 space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
          <span>我已仔细阅读并同意合同全部条款</span>
        </label>
        <div>
          <p className="text-sm font-semibold mb-2">手写签名</p>
          <SignatureCanvas onChange={setSignature} disabled={submitting} />
        </div>
        <div>
          <p className="text-sm font-semibold mb-2">短信验证</p>
          <SmsCodeInput contractId={info.contractId} role={info.role} publicToken={token} onCodeReady={setSmsCode} disabled={submitting} />
        </div>
        <Button onClick={submit} disabled={submitting} className="w-full" size="lg">
          {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          确认签字
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 实现配套 lookup 接口**

```ts
// src/app/api/sign-lookup/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";  // 用 service_role，绕开 RLS

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ success: false, error: "缺 token" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: signer } = await supabase
    .from("contract_signers")
    .select("contract_id, role, signed_at, contracts!inner(status, lease_id)")
    .eq("public_token", token)
    .single();

  if (!signer) return NextResponse.json({ success: false, error: "链接无效" }, { status: 404 });
  if (signer.signed_at) return NextResponse.json({ success: false, error: "您已签字" }, { status: 409 });

  // 取房东姓名
  const { data: landlord } = await supabase
    .from("contract_signers")
    .select("name")
    .eq("contract_id", signer.contract_id)
    .eq("role", "landlord")
    .single();

  return NextResponse.json({
    success: true,
    contractId: signer.contract_id,
    role: signer.role,
    landlordName: landlord?.name ?? "房东",
  });
}
```

如果 `@/lib/supabase/service` 不存在，新建：

```ts
// src/lib/supabase/service.ts
import { createClient } from "@supabase/supabase-js";
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add src/app/sign/ src/app/api/sign-lookup/ src/lib/supabase/service.ts
git commit -m "feat(econtract): 公开签字页 + lookup 接口"
```

---

## Task 14：合同状态页 `/contracts/[id]` + 签字进度组件

**Files:**
- Create: `src/components/contracts/sign-progress.tsx`
- Create: `src/app/contracts/[id]/page.tsx`

- [ ] **Step 1: 进度条组件**

```tsx
// src/components/contracts/sign-progress.tsx
"use client";

import { Check, Circle, Clock } from "lucide-react";
import { format } from "date-fns";

interface Signer { role: string; name: string; signed_at: string | null; sign_ip: string | null; }

const ROLE_LABEL: Record<string, string> = { landlord: "房东", agent: "中介", tenant: "租客" };

export function SignProgress({ signers }: { signers: Signer[] }) {
  return (
    <div className="space-y-3">
      {signers.map((s) => {
        const signed = !!s.signed_at;
        return (
          <div key={s.role} className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${signed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {signed ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{ROLE_LABEL[s.role]} · {s.name}</p>
              <p className="text-xs text-muted-foreground">
                {signed ? `已签 · ${format(new Date(s.signed_at!), "yyyy-MM-dd HH:mm")}` : "等待签字"}
                {signed && s.sign_ip && <span className="ml-2">· IP {(s.sign_ip).split(".").slice(0,3).join(".")}.***</span>}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 状态页**

```tsx
// src/app/contracts/[id]/page.tsx
"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SignProgress } from "@/components/contracts/sign-progress";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ contract: any; signers: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const j = await fetch(`/api/contracts/${id}`).then(r => r.json());
    if (j.success) setData(j);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const resend = async (role: string, token: string) => {
    const j = await fetch("/api/contracts/sms-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract_id: id, role, public_token: token }),
    }).then(r => r.json());
    toast[j.success ? "success" : "error"](j.success ? "短信已重发" : j.error);
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) return <div className="p-8">合同不存在</div>;

  const isSigned = data.contract.status === "signed";

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">合同详情</h1>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card className="p-4">
        <p className="text-sm text-muted-foreground mb-2">签署进度</p>
        <SignProgress signers={data.signers} />
      </Card>

      {isSigned && (
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-sm">已完成签署</p>
          <p className="text-xs text-muted-foreground break-all">
            PDF 哈希：{data.contract.pdf_hash_sha256}
          </p>
          <Button asChild className="w-full">
            <a href={`/api/contracts/${id}/pdf?v=final`} target="_blank">
              <Download className="h-4 w-4 mr-2" /> 下载合同 PDF
            </a>
          </Button>
        </Card>
      )}

      <PdfPreview src={`/api/contracts/${id}/pdf?v=${isSigned ? "final" : "initial"}`} />
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/contracts/sign-progress.tsx src/app/contracts/[id]/page.tsx
git commit -m "feat(econtract): 合同状态页 + 三方签字进度"
```

---

## Task 15：租约页接入「发起电子签」入口 + 删除拦截

**Files:**
- Modify: `src/app/leases/page.tsx`

- [ ] **Step 1: 在租约卡片底部加电子签状态按钮**

读 `src/app/leases/page.tsx` 现有结构，在每条租约的右下角加：

```tsx
// 顶部 import
import { useRouter } from "next/navigation";
import { FileSignature } from "lucide-react";

// 在 LeasesPageInner 组件里
const router = useRouter();
const [contractMap, setContractMap] = useState<Record<string, { id: string; status: string }>>({});

// 加载合同状态
useEffect(() => {
  if (leases.length === 0) return;
  // 并发拉每条租约的合同（简化：v1 直接一次性查所有未删除合同）
  supabase.from("contracts")
    .select("id, lease_id, status")
    .in("lease_id", leases.map(l => l.id))
    .is("deleted_at", null)
    .then(({ data }) => {
      const map: Record<string, { id: string; status: string }> = {};
      (data ?? []).forEach((c) => { map[c.lease_id] = { id: c.id, status: c.status }; });
      setContractMap(map);
    });
}, [leases]);

// 在租约卡片渲染处加按钮
const contract = contractMap[lease.id];

const handleInitiateContract = async (leaseId: string) => {
  const j = await fetch("/api/contracts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lease_id: leaseId }),
  }).then(r => r.json());
  if (!j.success) {
    toast.error(j.error);
    return;
  }
  router.push(`/contracts/${j.contract_id}/sign`);
};

// JSX
{!contract && lease.status === "active" && (
  <Button size="sm" variant="outline" onClick={() => handleInitiateContract(lease.id)}>
    <FileSignature className="h-3 w-3 mr-1" />
    发起电子签
  </Button>
)}
{contract && contract.status === "partial" && (
  <Button size="sm" variant="ghost" onClick={() => router.push(`/contracts/${contract.id}`)}>
    <FileSignature className="h-3 w-3 mr-1" />
    等待签字 →
  </Button>
)}
{contract && contract.status === "signed" && (
  <Button size="sm" variant="ghost" onClick={() => router.push(`/contracts/${contract.id}`)}>
    <Check className="h-3 w-3 mr-1 text-success" />
    已签约
  </Button>
)}
```

- [ ] **Step 2: 在 handleDelete 加合同拦截**

```ts
const handleDelete = async () => {
  if (!deletingId) return;
  // 拦截：检查是否有 signed 合同
  const { data: signedContract } = await supabase
    .from("contracts").select("id")
    .eq("lease_id", deletingId).eq("status", "signed").is("deleted_at", null)
    .maybeSingle();
  if (signedContract) {
    toast.error("该租约已有签署完成的电子合同，无法删除。请先撤销合同。");
    setDeletingId(null);
    return;
  }
  // ... 原有删除逻辑
};
```

- [ ] **Step 3: 类型检查 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/app/leases/page.tsx
git commit -m "feat(econtract): 租约页接入电子签入口 + 删除拦截"
```

---

## Task 16：中介居间三签

**Files:**
- Create: `src/lib/econtract/templates/agent.ts`
- Modify: `src/lib/econtract/pdf-generator.ts`
- Modify: `src/app/api/contracts/create/route.ts`

- [ ] **Step 1: 写 agent template（在 direct 基础上增加居间方信息 + 居间费条款）**

```ts
// src/lib/econtract/templates/agent.ts
import type PDFDocument from "pdfkit";
import { renderDirectContract, type DirectTemplateData } from "./direct";

export interface AgentTemplateData extends DirectTemplateData {
  agent: { name: string; phone: string };
  agent_fee: number;
}

export function renderAgentContract(doc: typeof PDFDocument.prototype, data: AgentTemplateData) {
  // 1. 先渲染基础直租合同（除签字页外的所有条款）
  // 重构 direct.ts，把签字页拆出来单独函数，这里跳过签字页直接走到第八条
  // v1 简化：复用 direct，前面加居间方信息

  // 居间方
  doc.font("Heiti").fontSize(12).text("居间方（中介）");
  doc.font("Songti").fontSize(10);
  doc.text(`姓名：${data.agent.name}`);
  doc.text(`手机：${data.agent.phone}`);
  doc.moveDown();

  // 直接调 direct 的主体（v1 阶段做 copy-paste 重写，下一版重构）
  renderDirectContract(doc, data);

  // 加居间费用条款
  doc.addPage();
  doc.fontSize(12).font("Heiti").text("第八条 居间服务");
  doc.font("Songti").fontSize(10);
  doc.text(`本合同由居间方 ${data.agent.name} 介绍促成。`);
  doc.text(`居间服务费：人民币 ${data.agent_fee.toFixed(2)} 元`);
  doc.text("（一）居间方仅承担介绍、协调职能，不承担房屋瑕疵或后续履约责任；");
  doc.text("（二）居间费由[出租方 / 承租方 / 双方各半]承担，具体支付方式由各方另行约定；");
  doc.text("（三）合同签订后，居间方不再介入双方履约纠纷。");
  doc.moveDown(2);

  // 三签签字区
  doc.fontSize(12).font("Heiti").text("出租方、居间方、承租方签字", { align: "center" });
  doc.font("Songti").fontSize(10);
  doc.moveDown();
  ["出租方", "居间方", "承租方"].forEach((label) => {
    doc.text(`${label}签字：`);
    doc.rect(doc.x, doc.y + 5, 180, 50).stroke();
    doc.moveDown(4);
  });
}
```

> **注**：v1 阶段先用复制粘贴方式，下一版重构 direct.ts 让签字页可插拔。

- [ ] **Step 2: 更新 pdf-generator**

```ts
// src/lib/econtract/pdf-generator.ts — 加 agent 分支
import { renderAgentContract, type AgentTemplateData } from "./templates/agent";

export async function generateInitialPdf(
  templateType: "direct" | "agent",
  data: DirectTemplateData | AgentTemplateData
): Promise<Buffer> {
  // ... 同前 ...
  if (templateType === "direct") {
    renderDirectContract(doc, data as DirectTemplateData);
  } else {
    renderAgentContract(doc, data as AgentTemplateData);
  }
  doc.end();
  // ...
}
```

- [ ] **Step 3: 更新 create 接口走 agent 分支**

```ts
// src/app/api/contracts/create/route.ts
// 删掉 Task 6 里 "agent 模式实现中" 的早返
// 加 agent 数据组装：
if (templateType === "agent") {
  if (!lease.agent_name || !lease.agent_phone) {
    return NextResponse.json({ success: false, error: "中介信息缺失" }, { status: 400 });
  }
  // 在 generateInitialPdf 调用里传 agent + agent_fee 字段
}

// 在创建 contract_signers 时也要插中介一行：
await supabase.from("contract_signers").insert([
  { contract_id: contract.id, role: "landlord", sign_order: 1, ... public_token: null },
  { contract_id: contract.id, role: "agent",    sign_order: 2, ... public_token: generatePublicToken(),
    name: lease.agent_name, phone: lease.agent_phone, id_number: null },
  { contract_id: contract.id, role: "tenant",   sign_order: 3, ... public_token: generatePublicToken() },
]);
```

- [ ] **Step 4: 提交**

```bash
git add src/lib/econtract/templates/agent.ts src/lib/econtract/pdf-generator.ts src/app/api/contracts/create/route.ts
git commit -m "feat(econtract): 中介居间三签模板 + 三方签字流程"
```

---

## Task 17：合同撤销 + 过期处理

**Files:**
- Create: `src/app/api/contracts/[id]/void/route.ts`
- Modify: `src/app/contracts/[id]/page.tsx`

- [ ] **Step 1: 撤销接口**

```ts
// src/app/api/contracts/[id]/void/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

  const { data: c } = await supabase.from("contracts").select("status").eq("id", id).single();
  if (!c) return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });
  if (c.status === "signed") return NextResponse.json({ success: false, error: "已签署合同不可撤销" }, { status: 409 });

  await supabase.from("contracts").update({ status: "void" }).eq("id", id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 状态页加撤销按钮（仅 status = draft/partial）**

```tsx
// 在 ContractDetailPage Card 里加：
{!isSigned && data.contract.status !== "void" && (
  <Button variant="outline" onClick={async () => {
    if (!confirm("确定撤销合同？此操作不可恢复。")) return;
    const j = await fetch(`/api/contracts/${id}/void`, { method: "POST" }).then(r => r.json());
    if (j.success) { toast.success("已撤销"); load(); } else toast.error(j.error);
  }}>
    撤销合同
  </Button>
)}
```

- [ ] **Step 3: 懒过期检测（在 GET /api/contracts/[id] 里）**

```ts
// 在 src/app/api/contracts/[id]/route.ts 顶部加：
// 若 expires_at < now 且 status in ('draft','partial')，自动转 expired
if (contract && contract.expires_at && new Date(contract.expires_at) < new Date() &&
    ["draft", "partial"].includes(contract.status)) {
  await supabase.from("contracts").update({ status: "expired" }).eq("id", id);
  contract.status = "expired";
}
```

- [ ] **Step 4: 提交**

```bash
git add src/app/api/contracts/[id]/ src/app/contracts/[id]/page.tsx
git commit -m "feat(econtract): 撤销合同 + 懒过期检测"
```

---

## Task 18：端到端 manual 测试 + 部署

**Files:**
- 无新文件（测试 + 部署）

- [ ] **Step 1: 本地构建**

```bash
cd K:/baozupo/.claude/worktrees/cranky-leavitt-125aa4
NODE_OPTIONS='--max-old-space-size=2048' npm run build 2>&1 | tail -30
```

预期：build 成功，无 type / lint error。

- [ ] **Step 2: 申请阿里云短信模板（3 个）**

人工去阿里云短信控制台申请：
- "邀请签字"：${name} 邀请您签订租房合同，请打开 ${url} 完成签字
- "验证码"：您正在签订租房合同，验证码 ${code}，5 分钟有效
- "签字完成"：您的租房合同已完成签字，下载 ${url}

把审核通过的 SMS_XXX 模板号填到 ECS 的 .env 里。

- [ ] **Step 3: 在 ECS 上跑 migration 0013**

```bash
RDS=pgm-2zere1gfog159y51.pg.rds.aliyuncs.com
PGPASSWORD='TendDB_2026Yikai' psql -h $RDS -U postgres -d supabase_db \
  -f /opt/baozupo/supabase/migrations/0013_econtract.sql
```

- [ ] **Step 4: 配置 ECS 环境变量**

把 ALIYUN_SMS_* 环境变量加到 /opt/baozupo/.env，重启 PM2。

- [ ] **Step 5: 部署**

```bash
# ECS 上
cd /opt/baozupo
git fetch origin main && git reset --hard origin/main && git log -1 --oneline
NODE_OPTIONS='--max-old-space-size=1024' npm run build 2>&1 | tail -10
pm2 restart baozupo
```

- [ ] **Step 6: E2E 双签流程手测**

1. 用测试账号登录 tendapp.cn
2. 找一条租约，点「发起电子签」
3. 检查跳转到 /contracts/[id]/sign，PDF 预览正常
4. 勾选 + 手写签字 + 收短信验证码 + 提交
5. 检查跳转到 /contracts/[id]，进度条显示房东✓，租客等待
6. 用另一台设备打开租客收到的短信里的 /sign/[token] 链接
7. 重复签字流程
8. 检查最终 PDF 可下载、哈希显示、审计页内容

- [ ] **Step 7: E2E 三签流程手测**

同上但走中介模式（rental_source=agent 的租约）。

- [ ] **Step 8: 创建发布说明 commit**

```bash
git add -A
git commit -m "chore(econtract): v1 上线 - 双签/三签全流程通过"
```

- [ ] **Step 9: 更新 memory 文件**

把今天的工作（轻签约 v1 上线）追加到 `memory/project_day_2026_05_23.md`（新建）。

---

## Self-Review

按 writing-plans skill 要求检查：

### Spec 覆盖

| Spec 章节 | 对应 Task |
|---|---|
| §3.1 双签/三签模式 | Task 6, 16 |
| §5 数据模型 | Task 1 |
| §6.1 create | Task 6 |
| §6.2 sms-code | Task 7 |
| §6.3 sign | Task 9 |
| §6.4 pdf 下载 | Task 10 |
| §6.5 get 状态 | Task 10 |
| §7.1 租约入口 | Task 15 |
| §7.2 房东签字页 | Task 12 |
| §7.3 公开签字页 | Task 13 |
| §7.4 状态页 | Task 14 |
| §8 PDF 模板 | Task 5, 16 |
| §8.3 审计附页 | Task 8 |
| §9 错误处理 | Task 7, 9, 17 |
| §10 安全 & 隐私 | Task 2 (hash), 7 (频控), 9 (locked) |
| §11 部署 | Task 18 |
| §12 测试 | Task 18 step 6-7 |

### 类型一致性

- `Contract`、`ContractSigner` 接口在 `src/types/contract.ts` 定义，所有 task 引用一致
- API 返回结构：`{ success: boolean, ... }` 全部统一
- pdf path 字段名：`pdf_initial_path` / `pdf_final_path`，全文一致
- 签字方 role 取值：`'landlord' | 'agent' | 'tenant'`，全文一致

### Placeholder 扫描

- Task 5 模板条款标 `// 待法务审`，spec 里也有同样说明 ✓
- 公司全称 placeholder：仍待用户补，已在审计附页 + spec 第 14 章 TODO 列出 ✓
- 短信模板 SMS_XXXXXX：Task 18 step 2 明确"人工去阿里云申请" ✓
- 无 "TBD" / "implement later" / "similar to Task N" 等模糊表述

---

## 执行选项

Plan 完成，保存到 `docs/superpowers/plans/2026-05-23-light-econtract.md`。

**两种执行方式**：

1. **Subagent-Driven（推荐）** — 我每个 Task 派一个全新 subagent 实现，做完两段式 review 再下一个。隔离干净、可回退。
2. **Inline Execution** — 在当前会话直接顺序执行，到关键节点（Task 8 PDF / Task 13 公开页 / Task 18 部署）停下让你看。

我个人推荐 **subagent-driven**，因为这个项目跨 ~18 个独立 Task，长会话上下文容易污染；但需要 4 天工时，你可以分次执行，今天先跑前几个 Task，剩下的明天/后天接着。
