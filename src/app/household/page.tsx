"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, UserPlus, Users, Copy, Check, Crown, Trash2, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { useUser } from "@/contexts/user-context";
import {
  createInvite,
  listActiveInvites,
  listMembers,
  removeMember,
  revokeInvite,
  type HouseholdMemberRow,
  type InviteRow,
} from "@/lib/household-service";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

export default function HouseholdPage() {
  const { user, householdId, loading: userLoading } = useUser();
  const [members, setMembers] = useState<HouseholdMemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const myMember = members.find((m) => m.user_id === user?.id);
  const isOwner = myMember?.role === "owner";

  const fetchData = async () => {
    if (!householdId) return;
    const [m, i] = await Promise.all([listMembers(householdId), listActiveInvites(householdId)]);
    setMembers(m);
    setInvites(i);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleGenerateCode = async () => {
    if (!householdId || !user) return;
    setGenerating(true);
    const result = await createInvite(householdId, user.id);
    setGenerating(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`邀请码 ${result.code} 已生成`);
    fetchData();
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  };

  const handleRevoke = async (inviteId: string) => {
    const r = await revokeInvite(inviteId);
    if (!r.ok) {
      toast.error(r.error ?? "撤销失败");
      return;
    }
    toast.success("已撤销");
    fetchData();
  };

  const handleRemoveMember = async () => {
    if (!removingMemberId) return;
    const r = await removeMember(removingMemberId);
    setRemovingMemberId(null);
    if (!r.ok) {
      toast.error(r.error ?? "移除失败");
      return;
    }
    toast.success("成员已移除");
    fetchData();
  };

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2 md:hidden"
        >
          <ArrowLeft className="h-3 w-3" />
          返回设置
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">家庭组</h1>
        <p className="text-sm text-muted-foreground mt-1">
          邀请家人共管房源 · 当前 {members.length} 位成员
        </p>
      </div>

      {/* 邀请区（owner 可见） */}
      {isOwner ? (
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold">邀请家人加入</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  生成邀请码，发给家人。24 小时有效，每个码可用 1 次。
                </p>

                {invites.length === 0 ? (
                  <Button
                    onClick={handleGenerateCode}
                    disabled={generating}
                    className="mt-3"
                    size="sm"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-1" />
                    )}
                    生成邀请码
                  </Button>
                ) : (
                  <div className="mt-3 space-y-2">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-2 p-3 rounded-xl bg-secondary"
                      >
                        <span className="num text-xl font-bold tracking-[0.2em] flex-1 text-foreground">
                          {inv.code}
                        </span>
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          有效至 {new Date(inv.expires_at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" })}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => handleCopyCode(inv.code)}
                        >
                          {copiedCode === inv.code ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              复制
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground"
                          onClick={() => handleRevoke(inv.id)}
                          aria-label="撤销邀请码"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      onClick={handleGenerateCode}
                      disabled={generating}
                      variant="outline"
                      size="sm"
                    >
                      {generating ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4 mr-1" />
                      )}
                      再生成一个
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <UserPlus className="h-5 w-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                只有家庭组的所有者可以邀请新成员。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 成员列表 */}
      <section>
        <h2 className="text-base font-semibold mb-3">成员</h2>
        {members.length === 0 ? (
          <EmptyState icon={Users} title="暂无成员" />
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {members.map((m) => {
                const isMe = m.user_id === user?.id;
                const isMemberOwner = m.role === "owner";
                const display =
                  m.display_name ??
                  (isMe ? user?.email ?? "我" : `成员 · ${m.user_id.slice(0, 8)}`);

                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary font-semibold">
                      {display.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {display}
                          {isMe && <span className="text-muted-foreground ml-1">（我）</span>}
                        </span>
                        {isMemberOwner ? (
                          <Badge variant="default" className="gap-1">
                            <Crown className="h-3 w-3" />
                            房主
                          </Badge>
                        ) : (
                          <Badge variant="muted">成员</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        加入于 {formatDate(m.created_at)}
                      </p>
                    </div>
                    {isOwner && !isMemberOwner && !isMe && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:bg-destructive-soft hover:text-destructive"
                        onClick={() => setRemovingMemberId(m.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 加入其他家庭组（链接） */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <Link
            href="/household/join"
            className="flex items-center justify-between gap-3 hover:bg-secondary/40 rounded-md transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">用邀请码加入其他家庭组</p>
                <p className="text-xs text-muted-foreground">如果家人邀请了你</p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">›</span>
          </Link>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!removingMemberId}
        onOpenChange={(o) => { if (!o) setRemovingMemberId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除该成员？</AlertDialogTitle>
            <AlertDialogDescription>
              移除后该成员将无法访问家庭组的房源、租客和账单。如需重新加入，需要再次邀请。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemoveMember}
            >
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
