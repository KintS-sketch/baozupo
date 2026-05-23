"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SignatureCanvas } from "@/components/contracts/signature-canvas";
import { SmsCodeInput } from "@/components/contracts/sms-code-input";
import { PdfPreview } from "@/components/contracts/pdf-preview";
import { toast } from "sonner";
import { Loader2, FileSignature, ChevronLeft } from "lucide-react";
import type { Contract } from "@/types/contract";

export default function LandlordSignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/contracts/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setContract(j.contract);
        else toast.error(j.error);
        setLoading(false);
      })
      .catch((e) => {
        toast.error(e.message ?? "加载失败");
        setLoading(false);
      });
  }, [id]);

  const submit = async () => {
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
          contract_id: id,
          role: "landlord",
          sms_code: smsCode,
          signature_image: signature,
        }),
      });
      const j = await resp.json();
      if (!j.success) {
        toast.error(j.error ?? "签字失败");
        if (typeof j.attempts_left === "number") {
          toast.error(`剩余尝试次数：${j.attempts_left}`);
        }
        return;
      }
      if (j.contract_status === "signed") {
        toast.success("合同已全部签字完成");
      } else {
        toast.success("签字完成，已通知租客签字");
      }
      router.push(`/contracts/${id}`);
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

  if (!contract) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        合同不存在或无权访问
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-12 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/contracts/${id}`)}
          className="-ml-2"
        >
          <ChevronLeft className="h-4 w-4" />
          返回
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <FileSignature className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">房东签字</h1>
      </div>

      <PdfPreview src={`/api/contracts/${id}/pdf?v=initial`} />

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
            contractId={id}
            role="landlord"
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
