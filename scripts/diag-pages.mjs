import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TEST_EMAIL = `diag-${Date.now()}@example.com`;
const TEST_PW = "diagtest123456";

console.log("\n=== 1. 注册测试用户 ===");
const { data: signupData, error: signupErr } = await sb.auth.signUp({
  email: TEST_EMAIL,
  password: TEST_PW,
});
if (signupErr) {
  console.error("注册失败:", signupErr);
  process.exit(1);
}
console.log("✓ 注册成功:", TEST_EMAIL, "session:", !!signupData.session);

if (!signupData.session) {
  console.log("\n⚠️ 注册没有 session（说明 Supabase 开启了邮件确认），尝试登录...");
  const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PW,
  });
  if (loginErr) {
    console.error("登录也失败:", loginErr);
    process.exit(1);
  }
  console.log("✓ 登录成功");
}

const userId = (await sb.auth.getUser()).data.user?.id;
console.log("user_id:", userId);

// 用一个简单的 RPC 看 auth.uid() 在数据库端到底是啥
const { data: dbUid, error: rpcErr } = await sb.rpc("current_household_ids");
console.log("RPC current_household_ids 结果:", { data: dbUid, error: rpcErr?.message });

const sessionUser = (await sb.auth.getSession()).data.session?.user;
console.log("session.user.id:", sessionUser?.id);
console.log("两者匹配:", sessionUser?.id === userId);

console.log("\n=== 2. 模拟 UserProvider.ensureHousehold ===");
const { data: existingMembership } = await sb
  .from("household_members")
  .select("household_id")
  .eq("user_id", userId)
  .maybeSingle();
console.log("已有 membership:", existingMembership);

let householdId = existingMembership?.household_id;
if (!householdId) {
  const { data: hh, error: hhErr } = await sb
    .from("households")
    .insert({ name: "测试家庭组", owner_id: userId })
    .select("id")
    .single();
  if (hhErr) {
    console.error("✗ households insert 失败:", hhErr);
    process.exit(1);
  }
  console.log("✓ 创建 household:", hh.id);
  householdId = hh.id;

  const { error: mErr } = await sb
    .from("household_members")
    .insert({ household_id: householdId, user_id: userId, role: "owner" });
  if (mErr) {
    console.error("✗ household_members insert 失败:", mErr);
  } else {
    console.log("✓ 加入 members 成功");
  }
}

console.log(`\nhouseholdId = ${householdId}`);

console.log("\n=== 3. 模拟各页面首次 SELECT 查询 ===");
const queries = [
  { page: "/properties", q: () => sb.from("properties").select("*").eq("household_id", householdId).is("deleted_at", null) },
  { page: "/bills (lease 子查询)", q: () => sb.from("leases").select("id").eq("household_id", householdId).is("deleted_at", null) },
  { page: "/meters (properties)", q: () => sb.from("properties").select("*").eq("household_id", householdId).is("deleted_at", null) },
  { page: "/meters (meter_readings)", q: () => sb.from("meter_readings").select("*, property:properties(name)").limit(50) },
  { page: "/tenants", q: () => sb.from("tenants").select("*").eq("household_id", householdId).is("deleted_at", null) },
  { page: "/leases", q: () => sb.from("leases").select("*, property:properties(name), lease_tenants(tenant:tenants(name))").eq("household_id", householdId).is("deleted_at", null) },
  { page: "/payments", q: () => sb.from("payments").select("*").limit(50) },
  { page: "/reminders", q: () => sb.from("reminders").select("*").eq("household_id", householdId) },
];

for (const { page, q } of queries) {
  const r = await q();
  if (r.error) {
    console.log(`  ✗ ${page} → ${r.error.code}: ${r.error.message}`);
  } else {
    console.log(`  ✓ ${page} → ${(r.data ?? []).length} 行`);
  }
}

console.log("\n=== 完成 ===");
