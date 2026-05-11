// 通用 Markdown → Word (.docx) 转换器
// 用法：node scripts/md-to-word.mjs <src.md> [dst.docx]
// 默认输出：./交接文档/<basename>-<date>.docx
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function findPandoc() {
  try {
    const out = execFileSync("pandoc", ["--version"], { encoding: "utf8" });
    if (out) return "pandoc";
  } catch {}
  const wingetBase = `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages`;
  if (existsSync(wingetBase)) {
    const pkgs = readdirSync(wingetBase).filter((d) => d.startsWith("JohnMacFarlane.Pandoc"));
    for (const pkg of pkgs) {
      const inner = readdirSync(join(wingetBase, pkg)).find((d) => d.startsWith("pandoc-"));
      if (inner) {
        const exe = join(wingetBase, pkg, inner, "pandoc.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法：node scripts/md-to-word.mjs <src.md> [dst.docx]");
  process.exit(1);
}

const src = resolve(args[0]);
if (!existsSync(src)) {
  console.error(`✗ 文件不存在：${src}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const defaultName = `${basename(src, extname(src))}-${today}.docx`;
const dst = args[1]
  ? resolve(args[1])
  : join(ROOT, "交接文档", defaultName);

mkdirSync(dirname(dst), { recursive: true });

const pandoc = findPandoc();
if (!pandoc) {
  console.error("✗ 找不到 pandoc。请先安装：winget install --id JohnMacFarlane.Pandoc");
  process.exit(1);
}

console.log(`使用 pandoc：${pandoc}`);
console.log(`从  ${src}`);
console.log(`到  ${dst}\n`);

execFileSync(
  pandoc,
  [
    src,
    "-o", dst,
    "--from=markdown",
    "--to=docx",
    "--toc",
    "--toc-depth=2",
    "-V", "mainfont=Microsoft YaHei",
  ],
  { stdio: "inherit" }
);

console.log(`\n✅ 已生成 Word 文档：${dst}`);
console.log(`   双击打开即可。带目录、可编辑。`);
