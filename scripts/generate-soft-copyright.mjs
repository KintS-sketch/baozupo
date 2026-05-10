import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "软著申请材料");

mkdirSync(OUT_DIR, { recursive: true });

// 按"用户感知 → 业务核心 → 基础设施"的顺序排列源文件
// 这样前 30 页是用户最直观的入口（页面），后 30 页是底层（数据库迁移、工具）
const FILE_ORDER = [
  // 入口
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/middleware.ts",

  // 主要页面
  "src/app/login/page.tsx",
  "src/app/properties/page.tsx",
  "src/app/properties/[id]/page.tsx",
  "src/app/tenants/page.tsx",
  "src/app/leases/page.tsx",
  "src/app/bills/page.tsx",
  "src/app/payments/page.tsx",
  "src/app/meters/page.tsx",
  "src/app/reminders/page.tsx",
  "src/app/household/page.tsx",
  "src/app/household/join/page.tsx",
  "src/app/settings/page.tsx",

  // API 路由
  "src/app/api/ai/recognize-payment/route.ts",
  "src/app/api/auth/callback/route.ts",

  // 表单组件（业务核心）
  "src/components/forms/property-form.tsx",
  "src/components/forms/tenant-form.tsx",
  "src/components/forms/lease-form.tsx",
  "src/components/forms/bill-form.tsx",
  "src/components/forms/bill-payment-form.tsx",
  "src/components/forms/meter-form.tsx",
  "src/components/forms/payment-screenshot-upload.tsx",
  "src/components/contract-upload.tsx",

  // 布局
  "src/components/layout/sidebar.tsx",
  "src/components/layout/mobile-nav.tsx",
  "src/components/brand-mark.tsx",
  "src/components/empty-state.tsx",

  // 上下文 + 类型
  "src/contexts/user-context.tsx",
  "src/types/index.ts",
  "src/types/ai.ts",

  // 业务算法库
  "src/lib/billing.ts",
  "src/lib/billing.test.ts",
  "src/lib/meter-billing.ts",
  "src/lib/meter-billing.test.ts",
  "src/lib/reminders.ts",
  "src/lib/reminders.test.ts",
  "src/lib/reminders-service.ts",
  "src/lib/household-service.ts",
  "src/lib/invite-code.ts",
  "src/lib/format.ts",
  "src/lib/utils.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/server.ts",

  // UI 组件库
  "src/components/ui/dialog.tsx",
  "src/components/ui/alert-dialog.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/form.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/badge.tsx",
  "src/components/ui/label.tsx",
  "src/components/ui/separator.tsx",
  "src/components/ui/sonner.tsx",
  "src/components/ui/table.tsx",
  "src/components/ui/tabs.tsx",

  // 样式
  "src/app/globals.css",

  // 配置
  "package.json",
  "tsconfig.json",
  "tailwind.config.ts",
  "next.config.ts",

  // 数据库迁移（基础设施）
  "supabase/migrations/0001_initial.sql",
  "supabase/migrations/0002_household_invites_and_rls.sql",
  "supabase/migrations/0003_fix_households_select_policy.sql",
  "supabase/migrations/0004_storage_contracts_policies.sql",
  "supabase/migrations/0005_recalc_bill_status.sql",
];

// 拼接所有源代码 + 文件分隔
let allLines = [];
let totalOriginalLines = 0;
const fileStats = [];

for (const relPath of FILE_ORDER) {
  const abs = join(ROOT, relPath);
  let content;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    console.warn(`跳过缺失文件: ${relPath}`);
    continue;
  }
  const lines = content.split(/\r?\n/);
  totalOriginalLines += lines.length;
  fileStats.push({ path: relPath, lines: lines.length });

  // 文件分隔头
  allLines.push(`/* ============================================================ */`);
  allLines.push(`/* 文件: ${relPath}    （${lines.length} 行） */`);
  allLines.push(`/* ============================================================ */`);
  for (const line of lines) {
    allLines.push(line);
  }
  allLines.push("");
}

const LINES_PER_PAGE = 50;
const PAGES = 30;
const FRONT_LINES = LINES_PER_PAGE * PAGES;
const BACK_LINES = LINES_PER_PAGE * PAGES;

const front = allLines.slice(0, FRONT_LINES);
const back = allLines.slice(-BACK_LINES);

