"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  FileText,
  Receipt,
  CreditCard,
  Gauge,
  Bell,
  UsersRound,
  Calculator,
  Sparkles,
  Settings,
  LogOut,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";

const navItems = [
  { href: "/", label: "首页概览", icon: LayoutDashboard },
  { href: "/properties", label: "房源管理", icon: Building2 },
  { href: "/tenants", label: "租客管理", icon: Users },
  { href: "/invites", label: "邀请箱", icon: Inbox },
  { href: "/leases", label: "租约管理", icon: FileText },
  { href: "/bills", label: "账单管理", icon: Receipt },
  { href: "/payments", label: "收款记录", icon: CreditCard },
  { href: "/meters", label: "抄表记录", icon: Gauge },
  { href: "/reminders", label: "提醒中心", icon: Bell },
  { href: "/tax", label: "个税助手", icon: Calculator },
  { href: "/household", label: "家庭组", icon: UsersRound },
];

// 这些路径下不显示侧边栏（未登录或认证相关）
// /invite/* 是无需登录的公开表单（租客/中介自填），不显示侧边栏
const HIDE_SIDEBAR_PREFIXES = ["/login", "/api/auth", "/invite"];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (HIDE_SIDEBAR_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  return (
    <aside className="hidden md:flex flex-col w-56 min-h-screen bg-white border-r border-border">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <BrandMark size={22} />
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-base text-foreground">养房</span>
            <span className="text-[11px] text-muted-faint tracking-wider font-medium">TEND</span>
          </div>
          <p className="text-xs text-muted-foreground leading-none mt-0.5">AI 房东助手</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
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
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-border space-y-1">
        <Link
          href="/subscription"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/subscription")
              ? "bg-amber-500/10 text-amber-700"
              : "text-amber-700 hover:bg-amber-50"
          )}
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          升级 Pro
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          设置
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          退出登录
        </button>
      </div>
    </aside>
  );
}
