"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { AiPaymentRecognitionResult, AiRecognizePaymentResponse } from "@/types/ai";

interface PaymentScreenshotUploadProps {
  billId: string;
  onRecognized: (result: AiPaymentRecognitionResult) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 5 * 1024 * 1024;

export function PaymentScreenshotUpload({
  billId,
  onRecognized,
  disabled = false,
}: PaymentScreenshotUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);

  const handlePick = () => {
    if (loading || disabled) return;
    inputRef.current?.click();
  };

  const handleClear = () => {
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setFilename(null);
    setConfidence(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("图片过大，请上传 5MB 以内的截图");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setFilename(file.name);
    setConfidence(null);

    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const resp = await fetch("/api/ai/recognize-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bill_id: billId,
          image_base64: base64,
          media_type: file.type,
        }),
      });

      const json = (await resp.json()) as AiRecognizePaymentResponse;
      if (!resp.ok || !json.success || !json.data) {
        toast.error(json.error ?? "识别失败，请手动填写");
        return;
      }

      setConfidence(json.data.confidence);
      onRecognized(json.data);
      const pct = Math.round(json.data.confidence * 100);
      toast.success(`已识别 · 置信度 ${pct}%`);
    } catch (err) {
      console.error(err);
      toast.error("识别请求失败，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {!previewUrl ? (
        <button
          type="button"
          onClick={handlePick}
          disabled={loading || disabled}
          className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-primary disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          上传付款截图，AI 自动识别
        </button>
      ) : (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={filename ?? "screenshot"}
            className="h-20 w-20 rounded-md object-cover border"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{filename}</p>
            {loading ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI 识别中…
              </p>
            ) : confidence !== null ? (
              <p className="mt-1 text-xs text-green-700">
                ✓ 已识别 · 置信度 {Math.round(confidence * 100)}%
                {confidence < 0.6 && <span className="text-orange-600">（请核对结果）</span>}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">已选择文件</p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handlePick}
                disabled={loading}
              >
                <Upload className="mr-1 h-3 w-3" />
                重新选择
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={handleClear}
                disabled={loading}
              >
                <X className="mr-1 h-3 w-3" />
                清除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader 返回非字符串"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
