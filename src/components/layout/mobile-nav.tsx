"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  Receipt,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/properties", label: "房源", icon: Building2 },
  { href: "/tenants", label: "租客", icon: Users },
  { href: "/bills", label: "账单", icon: Receipt },
  { href: "/settings", label: "更多", icon: MoreHorizontal },
];

// 这些路径下不显示底部导航（未登录或认证相关）
const HIDE_NAV_PREFIXES = ["/login", "/api/auth"];

export function MobileNav() {
  const pathname = usePathname();

  if (HIDE_NAV_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-white border-t border-border pb-safe">
      {mobileNavItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
