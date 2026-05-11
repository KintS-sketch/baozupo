import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

/**
 * Pro 徽章 — 用于 Pro 功能旁的视觉标识
 */
export function ProBadge({ className, size = "sm" }: ProBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md font-medium",
        "bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-white",
        "shadow-sm",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className
      )}
    >
      <Sparkles className={cn(size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
      Pro
    </span>
  );
}
