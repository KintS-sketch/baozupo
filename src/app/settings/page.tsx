"use client";

import { useEffect, useState } from "react";
import { User, LogOut, ChevronRight, Loader2, Sparkles, CreditCard, FileText, Bell, Gauge, MessageCircle, Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface WechatBindingState {
  bound: boolean;
  nickname: string | null;
  boundAt: string | null;
}

const WECHAT_STATUS_TOAST: Record<string, { type: "success" | "error" | "warning"; msg: string }> = {
  bound:                { type: "success", msg: "微信绑定成功，到期提醒会自动推送给你" },
  state_invalid:        { type: "error",   msg: "授权链接已过期，请重新发起绑定" },
  code_missing:         { type: "error",   msg: "微信授权未完成，请重试" },
  exchange_failed:      { type: "error",   msg: "微信换取信息失败，请稍后重试" },
  already_bound_other:  { type: "warning", msg: "该微信已绑定其他账号，请先解除再试" },
  db_error:             { type: "error",   msg: "服务端保存失败，请重试" },
  server_error:         { type: "error",   msg: "服务端配置异常，请联系管理员" },
};

const QUICK_LINKS = [
  { href: "/reminders", label: "提醒中心", icon: Bell, desc: "查看待处理提醒" },
  { href: "/leases", label: "租约管理", icon: FileText, desc: "查看和管理租约" },
  { href: "/meters", label: "抄表记录", icon: Gauge, desc: "水电气表读数" },
  { href: "/payments", label: "收款记录", icon: CreditCard, desc: "历史收款流水" },
];

export default function SettingsPage() {
  const { user, householdId } = useUser();
  const router = useRouter();
  const supabase = createClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const [wechat, setWechat] = useState<WechatBindingState>({ bound: false, nickname: null, boundAt: null });
  const [wechatBusy, setWechatBusy] = useState(false);

  // 读 user_profiles 看微信绑定状态
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("wechat_openid, wechat_nickname, wechat_bound_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setWechat({
        bound: !!data?.wechat_openid,
        nickname: data?.wechat_nickname ?? null,
        boundAt: data?.wechat_bound_at ?? null,
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 处理 OAuth 回调后的 toast 提示
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("wechat");
    if (!status) return;
    const cfg = WECHAT_STATUS_TOAST[status];
    if (cfg) {
      if (cfg.type === "success") toast.success(cfg.msg);
      else if (cfg.type === "warning") toast.warning(cfg.msg);
      else toast.error(cfg.msg);
    }
    url.searchParams.delete("wechat");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    toast.success("已退出登录");
    router.push("/login");
  };

  const handleBindWechat = () => {
    // 跳转到服务端发起 OAuth，必须 full page navigation
    window.location.href = "/api/wechat/oauth/init";
  };

  const handleUnbindWechat = async () => {
    setWechatBusy(true);
    try {
      const resp = await fetch("/api/wechat/unbind", { method: "POST" });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        toast.error(json.error ?? "解绑失败");
        return;
      }
      toast.success("已解除微信绑定");
      setWechat({ bound: false, nickname: null, boundAt: null });
    } finally {
      setWechatBusy(false);
    }
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

      {/* 微信提醒 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-[#07C160]" />
            微信自动提醒
            {wechat.bound && (
              <Badge variant="success" className="ml-1 gap-1">
                <Check className="h-3 w-3" />
                已绑定
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {wechat.bound
              ? "收租日 / 抄表日 / 合同到期会自动推送到你的微信"
              : "绑定微信后，到期提醒直接推送，再也不会忘"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {wechat.bound ? (
            <>
              <div className="flex items-center gap-3 rounded-lg bg-[#07C160]/5 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#07C160]/15 text-[#07C160]">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {wechat.nickname ?? "微信用户"}
                  </p>
                  {wechat.boundAt && (
                    <p className="text-xs text-muted-foreground">
                      绑定于 {new Date(wechat.boundAt).toLocaleDateString("zh-CN")}
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
                <p className="font-medium text-foreground mb-1">📅 推送时机（每天早 8 点扫描一次）</p>
                <p>· 账单到期前 1 天 · 当天 · 逾期 3 天</p>
                <p>· 租约到期前 30 天 · 14 天 · 前 1 天</p>
                <p>· 上次抄表 ≥ 28 天</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleUnbindWechat}
                disabled={wechatBusy}
              >
                {wechatBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                解除微信绑定
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                <p>📌 必须在<strong>微信内</strong>打开本页面才能完成绑定</p>
                <p>📌 点击下方按钮 → 微信会弹出授权框 → 同意即可</p>
              </div>
              <div className="rounded-lg bg-[#FBEEE9] border border-[#C8553D]/20 p-3 text-xs text-foreground/80 leading-relaxed">
                <p className="font-medium text-[#C8553D] mb-1">📅 绑定后会自动推送（不会骚扰）</p>
                <p>· 账单到期前 1 天 · 当天 · 逾期 3 天</p>
                <p>· 租约到期前 30 天 · 14 天 · 前 1 天</p>
                <p>· 上次抄表 ≥ 28 天</p>
              </div>
              <Button
                className="w-full bg-[#07C160] hover:bg-[#07C160]/90"
                onClick={handleBindWechat}
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                绑定微信，开启自动提醒
              </Button>
            </>
          )}
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
