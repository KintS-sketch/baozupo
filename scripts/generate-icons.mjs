import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const targets = [
  { svg: "icon.svg", out: "icon-180.png", size: 180 },
  { svg: "icon.svg", out: "icon-192.png", size: 192 },
  { svg: "icon.svg", out: "icon-512.png", size: 512 },
  { svg: "icon-maskable.svg", out: "icon-maskable-192.png", size: 192 },
  { svg: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512 },
];

for (const { svg, out, size } of targets) {
  const buf = readFileSync(join(publicDir, svg));
  await sharp(buf, { density: 384 }).resize(size, size).png().toFile(join(publicDir, out));
  console.log(`✓ ${out} (${size}×${size})`);
}
