// 把 HANDOFF.md 转成 Word（.docx），用 pandoc 完成
// 用法：node scripts/handoff-to-word.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "HANDOFF.md");
const OUT_DIR = join(ROOT, "交接文档");
const today = new Date().toISOString().slice(0, 10);
const OUT = join(OUT_DIR, `养房Tend-接手手册-${today}.docx`);

mkdirSync(OUT_DIR, { recursive: true });

// 找 pandoc：先看 PATH，找不到就猜 winget 默认路径
function findPandoc() {
  try {
    return execFileSync("pandoc", ["--version"], { encoding: "utf8" }).split("\n")[0]
      ? "pandoc"
      : null;
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

const pandoc = findPandoc();
if (!pandoc) {
  console.error("✗ 找不到 pandoc。请先安装：winget install --id JohnMacFarlane.Pandoc");
  process.exit(1);
}

console.log(`使用 pandoc: ${pandoc}`);
console.log(`从  ${SRC}`);
console.log(`到  ${OUT}\n`);

execFileSync(
  pandoc,
  [SRC, "-o", OUT, "--from=markdown", "--to=docx", "--toc", "--toc-depth=2", "-V", "mainfont=Microsoft YaHei"],
  { stdio: "inherit" }
);

console.log(`\n✅ 已生成 Word 文档：${OUT}`);
console.log(`   双击打开即可。带目录、可编辑。\n`);
