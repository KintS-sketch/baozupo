"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useUser } from "@/contexts/user-context";
import { acceptInvite } from "@/lib/household-service";
import { toast } from "sonner";

export default function JoinHouseholdPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("请先登录");
      router.push("/login");
      return;
    }
    if (code.replace(/\s/g, "").length === 0) {
      toast.error("请输入邀请码");
      return;
    }
    setSubmitting(true);
    const result = await acceptInvite(code, user.id);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("已加入家庭组");
    // 强制刷新让 user-context 重新计算 householdId
    router.push("/household");
    router.refresh();
    setTimeout(() => window.location.reload(), 500);
  };

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto space-y-5">
      <div>
        <Link
          href="/household"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
        >
          <ArrowLeft className="h-3 w-3" />
          返回家庭组
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">加入家庭组</h1>
        <p className="text-sm text-muted-foreground mt-1">输入家人发给你的 6 位邀请码</p>
      </div>

      <Card>
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-col items-center text-center mb-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary mb-3">
              <Users className="h-7 w-7" />
            </div>
            <h2 className="text-base font-semibold">使用邀请码</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
              邀请码由 6 位字母数字组成，由家庭组房主在他的「家庭组」页面生成。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例：A2B3C4"
              autoComplete="off"
              autoFocus
              maxLength={12}
              spellCheck={false}
              className="num h-14 text-center text-2xl font-bold tracking-[0.5em] uppercase"
              disabled={submitting}
            />

            <Button type="submit" size="lg" className="w-full" disabled={submitting || userLoading}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              加入家庭组
            </Button>
          </form>

          <p className="mt-4 text-xs text-muted-foreground text-center">
            没有邀请码？请联系你的家人，他们可以在养房 App 的 设置 → 家庭组 中生成。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
