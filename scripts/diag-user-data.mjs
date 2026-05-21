/**
 * 诊断某个邮箱用户的数据状态
 *
 * 用法：node scripts/diag-user-data.mjs <email>
 * 例：  node scripts/diag-user-data.mjs 119559402@qq.com
 *
 * 用 fetch 直接调 Supabase REST API（绕过 SDK 的 WebSocket 依赖），
 * 用 SUPABASE_SERVICE_ROLE_KEY 绕过 RLS 看真实数据库状态。
 */

import { readFileSync } from "fs";

// 加载 .env.production
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ 环境变量没拿到 SUPABASE URL/SERVICE_ROLE_KEY");
  process.exit(1);
}

async function sb(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText} | ${path}\n${text.slice(0, 300)}`);
  }
  return res.json();
}

console.log(`\n🔍 查 ${email} 的数据状态\n`);

// 1. 找用户
let target = null;
for (let page = 1; page <= 20; page++) {
  const data = await sb(`/auth/v1/admin/users?page=${page}&per_page=100`);
  target = data.users.find((u) => u.email === email);
  if (target) break;
  if (!data.users || data.users.length < 100) break;
}

console.log("=== User ===");
if (!target) {
  console.log("❌ Supabase auth.users 里没这个邮箱");
  console.log("可能原因: 1) 邮箱拼错; 2) 注册没成功; 3) 用了别的邮箱");
  process.exit(0);
}
console.log("id:                ", target.id);
console.log("email:             ", target.email);
console.log("created_at:        ", target.created_at);
console.log("email_confirmed_at:", target.email_confirmed_at || "(未确认)");
console.log("last_sign_in_at:   ", target.last_sign_in_at);

// 2. 查 households（owner + member 双重）
console.log("\n=== Households ===");
const ownerHh = await sb(
  `/rest/v1/households?select=id,name,owner_id,created_at&owner_id=eq.${target.id}&order=created_at.desc`
);
console.log(`作为 owner: ${ownerHh.length} 个`);
ownerHh.forEach((h) => console.log(`  - ${h.id} | ${h.name} | ${h.created_at}`));

let memberHh = [];
try {
  memberHh = await sb(
    `/rest/v1/household_members?select=household_id,role,created_at&user_id=eq.${target.id}`
  );
  console.log(`作为 member: ${memberHh.length} 个`);
  memberHh.forEach((m) =>
    console.log(`  - household_id=${m.household_id} | role=${m.role} | ${m.created_at}`)
  );
} catch (e) {
  console.log(`查 household_members 失败: ${e.message}`);
}

const allHhIds = [
  ...ownerHh.map((h) => h.id),
  ...memberHh.map((m) => m.household_id),
];

if (allHhIds.length === 0) {
  console.log("\n⚠️  这个用户从未关联任何 household");
  console.log("    → 注册后 onboarding 没创建 household");
  console.log("    → 添加房源/租客等操作都会失败（缺 household_id）");
  process.exit(0);
}

// 3. 查每张表
const hhFilter = `household_id=in.(${allHhIds.join(",")})`;
const tables = ["properties", "tenants", "leases", "bills", "meter_readings", "payments"];
console.log("\n=== 各表数据量（service_role 绕过 RLS）===");
for (const t of tables) {
  try {
    const data = await sb(
      `/rest/v1/${t}?select=id,created_at&${hhFilter}&order=created_at.desc&limit=200`
    );
    const count = data.length;
    const newest = data[0]?.created_at || "-";
    const oldest = data[data.length - 1]?.created_at || "-";
    console.log(
      `  ${t.padEnd(16)} ${String(count).padStart(3)} 条  最新=${newest}  最早=${oldest}`
    );
  } catch (e) {
    console.log(`  ${t.padEnd(16)} ❌ ${e.message.split("\n")[0]}`);
  }
}

console.log("\n✅ 诊断完毕");
