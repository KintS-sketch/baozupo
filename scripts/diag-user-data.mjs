/**
 * 诊断某个邮箱用户的数据状态
 *
 * 用法：node scripts/diag-user-data.mjs <email>
 * 例：  node scripts/diag-user-data.mjs 119559402@qq.com
 *
 * 输出：该用户的 households / properties / tenants / leases / bills 数量
 * 用 SUPABASE_SERVICE_ROLE_KEY 绕过 RLS，看真实数据库状态
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// 简单加载 .env.production（避免依赖 dotenv）
try {
  const env = readFileSync(".env.production", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) {
  console.error("⚠️  无法读 .env.production:", e.message);
}

const email = process.argv[2];
if (!email) {
  console.error("用法: node scripts/diag-user-data.mjs <email>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log(`\n🔍 查 ${email} 的数据状态\n`);

// 1. 找用户
let target = null;
for (let page = 1; page <= 20; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
  if (error) {
    console.error("❌ list users 失败:", error.message);
    process.exit(1);
  }
  target = data.users.find((u) => u.email === email);
  if (target) break;
  if (data.users.length < 100) break;
}

console.log("=== User ===");
if (!target) {
  console.log("❌ Supabase auth.users 里没这个邮箱");
  console.log("可能原因: 1) 邮箱拼错; 2) 注册流程没成功; 3) 用户用了别的邮箱注册");
  process.exit(0);
}
console.log("id:                ", target.id);
console.log("email:             ", target.email);
console.log("created_at:        ", target.created_at);
console.log("email_confirmed_at:", target.email_confirmed_at || "(未确认)");
console.log("last_sign_in_at:   ", target.last_sign_in_at);

// 2. 找该用户的 household（既查 owner 也查 member）
console.log("\n=== Households ===");
const { data: ownerHh } = await supabase
  .from("households")
  .select("id,name,owner_id,created_at")
  .eq("owner_id", target.id);
console.log(`作为 owner: ${ownerHh?.length || 0} 个`);
ownerHh?.forEach((h) =>
  console.log(`  - ${h.id} | ${h.name} | 创建于 ${h.created_at}`)
);

const { data: memberHh } = await supabase
  .from("household_members")
  .select("household_id,role,created_at")
  .eq("user_id", target.id);
console.log(`作为 member: ${memberHh?.length || 0} 个`);
memberHh?.forEach((m) =>
  console.log(`  - household_id=${m.household_id} | role=${m.role} | ${m.created_at}`)
);

const allHhIds = [
  ...(ownerHh?.map((h) => h.id) || []),
  ...(memberHh?.map((m) => m.household_id) || []),
];

if (allHhIds.length === 0) {
  console.log("\n⚠️  这个用户从未关联任何 household");
  console.log("    → 用户注册后 onboarding 没创建 household");
  console.log("    → 添加房源/租客等操作都会失败（因为没 household_id）");
  process.exit(0);
}

// 3. 查每张表
const tables = ["properties", "tenants", "leases", "bills", "meter_readings", "payments"];
console.log("\n=== 各表数据量（service_role 绕过 RLS）===");
for (const t of tables) {
  const { data, error } = await supabase
    .from(t)
    .select("id,created_at")
    .in("household_id", allHhIds)
    .order("created_at", { ascending: false });
  if (error) {
    console.log(`  ${t}: ❌ ${error.message}`);
    continue;
  }
  const count = data?.length || 0;
  const newest = data?.[0]?.created_at || "-";
  const oldest = data?.[data.length - 1]?.created_at || "-";
  console.log(
    `  ${t.padEnd(16)} ${String(count).padStart(3)} 条  最新=${newest}  最早=${oldest}`
  );
}

console.log("\n✅ 诊断完毕");
