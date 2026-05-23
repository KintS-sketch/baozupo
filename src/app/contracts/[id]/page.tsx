"use client";

import { useState, useEffect, use, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SignProgress } from "@/components/contracts/sign-progress";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { Loader2, Download, RefreshCw, CheckCircle2, Clock, FileSignature } from "lucide-react";
import { toast } from "sonner";
import type { Contract, SignerRole } from "@/types/contract";

interface PublicSigner {
  id: string;
  role: SignerRole;
  sign_order: number;
  name: string;
  phone: string;
  signed_at: string | null;
  sign_ip: string | null;
  sms_verified_at: string | null;
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  draft: { text: "等待房东签字", color: "text-warning" },
  partial: { text: "等待其他方签字", color: "text-warning" },
  signed: { text: "已完成签署", color: "text-success" },
  void: { text: "已撤销", color: "text-muted-foreground" },
  expired: { text: "已过期", color: "text-muted-foreground" },
};

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [contract, setContract] = useState<Contract | null>(null);
  const [signers, setSigners] = useState<PublicSigner[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/contracts/${id}`);
      const j = await resp.json();
      if (j.success) {
        setContract(j.contract);
        setSigners(j.signers ?? []);
      } else {
        toast.error(j.error ?? "加载失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        合同不存在
      </div>
    );
  }

  const status = STATUS_LABEL[contract.status] ?? { text: contract.status, color: "" };
  const isSigned = contract.status === "signed";
  const isPending = contract.status === "draft" || contract.status === "partial";

  return (
    <div className="max-w-2xl mx-auto p-4 pb-12 space-y-4">
      {/* 顶部状态 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">电子合同</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          {isSigned ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : isPending ? (
            <Clock className="h-5 w-5 text-warning" />
          ) : null}
          <span className={`font-semibold ${status.color}`}>{status.text}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          合同 ID：<span className="num">{contract.id.slice(0, 8)}…</span>
        </p>
        {contract.expires_at && isPending && (
          <p className="text-xs text-muted-foreground">
            签字截止：{contract.expires_at.slice(0, 10)}
          </p>
        )}
      </Card>

      {/* 签字进度 */}
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">签署进度</p>
        <SignProgress
          signers={signers.map((s) => ({
            role: s.role,
            name: s.name,
            signed_at: s.signed_at,
            sign_ip: s.sign_ip,
          }))}
        />
      </Card>

      {/* 完成后展示哈希 + 下载 */}
      {isSigned && (
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-sm">合同已生效</p>
          <p className="text-xs text-muted-foreground">
            最终 PDF SHA256：
          </p>
          <p className="text-xs font-mono break-all bg-secondary p-2 rounded">
            {contract.pdf_hash_sha256 ?? "—"}
          </p>
          <p className="text-xs text-muted-faint">
            依据《电子签名法》第 13/14 条，本合同电子签名与手写签名具有同等法律效力。
          </p>
          <Button asChild className="w-full" size="lg">
            <a
              href={`/api/contracts/${id}/pdf?v=final`}
              target="_blank"
              rel="noopener"
            >
              <Download className="h-4 w-4 mr-2" />
              下载合同 PDF
            </a>
          </Button>
        </Card>
      )}

      {/* PDF 预览 */}
      <PdfPreview src={`/api/contracts/${id}/pdf?v=${isSigned ? "final" : "initial"}`} />
    </div>
  );
}
