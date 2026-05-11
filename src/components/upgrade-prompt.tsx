import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface UpgradePromptProps {
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
  /** 自定义 CTA 文字 */
  ctaLabel?: string;
  /** 跳转地址，默认 /subscription */
  href?: string;
  /** 紧凑模式（场景：表单内嵌） */
  compact?: boolean;
  className?: string;
}

/**
 * 升级 Pro 卡片 — 用于免费用户达到限额时的软付费墙
 */
export function UpgradePrompt({
  title = "升级 Pro，解锁更多",
  description = "无限房源 · 微信自动提醒 · 个税 Pro 报告 · 早鸟年卡 ¥69",
  ctaLabel = "查看 Pro 详情",
  href = "/subscription",
  compact = false,
  className,
}: UpgradePromptProps) {
  return (
    <Card
      className={cn(
        "border-amber-500/30 bg-gradient-to-br from-amber-50 to-orange-50/50",
        className
      )}
    >
      <CardContent className={cn(compact ? "py-3" : "py-4")}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</p>
            <p className={cn("text-muted-foreground mt-0.5 leading-relaxed", compact ? "text-xs" : "text-sm")}>
              {description}
            </p>
            <Link
              href={href}
              className={cn(
                "inline-flex items-center gap-1 text-orange-700 font-medium hover:text-orange-800 mt-2 group",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {ctaLabel}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
