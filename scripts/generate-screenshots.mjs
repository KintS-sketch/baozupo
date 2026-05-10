import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// 用 SVG 直接合成品牌色 + logo + 标语的占位截图（后期可换真实截图）
const narrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="720" height="1280">
  <rect width="720" height="1280" fill="#FBEEE9"/>
  <g transform="translate(360 480) scale(7) translate(-30 -30)" stroke="#C8553D" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="3">
    <path d="M11 52 V32 L30 20 L49 32 V52 Z"/>
    <path d="M30 22 Q30 14 30 9"/>
    <path d="M30 14 Q24 13 22 17 Q26 19 30 16" fill="#C8553D" fill-opacity="0.85" stroke="none"/>
    <path d="M30 11 Q35 10 37 13 Q34 16 30 13" fill="#C8553D" stroke="none"/>
  </g>
  <text x="360" y="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="72" font-weight="700" fill="#C8553D" text-anchor="middle">养房 Tend</text>
  <text x="360" y="970" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="32" fill="#7A6258" text-anchor="middle">AI 房东助手</text>
  <text x="360" y="1030" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" fill="#9A8678" text-anchor="middle">让管理几套房像养一盆花一样轻松</text>
</svg>`;

const wideSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <rect width="1280" height="720" fill="#FBEEE9"/>
  <g transform="translate(640 280) scale(5) translate(-30 -30)" stroke="#C8553D" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="3">
    <path d="M11 52 V32 L30 20 L49 32 V52 Z"/>
    <path d="M30 22 Q30 14 30 9"/>
    <path d="M30 14 Q24 13 22 17 Q26 19 30 16" fill="#C8553D" fill-opacity="0.85" stroke="none"/>
    <path d="M30 11 Q35 10 37 13 Q34 16 30 13" fill="#C8553D" stroke="none"/>
  </g>
  <text x="640" y="540" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="72" font-weight="700" fill="#C8553D" text-anchor="middle">养房 Tend</text>
  <text x="640" y="610" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" fill="#7A6258" text-anchor="middle">AI 房东助手 · 让管理几套房像养一盆花一样轻松</text>
</svg>`;

await sharp(Buffer.from(narrowSvg)).png().toFile(join(publicDir, "screenshot-narrow.png"));
console.log("✓ screenshot-narrow.png (720x1280)");
await sharp(Buffer.from(wideSvg)).png().toFile(join(publicDir, "screenshot-wide.png"));
console.log("✓ screenshot-wide.png (1280x720)");
