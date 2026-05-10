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

console.log("\nRLS 测试：用匿名身份能否读到行（应返回 0 行或被拒）\n");

const tables = [
  "households",
  "household_members",
  "household_invites",
  "properties",
  "tenants",
  "leases",
  "bills",
  "payments",
  "meter_readings",
  "reminders",
];

let leakCount = 0;
for (const t of tables) {
  const { data, error } = await sb.from(t).select("*").limit(3);
  if (error) {
    console.log(`  ✓ ${t} — 拒绝访问 (${error.message.slice(0, 60)})`);
  } else if (!data || data.length === 0) {
    console.log(`  ✓ ${t} — 空（RLS 通过或表本身没数据）`);
  } else {
    console.log(`  ⚠ ${t} — 匿名可读到 ${data.length} 行 → RLS 可能没启用！`);
    leakCount++;
  }
}

console.log(leakCount === 0 ? "\n✅ 没有发现明显泄漏\n" : `\n❌ 发现 ${leakCount} 张表可能未启用 RLS\n`);
