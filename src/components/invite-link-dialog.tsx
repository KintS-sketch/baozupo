"use client";

import { useState } from "react";
import { Copy, Link as LinkIcon, Share2, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface InviteLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用途：默认租客自填，可扩展中介 */
  purpose?: "tenant_register" | "agent_register";
}

/**
 * 一键生成给租客/中介自填的公开链接。
 * 反馈 #6：房东不用手动录入，把链接发过去对方自己填。
 */
export function InviteLinkDialog({
  open,
  onOpenChange,
  purpose = "tenant_register",
}: InviteLinkDialogProps) {
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const purposeLabel = purpose === "agent_register" ? "中介" : "租客";

  const handleGenerate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose }),
      });
      const json = (await res.json()) as { success?: boolean; token?: string; error?: string };
      if (!res.ok || !json.success || !json.token) {
        toast.error(json.error ?? "生成失败");
        return;
      }
      // 用当前 origin 拼链接，部署在哪个域名都能用
      const origin =
        typeof window !== "undefined" ? window.location.origin : "https://tendapp.cn";
      setUrl(`${origin}/invite/${json.token}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "网络异常");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("链接已复制，去微信粘贴发给对方吧");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("复制失败，请手动选中复制");
    }
  };

  const handleShare = async () => {
    if (!url) return;
    // 移动端原生分享面板
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: `${purposeLabel}信息登记`,
          text: `请点开链接填写${purposeLabel}信息（养房 Tend）`,
          url,
        });
      } catch {
        // 用户取消等，忽略
      }
    } else {
      handleCopy();
    }
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      // 关闭弹窗时重置状态
      setUrl(null);
      setCopied(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-primary" />
            生成{purposeLabel}填表链接
          </DialogTitle>
          <DialogDescription>
            生成一次性链接发给{purposeLabel}，对方自己填资料就行，省去你手动录入。
            链接 7 天后失效，提交一次后自动作废。
          </DialogDescription>
        </DialogHeader>

        {!url ? (
          <div className="py-4">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={creating}
              className="w-full"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LinkIcon className="mr-2 h-4 w-4" />
              )}
              {creating ? "生成中..." : "生成链接"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                链接已生成，有效期 7 天
              </div>
              <Input
                readOnly
                value={url}
                className="text-xs font-mono bg-white"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                className="w-full"
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                {copied ? "已复制" : "复制"}
              </Button>
              <Button type="button" onClick={handleShare} className="w-full">
                <Share2 className="mr-1 h-3.5 w-3.5" />
                分享给{purposeLabel}
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              提示：对方填完会出现在「邀请箱」里，你点「采纳」就能自动建租客记录。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
