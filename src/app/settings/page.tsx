"use client";

import { useState } from "react";
import { User, LogOut, ChevronRight, Loader2, Sparkles, CreditCard, FileText, Bell, Gauge } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const QUICK_LINKS = [
  { href: "/reminders", label: "提醒中心", icon: Bell, desc: "查看待处理提醒" },
  { href: "/leases", label: "租约管理", icon: FileText, desc: "查看和管理租约" },
  { href: "/meters", label: "抄表记录", icon: Gauge, desc: "水电气表读数" },
  { href: "/payments", label: "收款记录", icon: CreditCard, desc: "历史收款流水" },
];

export default function SettingsPage() {
  const { user, householdId } = useUser();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("已退出登录");
    router.push("/login");
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">设置</h1>
        <p className="text-sm text-muted-foreground">管理账号和偏好设置</p>
      </div>

      {/* 快捷入口（手机端从"更多"进入这些页面） */}
      <Card className="md:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">快捷入口</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{link.label}</p>
                    <p className="text-xs text-muted-foreground">{link.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 账号信息 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">账号信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
              <User className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-sm">{user?.email ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                家庭组 ID：{householdId ? `${householdId.slice(0, 8)}...` : "未设置"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 家庭组协同 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">家庭组协同</CardTitle>
          <CardDescription>邀请家人共同管理房源</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            href="/household"
            className="flex items-center justify-between py-2 hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
          >
            <div>
              <p className="text-sm">管理家庭组成员</p>
              <p className="text-xs text-muted-foreground">查看成员、生成邀请码</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            href="/household/join"
            className="flex items-center justify-between py-2 hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
          >
            <div>
              <p className="text-sm">用邀请码加入</p>
              <p className="text-xs text-muted-foreground">家人邀请你时使用</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* AI 功能 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI 功能
          </CardTitle>
          <CardDescription>智能截图识别和自动填写（即将上线）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: "付款截图识别", desc: "自动识别微信/支付宝截图中的金额和时间" },
            { name: "合同智能识别", desc: "上传租约合同，自动提取关键信息" },
            { name: "智能催收提醒", desc: "AI 分析收租模式，智能生成提醒" },
          ].map((feature) => (
            <div key={feature.name} className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium">{feature.name}</p>
                <p className="text-xs text-muted-foreground">{feature.desc}</p>
              </div>
              <Badge variant="secondary">开发中</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 数据管理 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">数据管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm">数据导出</p>
              <p className="text-xs text-muted-foreground">导出账单记录为 Excel</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">即将上线</Badge>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm">提醒通知</p>
              <p className="text-xs text-muted-foreground">收租日、到期日提醒设置</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">即将上线</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 关于 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">关于</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>版本</span>
            <span>v0.1.0（内测）</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>产品定位</span>
            <span>养房 Tend · AI 房东助手</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>开发者</span>
            <span>深圳市一铠科技有限公司</span>
          </div>
          <Separator className="my-2" />
          <Link
            href="/terms"
            className="flex items-center justify-between py-1.5 hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
          >
            <span>用户服务协议</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            href="/privacy"
            className="flex items-center justify-between py-1.5 hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
          >
            <span>隐私政策</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* 退出登录 */}
      <Button
        variant="outline"
        className="w-full text-destructive border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="mr-2 h-4 w-4" />
        )}
        退出登录
      </Button>
    </div>
  );
}
