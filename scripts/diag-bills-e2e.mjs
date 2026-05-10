import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateBillPeriods } from "../src/lib/billing.ts";
import { format } from "date-fns";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const TEST_EMAIL = `bill-${Date.now()}@x.com`;
const { data: s, error: signErr } = await sb.auth.signUp({ email: TEST_EMAIL, password: "abc12345" });
if (signErr) { console.error(signErr); process.exit(1); }
const userId = s.user.id;

// ensureHousehold
const { data: hh } = await sb.from("households").insert({ name: "测试组", owner_id: userId }).select("id").single();
await sb.from("household_members").insert({ household_id: hh.id, user_id: userId, role: "owner" });
const propResp = await sb.from("properties").insert({ household_id: hh.id, name: "测试房1", address: "测试路1号", status: "vacant" }).select("id").single();
console.log("properties insert:", propResp);
const prop = propResp.data;
const tenResp = await sb.from("tenants").insert({ household_id: hh.id, name: "张三", phone: "13800138000" }).select("id").single();
console.log("tenants insert:", tenResp);
const ten = tenResp.data;

console.log(`✓ 准备完成 household=${hh.id} property=${prop.id} tenant=${ten.id}\n`);

// 1. 创建租约（3-6月）
const leasePayload = {
  household_id: hh.id,
  property_id: prop.id,
  start_date: "2026-03-15",
  end_date: "2026-06-15",
  monthly_rent: 5000,
  deposit: 10000,
  payment_cycle: "monthly",
  rent_due_day: 1,
  billing_mode: "natural_month",
  status: "active",
};
const { data: lease, error: leaseErr } = await sb.from("leases").insert(leasePayload).select().single();
if (leaseErr) { console.error("✗ 租约创建失败:", leaseErr); process.exit(1); }
console.log(`✓ 租约创建 id=${lease.id}\n`);

// 2. 关联租客
const { error: lt } = await sb.from("lease_tenants").insert({ lease_id: lease.id, tenant_id: ten.id, is_primary: true });
if (lt) { console.error("✗ lease_tenants:", lt); }

// 3. 生成账单
const periods = generateBillPeriods(new Date("2026-03-15"), new Date("2026-06-15"), 5000, "natural_month", 1);
console.log(`算法生成 ${periods.length} 期\n`);

const billRows = periods.map((p) => ({
  lease_id: lease.id,
  period_start: format(p.periodStart, "yyyy-MM-dd"),
  period_end: format(p.periodEnd, "yyyy-MM-dd"),
  days_in_period: p.daysInPeriod,
  ratio: p.ratio,
  due_date: format(p.dueDate, "yyyy-MM-dd"),
  rent_amount: p.rentAmount,
  utility_amount: 0,
  other_amount: 0,
  total_amount: p.rentAmount,
  paid_amount: 0,
  status: "pending",
}));

console.log("准备插入的账单数据：");
console.dir(billRows, { depth: null });

const { data: insertedBills, error: billsErr } = await sb.from("bills").insert(billRows).select();
if (billsErr) {
  console.error("\n✗ 账单批量插入失败！原因：", billsErr);
} else {
  console.log(`\n✓ 成功插入 ${insertedBills.length} 期账单`);
}

// 4. 反查 bills
const { data: queryBills } = await sb.from("bills").select("*").eq("lease_id", lease.id).order("due_date");
console.log(`\n反查到 ${queryBills?.length ?? 0} 期账单：`);
queryBills?.forEach((b) => {
  console.log(`  ${b.period_start} → ${b.period_end} | 应收 ${b.total_amount} | 状态 ${b.status} | 到期 ${b.due_date}`);
});
