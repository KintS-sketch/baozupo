"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  Mail,
  Phone,
  Sparkles,
  X,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AuthMethod = "phone" | "email";

// ====================================================================
// PWA 登录页
//
// 设计：
//   - 手机号 tab：OTP 验证码登录（无密码，自动注册）
//   - 邮箱 tab：传统 邮箱 + 密码 登录（不发验证码）
//   - 注册新账号：点「立即注册」打开浮层 → 邮箱 + 验证码 + 设置密码 + 重复密码
//   - 输入框 / 按钮统一 h-11
// ====================================================================
export default function LoginPage() {
  const [method, setMethod] = useState<AuthMethod>("phone");

  // 手机号验证码
  const [phone, setPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneOtpSending, setPhoneOtpSending] = useState(false);
  const [phoneOtpCooldown, setPhoneOtpCooldown] = useState(0);

  // 邮箱密码登录
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // 注册弹窗
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerOtp, setRegisterOtp] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerOtpSending, setRegisterOtpSending] = useState(false);
  const [registerOtpCooldown, setRegisterOtpCooldown] = useState(0);

  const cooldownTimer = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  // 统一倒计时
  useEffect(() => {
    if (phoneOtpCooldown <= 0 && registerOtpCooldown <= 0) return;
    cooldownTimer.current = setTimeout(() => {
      setPhoneOtpCooldown((s) => (s > 0 ? s - 1 : 0));
      setRegisterOtpCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, [phoneOtpCooldown, registerOtpCooldown]);

  // ============ 手机号验证码 ============
  const handleSendPhoneOtp = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error("请输入正确的 11 位手机号");
      return;
    }
    setPhoneOtpSending(true);
    try {
      const res = await fetch("/api/auth/send-sms-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "login" }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        toast.error(json.error ?? "发送失败");
        return;
      }
      toast.success("验证码已发送，请查收短信");
      setPhoneOtpCooldown(60);
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setPhoneOtpSending(false);
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error("请输入正确的 11 位手机号");
      return;
    }
    if (!/^\d{6}$/.test(phoneOtp)) {
      toast.error("验证码需为 6 位数字");
      return;
    }
    setPhoneLoading(true);
    try {
      const res = await fetch("/api/auth/verify-sms-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: phoneOtp }),
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
      setPhoneLoading(false);
    }
  };

  // ============ 邮箱 + 密码 登录 ============
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("请输入正确的邮箱");
      return;
    }
    if (!password) {
      toast.error("请输入密码");
      return;
    }
    setEmailLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("邮箱或密码错误");
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success("登录成功");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setEmailLoading(false);
    }
  };

  // ============ 注册：邮箱 + 验证码 + 密码 ============
  const handleSendRegisterOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerEmail)) {
      toast.error("请输入正确的邮箱");
      return;
    }
    setRegisterOtpSending(true);
    try {
      const res = await fetch("/api/auth/send-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registerEmail, purpose: "register" }),
      });
      const json = (await res.json()) as { success: boolean; error?: string; needs_config?: boolean };
      if (!json.success) {
        if (json.needs_config) {
          toast.error("邮箱验证码功能尚未启用，请用手机号注册");
        } else {
          toast.error(json.error ?? "发送失败");
        }
        return;
      }
      toast.success("验证码已发送，请查收邮箱（含垃圾邮件夹）");
      setRegisterOtpCooldown(60);
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setRegisterOtpSending(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerEmail)) {
      toast.error("请输入正确的邮箱");
      return;
    }
    if (!/^\d{6}$/.test(registerOtp)) {
      toast.error("验证码需为 6 位数字");
      return;
    }
    if (registerPassword.length < 6) {
      toast.error("密码至少需要 6 位");
      return;
    }
    if (registerPassword !== registerPasswordConfirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    setRegisterLoading(true);
    try {
      const res = await fetch("/api/auth/email-otp-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerEmail,
          code: registerOtp,
          password: registerPassword,
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        access_token?: string;
        refresh_token?: string;
      };
      if (!json.success || !json.access_token || !json.refresh_token) {
        toast.error(json.error ?? "注册失败");
        return;
      }
      const supabase = createClient();
      const { error: setErr } = await supabase.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (setErr) {
        toast.error("会话建立失败：" + setErr.message);
        return;
      }
      toast.success("🎉 注册成功，欢迎使用养房 Tend！");
      setRegisterOpen(false);
      router.push("/");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setRegisterLoading(false);
    }
  };

  // ============ 渲染 ============
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo + Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary mb-4 shadow-soft-md">
            <BrandMark size={36} />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">养房</h1>
            <span className="text-sm text-muted-faint tracking-widest font-medium">TEND</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">拍一下就出账单，到期主动提醒</p>
        </div>

        {/* 方式切换 tab */}
        <div className="flex gap-1 mb-4 p-1.5 rounded-xl bg-muted">
          <button
            type="button"
            onClick={() => setMethod("phone")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-lg transition-all",
              method === "phone"
                ? "bg-white text-primary font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Phone className="h-4 w-4" /> 手机号
          </button>
          <button
            type="button"
            onClick={() => setMethod("email")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-lg transition-all",
              method === "email"
                ? "bg-white text-primary font-semibold shadow-sm"
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
                <form onSubmit={handlePhoneSubmit} className="space-y-4">
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
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone-otp">短信验证码</Label>
                    <div className="flex gap-2">
                      <Input
                        id="phone-otp"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 位数字"
                        value={phoneOtp}
                        onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ""))}
                        autoComplete="one-time-code"
                        required
                        className="h-11 flex-1 font-mono tracking-widest text-base"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSendPhoneOtp}
                        disabled={phoneOtpSending || phoneOtpCooldown > 0 || phone.length !== 11}
                        className="shrink-0 w-28 h-11"
                      >
                        {phoneOtpSending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        {phoneOtpCooldown > 0 ? `${phoneOtpCooldown}s` : "获取验证码"}
                      </Button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={phoneLoading}>
                    {phoneLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>邮箱登录</CardTitle>
                    <CardDescription className="mt-0.5">
                      用注册时设置的密码登录
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleEmailLogin} className="space-y-4">
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
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">密码</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="至少 6 位"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-11 text-base"
                    />
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={emailLoading}>
                    {emailLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    登录
                  </Button>
                </form>
                <div className="mt-4 pt-4 border-t border-border/60 text-center text-sm">
                  <span className="text-muted-foreground">还没有账号？</span>{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterEmail(email);
                      setRegisterOpen(true);
                    }}
                    className="text-primary hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> 立即注册新账号
                  </button>
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

      {/* 注册独立浮层 —— 视觉上跟登录卡片区分开 */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="sm:max-w-md bg-gradient-to-br from-primary-soft/60 via-background to-background border-primary/20">
          <DialogHeader>
            <div className="flex items-center justify-center mb-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-soft-md">
                <Sparkles className="h-7 w-7" />
              </div>
            </div>
            <DialogTitle className="text-center text-xl">注册新账号</DialogTitle>
            <DialogDescription className="text-center">
              邮箱验证后设置密码，下次直接邮箱+密码登录
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5 mt-2">
            <div className="space-y-2">
              <Label htmlFor="register-email">邮箱</Label>
              <Input
                id="register-email"
                type="email"
                placeholder="your@email.com"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                autoComplete="email"
                required
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-otp">邮箱验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="register-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位数字"
                  value={registerOtp}
                  onChange={(e) => setRegisterOtp(e.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code"
                  required
                  className="h-11 flex-1 font-mono tracking-widest text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendRegisterOtp}
                  disabled={registerOtpSending || registerOtpCooldown > 0 || !registerEmail}
                  className="shrink-0 w-28 h-11"
                >
                  {registerOtpSending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  {registerOtpCooldown > 0 ? `${registerOtpCooldown}s` : "获取验证码"}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-password">设置密码</Label>
              <Input
                id="register-password"
                type="password"
                placeholder="至少 6 位"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-password-confirm">重复密码</Label>
              <Input
                id="register-password-confirm"
                type="password"
                placeholder="再输一次密码"
                value={registerPasswordConfirm}
                onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="h-11 text-base"
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={registerLoading}>
              {registerLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Lock className="mr-2 h-4 w-4" /> 提交注册
            </Button>
            <button
              type="button"
              onClick={() => setRegisterOpen(false)}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5 inline mr-1" /> 取消，回到登录
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
