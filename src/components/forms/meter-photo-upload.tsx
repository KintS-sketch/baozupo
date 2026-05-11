"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles, X, Camera, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  AiMeterRecognitionResult,
  AiRecognizeMeterResponse,
} from "@/types/ai";
import type { MeterType } from "@/types";

interface MeterPhotoUploadProps {
  hintType?: MeterType;
  onRecognized: (result: AiMeterRecognitionResult) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 5 * 1024 * 1024;

export function MeterPhotoUpload({
  hintType,
  onRecognized,
  disabled = false,
}: MeterPhotoUploadProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);

  const handlePickCamera = () => {
    if (loading || disabled) return;
    cameraInputRef.current?.click();
  };

  const handlePickGallery = () => {
    if (loading || disabled) return;
    galleryInputRef.current?.click();
  };

  const handleClear = () => {
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setFilename(null);
    setConfidence(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("图片过大，请上传 5MB 以内的照片");
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
      const resp = await fetch("/api/ai/recognize-meter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: base64,
          media_type: file.type,
          hint_type: hintType,
        }),
      });

      const json = (await resp.json()) as AiRecognizeMeterResponse;
      if (!resp.ok || !json.success || !json.data) {
        toast.error(json.error ?? "识别失败，请手动填写读数");
        return;
      }

      setConfidence(json.data.confidence);
      onRecognized(json.data);
      const pct = Math.round(json.data.confidence * 100);
      toast.success(`已识别读数 ${json.data.value} · 置信度 ${pct}%`);
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
        ref={cameraInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {!previewUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-primary mb-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-medium">AI 识别读数</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handlePickCamera}
              disabled={loading || disabled}
              className="flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg bg-white border border-primary/20 hover:bg-primary/5 hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              <Camera className="h-5 w-5 text-primary" />
              <span className="text-xs font-medium">现场拍照</span>
            </button>
            <button
              type="button"
              onClick={handlePickGallery}
              disabled={loading || disabled}
              className="flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg bg-white border border-primary/20 hover:bg-primary/5 hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              <ImageIcon className="h-5 w-5 text-primary" />
              <span className="text-xs font-medium">从相册选</span>
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed pt-0.5">
            💡 擦干表盘 · 正对字轮 · 光线充足 · 距离 10-20cm
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={filename ?? "meter photo"}
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
                {confidence < 0.6 && <span className="text-orange-600">（请核对读数）</span>}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">已选择照片</p>
            )}
            <div className="mt-2 flex gap-2 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handlePickCamera}
                disabled={loading}
              >
                <Camera className="mr-1 h-3 w-3" />
                重拍
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handlePickGallery}
                disabled={loading}
              >
                <ImageIcon className="mr-1 h-3 w-3" />
                换图
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
