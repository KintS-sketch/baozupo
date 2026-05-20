"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserPlus, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("请填写邮箱和密码");
      return;
    }
    if (password.length < 6) {
      toast.error("密码至少需要6位");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("登录成功");
        router.push("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/api/auth/callback` },
        });
        if (error) throw error;

        // 注册成功后立刻尝试登录：
        // - 如果 Supabase 未开启邮箱确认（默认行为），直接登录成功 → 跳主页
        // - 如果开启了邮箱确认，登录会失败 → 提示用户去邮箱确认，切回登录模式
        const { error: autoLoginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (!autoLoginError) {
          toast.success("注册成功，正在进入...");
          router.push("/");
          router.refresh();
        } else {
          toast.success("注册成功！请到邮箱完成验证，然后回到这里登录");
          setMode("login");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作失败";
      if (message.includes("Invalid login credentials")) {
        toast.error("邮箱或密码错误");
      } else if (message.includes("User already registered")) {
        toast.error("该邮箱已注册，请直接登录");
        setMode("login");
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary mb-4 shadow-soft-md">
            <BrandMark size={36} />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">养房</h1>
            <span className="text-sm text-muted-faint tracking-widest font-medium">TEND</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">拍一下就出账单，到期主动提醒</p>
        </div>

        <Card className={cn(
          "transition-all duration-300",
          mode === "register" && "ring-2 ring-primary/20 shadow-soft-md"
        )}>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                mode === "login"
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-white"
              )}>
                {mode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              </div>
              <div className="flex-1">
                <CardTitle>{mode === "login" ? "欢迎回来" : "开始使用养房 Tend"}</CardTitle>
                <CardDescription className="mt-0.5">
                  {mode === "login"
                    ? "用邮箱密码登录"
                    : "1 分钟创建账号，免费使用"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mode === "register" && (
              <div className="bg-primary/5 rounded-lg p-3 mb-4 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>拍水电表自动识别读数</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>账单自动生成 + 微信主动提醒</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>租约 / 房源 / 账单 一站管理</span>
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少6位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "login" ? "登录" : "注册"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  还没有账号？{" "}
                  <button
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode("register")}
                  >
                    立即注册
                  </button>
                </>
              ) : (
                <>
                  已有账号？{" "}
                  <button
                    className="text-primary hover:underline font-medium"
                    onClick={() => setMode("login")}
                  >
                    直接登录
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          继续即表示您同意我们的
          <Link href="/terms" className="text-[#C8553D] underline mx-0.5">服务条款</Link>
          和
          <Link href="/privacy" className="text-[#C8553D] underline mx-0.5">隐私政策</Link>
        </p>
      </div>
    </div>
  );
}
