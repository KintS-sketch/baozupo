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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("❌ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const sb = createClient(url, key);
const tables = [
  "user_profiles",
  "households",
  "household_members",
  "household_invites",
  "properties",
  "tenants",
  "leases",
  "lease_tenants",
  "bills",
  "payments",
  "meter_readings",
  "reminders",
];

console.log(`\n检查 Supabase 项目: ${url}\n`);
let existCount = 0;
let missing = [];
for (const t of tables) {
  const { error } = await sb.from(t).select("*", { count: "exact", head: true }).limit(1);
  if (!error) {
    console.log(`  ✓ ${t}`);
    existCount++;
  } else if (error.code === "42P01" || error.message.includes("does not exist")) {
    console.log(`  ✗ ${t} (不存在)`);
    missing.push(t);
  } else {
    console.log(`  ⚠ ${t} (${error.code}: ${error.message})`);
  }
}
console.log(`\n总计: ${existCount}/${tables.length} 张表存在`);
if (missing.length) console.log(`缺失: ${missing.join(", ")}`);
