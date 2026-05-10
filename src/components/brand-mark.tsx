/**
 * 品牌图标 — 屋顶 + 嫩芽，呼应"养房"的"养"
 * 颜色继承自父元素的 currentColor / 显式 color prop
 */
interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 24, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* 屋顶 + 房身 */}
      <path d="M11 52 V32 L30 20 L49 32 V52 Z" />
      {/* 嫩芽 — 茎 */}
      <path d="M30 22 Q30 14 30 9" />
      {/* 嫩芽 — 左叶 */}
      <path
        d="M30 14 Q24 13 22 17 Q26 19 30 16"
        fill="currentColor"
        opacity="0.85"
        stroke="none"
      />
      {/* 嫩芽 — 右叶 */}
      <path
        d="M30 11 Q35 10 37 13 Q34 16 30 13"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
