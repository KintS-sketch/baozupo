"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface SmsCodeInputProps {
  contractId: string;
  role: "landlord" | "agent" | "tenant";
  publicToken?: string;
  /** 6 位数字时回调 */
  onCodeReady: (code: string) => void;
  disabled?: boolean;
}

export function SmsCodeInput({
  contractId,
  role,
  publicToken,
  onCodeReady,
  disabled,
}: SmsCodeInputProps) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const send = async () => {
    setSending(true);
    try {
      const resp = await fetch("/api/contracts/sms-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: contractId,
          role,
          public_token: publicToken,
        }),
      });
      const j = await resp.json();
      if (!j.success) {
        toast.error(j.error ?? "发送失败");
        // 服务端返回了 retry_after_seconds 也启动 cooldown
        if (typeof j.retry_after_seconds === "number") {
          setCooldown(j.retry_after_seconds);
        }
        return;
      }
      setCooldown(j.cooldown_seconds ?? 60);
      toast.success("验证码已发送，5 分钟内有效");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const handleChange = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, 6);
    setCode(v);
    if (v.length === 6) onCodeReady(v);
    else onCodeReady("");
  };

  return (
    <div className="flex gap-2">
      <Input
        value={code}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="6 位短信验证码"
        inputMode="numeric"
        maxLength={6}
        disabled={disabled}
        autoComplete="one-time-code"
      />
      <Button
        type="button"
        variant="outline"
        onClick={send}
        disabled={disabled || sending || cooldown > 0}
        className="shrink-0 min-w-[110px]"
      >
        {cooldown > 0 ? `${cooldown}s 后重发` : sending ? "发送中…" : "发送验证码"}
      </Button>
    </div>
  );
}
