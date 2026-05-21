"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Inbox,
  Link as LinkIcon,
  CheckCircle2,
  Clock,
  X,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

interface InviteRow {
  id: string;
  token: string;
  purpose: "tenant_register" | "agent_register";
  prefilled_data: Record<string, unknown> | null;
  submitted_data: SubmittedData | null;
  submitted_at: string | null;
  accepted_at: string | null;
  accepted_tenant_id: string | null;
  expires_at: string;
  created_at: string;
}

interface SubmittedData {
  name?: string;
  phone?: string;
  id_number?: string;
  wechat_id?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
  // 中介模式下，submit 时一并存中介信息（采纳时一起带到租约表单的预填）
  agent_name?: string;
  agent_phone?: string;
  // 反馈 #12: dualRole 模式下填表人自选的角色
  chosen_role?: "tenant" | "agent";
}

export default function InvitesPage() {
  const { householdId, loading: userLoading } = useUser();
  const router = useRouter();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [previewing, setPreviewing] = useState<InviteRow | null>(null);
  const [accepting, setAccepting] = useState(false);

  const supabase = createClient();

  const fetchInvites = async () => {
    if (!householdId) return;
    const { data } = await supabase
      .from("form_invites")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(50);
    setInvites((data ?? []) as InviteRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const handleAccept = async (invite: InviteRow) => {
    if (!householdId || !invite.submitted_data) return;
    const s = invite.submitted_data;
    if (!s.name || !s.phone) {
      toast.error("提交数据不完整");
      return;
    }
    setAccepting(true);
    try {
      // 创建租客（含微信号）
      const { data: tenant, error: tErr } = await supabase
        .from("tenants")
        .insert({
          household_id: householdId,
          name: s.name,
          phone: s.phone,
          id_type: "id_card",
          id_number: s.id_number ?? null,
          wechat_id: s.wechat_id ?? null,
          emergency_contact_name: s.emergency_contact_name ?? null,
          emergency_contact_phone: s.emergency_contact_phone ?? null,
          notes: s.notes ?? null,
        })
        .select("id")
        .single();

      if (tErr || !tenant) {
        toast.error("创建租客失败：" + (tErr?.message ?? "未知"));
        return;
      }

      // 标记 invite 已采纳
      await supabase
        .from("form_invites")
        .update({
          accepted_at: new Date().toISOString(),
          accepted_tenant_id: tenant.id,
        })
        .eq("id", invite.id);

      // 反馈 #12: 采纳后引导建租约，根据 chosen_role/purpose 决定直租 vs 中介
      const isAgent =
        s.chosen_role === "agent" || invite.purpose === "agent_register";
      toast.success(
        isAgent
          ? "已采纳，去租约页建一个【通过中介】的租约吧"
          : "已采纳，去租约页建一个【直租】的租约吧"
      );
      setPreviewing(null);
      // 跳到租约页，让房东点新增租约（已选择已有租客 = 新建的这个 tenant）
      router.push(`/leases?prefill_tenant=${tenant.id}&rental_source=${isAgent ? "agent" : "direct"}${
        isAgent && s.agent_name ? `&agent_name=${encodeURIComponent(s.agent_name)}` : ""
      }${
        isAgent && s.agent_phone ? `&agent_phone=${encodeURIComponent(s.agent_phone)}` : ""
      }`);
    } finally {
      setAccepting(false);
    }
  };

  const handleDismiss = async (invite: InviteRow) => {
    // 不创建租客，直接标记 accepted_at（让链接和提交失效）
    await supabase
      .from("form_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    toast.info("已忽略");
    setPreviewing(null);
    fetchInvites();
  };

  const copyLink = (token: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://tendapp.cn";
    const url = `${origin}/invite/${token}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("链接已复制"))
      .catch(() => toast.error("复制失败"));
  };

  // 三组：等你处理（已提交未采纳）/ 等对方填（已生成未提交未过期）/ 历史（已采纳或过期）
  const now = Date.now();
  const pending = invites.filter((i) => i.submitted_at && !i.accepted_at);
  const waiting = invites.filter(
    (i) => !i.submitted_at && !i.accepted_at && new Date(i.expires_at).getTime() > now
  );
  const history = invites.filter(
    (i) => i.accepted_at || (!i.submitted_at && new Date(i.expires_at).getTime() <= now)
  );

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">邀请箱</h1>
          <p className="text-sm text-muted-foreground">
            生成链接让租客/中介自己填，省去手动录入
          </p>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>
          <LinkIcon className="h-4 w-4 mr-1" />
          生成链接
        </Button>
      </div>

      {invites.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="还没有邀请记录"
          description="点击右上角「生成链接」，把链接发给租客/中介，让他们自己填资料"
          action={
            <Button onClick={() => setGenerateOpen(true)}>
              <LinkIcon className="h-4 w-4 mr-1" />
              生成链接
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                等你处理（{pending.length}）
              </h2>
              <div className="space-y-2">
                {pending.map((inv) => (
                  <Card
                    key={inv.id}
                    className="cursor-pointer hover:border-primary/40"
                    onClick={() => setPreviewing(inv)}
                  >
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {inv.submitted_data?.name ?? "（未填姓名）"}
                          <span className="text-muted-foreground ml-2 font-normal">
                            {inv.submitted_data?.phone ?? ""}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          提交于 {inv.submitted_at ? formatDate(inv.submitted_at) : "—"}
                        </p>
                      </div>
                      <Badge variant="success">查看 / 采纳</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {waiting.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                等对方填（{waiting.length}）
              </h2>
              <div className="space-y-2">
                {waiting.map((inv) => (
                  <Card key={inv.id}>
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {inv.purpose === "agent_register" ? "中介" : "租客"} ·
                          创建于 {formatDate(inv.created_at)} · 失效于{" "}
                          {formatDate(inv.expires_at)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => copyLink(inv.token)}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        复制链接
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 text-muted-foreground">
                历史（{history.length}）
              </h2>
              <div className="space-y-2">
                {history.map((inv) => (
                  <Card key={inv.id} className="opacity-70">
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          {inv.submitted_data?.name ?? "（未填）"} · {inv.accepted_at ? "已采纳" : "已过期"}
                        </p>
                      </div>
                      {inv.accepted_at && (
                        <Badge variant="muted">
                          {formatDate(inv.accepted_at)}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 生成链接弹窗 */}
      <InviteLinkDialog
        open={generateOpen}
        onOpenChange={(open) => {
          setGenerateOpen(open);
          if (!open) fetchInvites(); // 关闭后刷新列表
        }}
      />

      {/* 详情/采纳弹窗 */}
      <Dialog
        open={!!previewing}
        onOpenChange={(open) => {
          if (!open) setPreviewing(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {previewing?.purpose === "agent_register" ? "中介代填资料" : "租客自填资料"}
            </DialogTitle>
          </DialogHeader>
          {previewing?.submitted_data && (
            <div className="space-y-3 text-sm">
              {/* 中介模式下，先显示中介信息 */}
              {previewing.purpose === "agent_register" && previewing.submitted_data.agent_name && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                  <p className="text-xs font-medium mb-2 text-foreground">中介信息</p>
                  <div className="grid grid-cols-[5rem_1fr] gap-y-1 text-xs">
                    <span className="text-muted-foreground">姓名</span>
                    <span className="font-medium">{previewing.submitted_data.agent_name}</span>
                    {previewing.submitted_data.agent_phone && (
                      <>
                        <span className="text-muted-foreground">电话</span>
                        <span>{previewing.submitted_data.agent_phone}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {previewing.purpose === "agent_register" && (
                <p className="text-xs text-muted-foreground -mb-1">— 租客信息 —</p>
              )}
              <div className="grid grid-cols-[5rem_1fr] gap-y-2">
                <span className="text-muted-foreground">姓名</span>
                <span className="font-medium">{previewing.submitted_data.name}</span>
                <span className="text-muted-foreground">手机号</span>
                <span>{previewing.submitted_data.phone}</span>
                {previewing.submitted_data.id_number && (
                  <>
                    <span className="text-muted-foreground">身份证号</span>
                    <span className="break-all">{previewing.submitted_data.id_number}</span>
                  </>
                )}
                {previewing.submitted_data.emergency_contact_name && (
                  <>
                    <span className="text-muted-foreground">紧急联系人</span>
                    <span>
                      {previewing.submitted_data.emergency_contact_name}
                      {previewing.submitted_data.emergency_contact_phone &&
                        ` · ${previewing.submitted_data.emergency_contact_phone}`}
                    </span>
                  </>
                )}
              </div>
              {previewing.submitted_data.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">备注</p>
                  <p className="text-xs bg-muted rounded p-2">
                    {previewing.submitted_data.notes}
                  </p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => previewing && handleDismiss(previewing)}
                  disabled={accepting}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  忽略
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => previewing && handleAccept(previewing)}
                  disabled={accepting}
                >
                  {accepting ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  )}
                  采纳到租客库
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
