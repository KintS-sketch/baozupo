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

const TEST_EMAIL = `diag2-${Date.now()}@example.com`;
const TEST_PW = "diagtest123456";

const { data: signupData, error: signupErr } = await sb.auth.signUp({ email: TEST_EMAIL, password: TEST_PW });
if (signupErr) { console.error(signupErr); process.exit(1); }
const userId = signupData.user.id;
console.log("user_id:", userId);

console.log("\n=== 试用 RPC 查 pg_policies ===");
// pg_policies 是个系统视图，普通用户能读
const { data, error } = await sb.from("pg_policies").select("*").eq("tablename", "households");
console.log("pg_policies(households):", error?.message ?? JSON.stringify(data, null, 2));

console.log("\n=== 直接尝试最小化 INSERT ===");
const r = await sb.from("households").insert({ name: "x", owner_id: userId });
console.log("insert 结果:", { error: r.error });
