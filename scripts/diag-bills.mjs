import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  generateBillPeriods,
} from "../src/lib/billing.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// 直接测算法（不连数据库）：3月-6月，月租 5000，自然月，1号到期
const periods = generateBillPeriods(
  new Date("2026-03-15"),
  new Date("2026-06-15"),
  5000,
  "natural_month",
  1
);

console.log(`生成了 ${periods.length} 期账单：`);
for (const p of periods) {
  console.log(
    `  ${p.periodStart.toISOString().slice(0, 10)} → ${p.periodEnd.toISOString().slice(0, 10)}` +
      ` | ${p.daysInPeriod}天 | 应收 ${p.rentAmount} | 到期 ${p.dueDate.toISOString().slice(0, 10)}`
  );
}