// === 生成 HTML（可打印为 PDF）===
function makeHtml(title, lines, startPage = 1) {
  let pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  const pageHtml = pages
    .map((pageLines, idx) => {
      const pageNum = startPage + idx;
      const numbered = pageLines
        .map((line, j) => {
          const lineNum = String(i_offset_of_page(idx) + j + 1).padStart(4, " ");
          const escaped = line
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<span class="ln">${lineNum}</span> ${escaped}`;
        })
        .join("\n");
      return `<div class="page">
<div class="page-header">软件名称: 养房 Tend (Baozupo)  ·  ${title}  ·  第 ${pageNum} 页</div>
<pre>${numbered}</pre>
</div>`;
    })
    .join("\n");

  function i_offset_of_page(idx) {
    return idx * LINES_PER_PAGE;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>养房 Tend - 软著源代码 - ${title}</title>
<style>
  body { font-family: 'Consolas', 'Courier New', '苹方', 'Microsoft YaHei', monospace; font-size: 10pt; margin: 0; padding: 0; background: white; color: black; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm 16mm 16mm; box-sizing: border-box; page-break-after: always; }
  .page-header { font-size: 9pt; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 4mm; margin-bottom: 4mm; }
  pre { white-space: pre; line-height: 1.35; margin: 0; font-size: 9.5pt; }
  .ln { color: #999; user-select: none; margin-right: 6px; }
  @media print { .page { margin: 0; box-shadow: none; } }
</style>
</head>
<body>
${pageHtml}
</body>
</html>`;
}

// 简化版 — 不在页面里逐行编号（为打印整洁），用块状打印
function makeSimpleHtml(title, lines, startPage = 1) {
  let pageBlocks = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    const pageLines = lines.slice(i, i + LINES_PER_PAGE);
    const pageNum = startPage + (i / LINES_PER_PAGE);
    const escaped = pageLines
      .map((line) =>
        line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      )
      .join("\n");
    pageBlocks.push(`<div class="page">
<div class="page-header">养房 Tend  ·  ${title}  ·  第 ${pageNum} 页 / 共 ${PAGES} 页</div>
<pre>${escaped}</pre>
</div>`);
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>养房 Tend - 软著源代码 - ${title}</title>
<style>
  body { font-family: 'Consolas', 'Courier New', '苹方', 'Microsoft YaHei', monospace; font-size: 10pt; margin: 0; padding: 0; background: white; color: black; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm 16mm 16mm; box-sizing: border-box; page-break-after: always; }
  .page-header { font-size: 9pt; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 4mm; margin-bottom: 4mm; }
  pre { white-space: pre-wrap; word-wrap: break-word; line-height: 1.35; margin: 0; font-size: 9.5pt; }
  @media print { .page { margin: 0; box-shadow: none; page-break-after: always; } @page { size: A4; margin: 0; } }
</style>
</head>
<body>
${pageBlocks.join("\n")}
</body>
</html>`;
}

writeFileSync(join(OUT_DIR, "源代码-前30页.html"), makeSimpleHtml("源代码 前 30 页", front, 1));
writeFileSync(join(OUT_DIR, "源代码-后30页.html"), makeSimpleHtml("源代码 后 30 页", back, 1));

// === 生成 TXT（备用，纯文本格式）===
writeFileSync(join(OUT_DIR, "源代码-前30页.txt"), front.join("\n"));
writeFileSync(join(OUT_DIR, "源代码-后30页.txt"), back.join("\n"));

// === 生成统计信息 ===
const stats = `养房 Tend - 软著申请代码统计
================================
总行数: ${totalOriginalLines}
取用范围: 前 ${PAGES} 页 (${FRONT_LINES} 行) + 后 ${PAGES} 页 (${BACK_LINES} 行)

包含文件清单（按提取顺序）:
${fileStats.map((f, i) => `  ${i + 1}. ${f.path}  (${f.lines} 行)`).join("\n")}

总计 ${fileStats.length} 个文件，${totalOriginalLines} 行。
`;
writeFileSync(join(OUT_DIR, "代码统计.txt"), stats);

console.log("✅ 软著源代码材料已生成到 软著申请材料/ 目录");
console.log(`   - 源代码-前30页.html (${FRONT_LINES} 行)`);
console.log(`   - 源代码-后30页.html (${BACK_LINES} 行)`);
console.log(`   - 源代码-前30页.txt`);
console.log(`   - 源代码-后30页.txt`);
console.log(`   - 代码统计.txt`);
console.log(`\n总代码行数: ${totalOriginalLines}`);
