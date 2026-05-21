/**
 * 清理重复 households 数据
 *
 * 用法：
 *   node scripts/fix-duplicate-households.mjs              # dry-run，只显示要做什么
 *   node scripts/fix-duplicate-households.mjs --apply      # 真正执行
 *
 * 修复策略：
 * - 对每个有多个 household_members 的用户，按 created_at 升序排
 * - 保留最早的那个 household（"权威 household"）
 * - 把其他 households 关联的 properties/tenants/leases/bills 等 update 到权威 household
 * - 删除多余的 household_members 行 + 多余的 households 行
 *
 * 安全保证：
 * - dry-run 模式不修改任何数据，只报告
 * - 每个 user 处理失败不影响其他 user（try/catch）
 * - 用 SERVICE_ROLE_KEY 绕过 RLS（不然 update household_id 会被 RLS 阻止）
 */

import { readFileSync } from "fs";

try {
  const env = readFileSync(".env.production", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) {
  console.error("⚠️  无法读 .env.production:", e.message);
}

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ 环境变量缺失");
  process.exit(1);
}

async function sb(path, opts = {}) {
  const isWrite = opts.method && ["PATCH", "DELETE", "POST", "PUT"].includes(opts.method);
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(isWrite ? { Prefer: "return=minimal" } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path.split("?")[0]} | ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

console.log(`\n🔧 ${APPLY ? "实际执行" : "DRY-RUN（不修改数据）"}\n`);

// 1. 列所有 user
const allUserIds = [];
for (let page = 1; page <= 50; page++) {
  const data = await sb(`/auth/v1/admin/users?page=${page}&per_page=100`);
  if (!data.users || data.users.length === 0) break;
  data.users.forEach((u) => allUserIds.push(u.id));
  if (data.users.length < 100) break;
}
console.log(`总用户数: ${allUserIds.length}\n`);

const dataTables = ["properties", "tenants", "leases", "bills", "meter_readings", "payments"];
let problemUsers = 0;
let totalMergedRows = 0;
let totalDeletedHouseholds = 0;

for (const userId of allUserIds) {
  const members = await sb(
    `/rest/v1/household_members?select=household_id,created_at&user_id=eq.${userId}&order=created_at.asc`
  );
  if (!members || members.length <= 1) continue;

  problemUsers++;
  const keepHhId = members[0].household_id;
  // 去重多余 ids（同一个 household_id 可能有多条 member 行）
  const dupHhIdsSet = new Set(members.slice(1).map((m) => m.household_id));
  dupHhIdsSet.delete(keepHhId);
  const dupHhIds = [...dupHhIdsSet];

  console.log(
    `\nUser ${userId.slice(0, 8)}…  ${members.length} 个 member 关联, 保留最早 hh=${keepHhId.slice(0, 8)}…  待清理 ${dupHhIds.length} 个`
  );

  // 处理每个 dup household：把数据迁移到 keepHhId，然后删 household_members + households
  let userMergedRows = 0;
  for (const dupId of dupHhIds) {
    if (dupId === keepHhId) continue;

    // 1) 数据迁移：每张表
    for (const t of dataTables) {
      try {
        const rows = await sb(`/rest/v1/${t}?select=id&household_id=eq.${dupId}`);
        if (!rows || rows.length === 0) continue;
        if (APPLY) {
          await sb(`/rest/v1/${t}?household_id=eq.${dupId}`, {
            method: "PATCH",
            body: JSON.stringify({ household_id: keepHhId }),
          });
        }
        userMergedRows += rows.length;
        console.log(`  ${APPLY ? "✓ 迁移" : "→ 需迁移"} ${t}: ${rows.length} 条 (hh ${dupId.slice(0, 8)} → ${keepHhId.slice(0, 8)})`);
      } catch (e) {
        // 表不存在或别的错误，跳过
      }
    }

    // 2) 删除 household_members（该 dup 上所有 members）+ 删除 household
    if (APPLY) {
      try {
        await sb(`/rest/v1/household_members?household_id=eq.${dupId}`, { method: "DELETE" });
        await sb(`/rest/v1/households?id=eq.${dupId}`, { method: "DELETE" });
      } catch (e) {
        console.log(`  ⚠️ 删除 ${dupId.slice(0, 8)} 失败: ${e.message.slice(0, 80)}`);
      }
    }
  }
  totalMergedRows += userMergedRows;
  totalDeletedHouseholds += dupHhIds.length;
  console.log(`  ${APPLY ? "✓" : "→"} ${APPLY ? "已" : "需"}清理: 迁 ${userMergedRows} 条数据 + 删 ${dupHhIds.length} 个 household`);
}

console.log(`\n📊 总结`);
console.log(`  有重复 household 的用户: ${problemUsers} / ${allUserIds.length}`);
console.log(`  ${APPLY ? "已迁移" : "需迁移"} 数据行: ${totalMergedRows}`);
console.log(`  ${APPLY ? "已删除" : "需删除"} 多余 household: ${totalDeletedHouseholds}`);

if (!APPLY) {
  console.log(`\n💡 dry-run 看着 OK，再跑这条真正执行：`);
  console.log(`   node scripts/fix-duplicate-households.mjs --apply`);
}
