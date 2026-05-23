"use client";

interface PdfPreviewProps {
  src: string;
  className?: string;
  /** 高度，默认 60vh。iOS Safari iframe PDF 表现一般，可适当增加 */
  heightClass?: string;
}

/**
 * PDF 预览组件。iframe 内嵌是当前最稳的跨浏览器 PDF 预览方式。
 * iOS Safari 上 iframe 内的 PDF 可能只显示首页，用户可以下载查看完整内容。
 */
export function PdfPreview({ src, className, heightClass = "h-[60vh]" }: PdfPreviewProps) {
  return (
    <div className={`bg-secondary rounded-lg overflow-hidden ${className ?? ""}`}>
      <iframe
        src={src}
        className={`w-full ${heightClass}`}
        title="合同预览"
      />
    </div>
  );
}
