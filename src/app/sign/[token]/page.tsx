"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SignatureCanvas } from "@/components/contracts/signature-canvas";
import { SmsCodeInput } from "@/components/contracts/sms-code-input";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { toast } from "sonner";
import { Loader2, FileSignature, CheckCircle2, Download } from "lucide-react";
import type { SignerRole } from "@/types/contract";

interface LookupResult {
  contractId: string;
  role: SignerRole;
  landlordName: string;
  yourName: string;
}

const ROLE_LABEL: Record<SignerRole, string> = {
  landlord: "房东",
  agent: "中介",
  tenant: "租客",
};

export default function PublicSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [info, setInfo] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneStatus, setDoneStatus] = useState<"partial" | "signed" | null>(null);

  useEffect(() => {
    fetch(`/api/sign-lookup?token=${token}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setInfo(j);
        else setError(j.error ?? "签字链接无效");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message ?? "网络错误");
        setLoading(false);
      });
  }, [token]);

  const submit = async () => {
    if (!info) return;
    if (!agreed) {
      toast.error("请先勾选「我已阅读并同意合同条款」");
      return;
    }
    if (!signature) {
      toast.error("请先手写签字");
      return;
    }
    if (smsCode.length !== 6) {
      toast.error("请输入 6 位短信验证码");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: info.contractId,
          role: info.role,
          public_token: token,
          sms_code: smsCode,
          signature_image: signature,
        }),
      });
      const j = await resp.json();
      if (!j.success) {
        toast.error(j.error ?? "签字失败");
        return;
      }
      setDone(true);
      setDoneStatus(j.contract_status === "signed" ? "signed" : "partial");
      toast.success("签字完成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold">无法签字</h1>
        <p className="text-sm text-muted-foreground">{error ?? "未知错误"}</p>
        <p className="text-xs text-muted-faint mt-4">
          如对此有疑问，请联系发起合同的房东。
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
        <h1 className="text-xl font-bold">签字完成</h1>
        <p className="text-sm text-muted-foreground">
          {doneStatus === "signed"
            ? "合同已全部签字完成，您可以下载完整合同 PDF。"
            : "您的签字已记录。其他方完成签字后您会收到完整合同短信通知。"}
        </p>
        {doneStatus === "signed" && (
          <Button asChild className="w-full">
            <a
              href={`/api/contracts/${info.contractId}/pdf?v=final&token=${token}`}
              target="_blank"
              rel="noopener"
            >
              <Download className="h-4 w-4 mr-2" />
              下载合同 PDF
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-12 space-y-4">
      {/* 品牌头 */}
      <div className="text-center mb-2 py-3 border-b border-border">
        <div className="flex items-center justify-center gap-2 text-primary mb-1">
          <FileSignature className="h-5 w-5" />
          <h1 className="text-lg font-bold">养房 Tend · 电子签约</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          房东「{info.landlordName}」邀请您（{ROLE_LABEL[info.role]} · {info.yourName}）签订租房合同
        </p>
      </div>

      <PdfPreview
        src={`/api/contracts/${info.contractId}/pdf?v=initial&token=${token}`}
      />

      <Card className="p-4 space-y-4">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={submitting}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            我已仔细阅读并同意合同全部条款。
            <span className="block text-xs text-muted-foreground mt-0.5">
              依据《电子签名法》第 13/14 条，电子签名与手写签名具有同等法律效力。
            </span>
          </span>
        </label>

        <SignatureCanvas
          onChange={setSignature}
          disabled={submitting}
          label="手写签名"
        />

        <div>
          <p className="text-sm font-semibold mb-2">短信验证</p>
          <SmsCodeInput
            contractId={info.contractId}
            role={info.role}
            publicToken={token}
            onCodeReady={setSmsCode}
            disabled={submitting}
          />
        </div>

        <Button
          onClick={submit}
          disabled={submitting || !agreed || !signature || smsCode.length !== 6}
          className="w-full"
          size="lg"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          确认签字
        </Button>
      </Card>
    </div>
  );
}
