import {
  generateBillPeriods,
} from "../src/lib/billing.ts";
import { format } from "date-fns";

console.log("当前时区:", Intl.DateTimeFormat().resolvedOptions().timeZone);
console.log("Date.now() 现在:", new Date().toISOString());

// 模拟用户输入的 3-6 月租约（注意：HTML date input 输出 YYYY-MM-DD 格式）
const start_date = "2026-03-15";
const end_date = "2026-06-15";

console.log(`\n输入: start=${start_date}, end=${end_date}, 月租=5000, 自然月, 1号收租\n`);

const periods = generateBillPeriods(
  new Date(start_date),
  new Date(end_date),
  5000,
  "natural_month",
  1
);

console.log(`生成 ${periods.length} 期：`);
for (const p of periods) {
  console.log(
    `  format → period_start=${format(p.periodStart, "yyyy-MM-dd")}` +
      ` period_end=${format(p.periodEnd, "yyyy-MM-dd")}` +
      ` due=${format(p.dueDate, "yyyy-MM-dd")}` +
      ` amount=${p.rentAmount}`
  );
}
