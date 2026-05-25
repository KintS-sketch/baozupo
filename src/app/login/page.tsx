"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserPlus, CheckCircle2, Mail, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AuthMethod = "phone" | "email";
type EmailMode = "login" | "register";

export default function LoginPage() {
  // 默认手机号验证码（更丝滑）；老用户可切到邮箱密码
  const [method, setMethod] = useState<AuthMethod>("phone");

  // 邮箱密码态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailMode, setEmailMode] = useState<EmailMode>("login");
  const [emailLoading, setEmailLoading] = useState(false);

  // 手机号验证码态
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const cooldownTimer = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();

  // 倒计时
  useEffect(() => {
    if (otpCooldown <= 0) return;
    cooldownTimer.current = setTimeout(
      () => setOtpCooldown((s) => s - 1),
      1000
    );
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, [otpCooldown]);

  // ============ 邮箱密码登录注册 ============
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("请填写邮箱和密码");
      return;
    }
    if (password.length < 6) {
      toast.error("密码至少需要6位");
      return;
    }
    setEmailLoading(true);
    const supabase = createClient();
    try {
      if (emailMode === "login") {
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
          setEmailMode("login");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作失败";
      if (message.includes("Invalid login credentials")) {
        toast.error("邮箱或密码错误");
      } else if (message.includes("User already registered")) {
        toast.error("该邮箱已注册，请直接登录");
        setEmailMode("login");
      } else {
        toast.error(message);
      }
    } finally {
      setEmailLoading(false);
    }
  };

  // ============ 手机号验证码 ============
  const handleSendOtp = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error("请输入正确的 11 位手机号");
      return;
    }
    setOtpSending(true);
    try {
      const res = await fetch("/api/auth/send-sms-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "login" }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        expires_in?: number;
      };
      if (!json.success) {
        toast.error(json.error ?? "发送失败");
        return;
      }
      toast.success("验证码已发送，请查收短信");
      setOtpCooldown(60);
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setOtpSending(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error("请输入正确的 11 位手机号");
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      toast.error("验证码需为 6 位数字");
      return;
    }
    setOtpLoading(true);
    try {
      const res = await fetch("/api/auth/verify-sms-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        is_new_user?: boolean;
        access_token?: string;
        refresh_token?: string;
      };
      if (!json.success || !json.access_token || !json.refresh_token) {
        toast.error(json.error ?? "登录失败");
        return;
      }
      // 把 supabase session 装到客户端
      const supabase = createClient();
      const { error: setErr } = await supabase.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (setErr) {
        toast.error("会话建立失败：" + setErr.message);
        return;
      }
      toast.success(json.is_new_user ? "欢迎使用养房 Tend！" : "登录成功");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setOtpLoading(false);
    }
  };

  // ============ 渲染 ============
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary mb-4 shadow-soft-md">
            <BrandMark size={36} />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">养房</h1>
            <span className="text-sm text-muted-faint tracking-widest font-medium">TEND</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">拍一下就出账单，到期主动提醒</p>
        </div>

        {/* 方式切换 tab */}
        <div className="flex gap-2 mb-4 p-1 rounded-xl bg-muted">
          <button
            type="button"
            onClick={() => setMethod("phone")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg transition-colors",
              method === "phone"
                ? "bg-white text-primary font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Phone className="h-4 w-4" /> 手机号
          </button>
          <button
            type="button"
            onClick={() => setMethod("email")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg transition-colors",
              method === "email"
                ? "bg-white text-primary font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Mail className="h-4 w-4" /> 邮箱
          </button>
        </div>

        <Card>
          {method === "phone" ? (
            <>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>手机号登录 / 注册</CardTitle>
                    <CardDescription className="mt-0.5">
                      没有账号会自动注册，无需密码
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleOtpSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">手机号</Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      placeholder="11 位中国大陆手机号"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      autoComplete="tel"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otp">短信验证码</Label>
                    <div className="flex gap-2">
                      <Input
                        id="otp"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 位数字"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                        autoComplete="one-time-code"
                        required
                        className="flex-1 font-mono tracking-widest"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSendOtp}
                        disabled={otpSending || otpCooldown > 0 || phone.length !== 11}
                        className="shrink-0 w-28"
                      >
                        {otpSending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        {otpCooldown > 0 ? `${otpCooldown}s 后重发` : "获取验证码"}
                      </Button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={otpLoading}>
                    {otpLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    登录 / 注册
                  </Button>
                </form>
                <div className="mt-4 bg-primary/5 rounded-lg p-3 space-y-1.5 text-xs text-muted-foreground">
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
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                      emailMode === "login"
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary text-white"
                    )}
                  >
                    {emailMode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                  </div>
                  <div className="flex-1">
                    <CardTitle>{emailMode === "login" ? "邮箱登录" : "邮箱注册"}</CardTitle>
                    <CardDescription className="mt-0.5">
                      {emailMode === "login"
                        ? "用邮箱密码登录（老用户）"
                        : "1 分钟创建账号，免费使用"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                      autoComplete={emailMode === "login" ? "current-password" : "new-password"}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={emailLoading}>
                    {emailLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {emailMode === "login" ? "登录" : "注册"}
                  </Button>
                </form>
                <div className="mt-4 text-center text-sm text-muted-foreground">
                  {emailMode === "login" ? (
                    <>
                      还没有账号？{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => setEmailMode("register")}
                      >
                        立即注册
                      </button>
                    </>
                  ) : (
                    <>
                      已有账号？{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => setEmailMode("login")}
                      >
                        直接登录
                      </button>
                    </>
                  )}
                </div>
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          继续即表示您同意我们的
          <Link href="/terms" className="text-[#C8553D] underline mx-0.5">
            服务条款
          </Link>
          和
          <Link href="/privacy" className="text-[#C8553D] underline mx-0.5">
            隐私政策
          </Link>
        </p>
      </div>
    </div>
  );
}
