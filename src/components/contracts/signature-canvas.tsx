"use client";

import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

interface SignatureCanvasProps {
  /** 用户绘制完成后回传 PNG data URL；清空时回传 null */
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  label?: string;
}

export function SignatureCanvas({ onChange, disabled, label }: SignatureCanvasProps) {
  const padRef = useRef<SignaturePad>(null);
  const [hasSigned, setHasSigned] = useState(false);

  const handleEnd = () => {
    const pad = padRef.current;
    if (!pad) return;
    if (pad.isEmpty()) {
      setHasSigned(false);
      onChange(null);
      return;
    }
    setHasSigned(true);
    // toDataURL("image/png") 包含 "data:image/png;base64," 前缀
    onChange(pad.getCanvas().toDataURL("image/png"));
  };

  const clear = () => {
    padRef.current?.clear();
    setHasSigned(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-semibold">{label}</p>}
      <div
        className={`border-2 rounded-lg bg-white transition-colors touch-none select-none ${
          hasSigned ? "border-primary" : "border-dashed border-border"
        }`}
      >
        <SignaturePad
          ref={padRef}
          canvasProps={{
            className: "w-full h-40 rounded-lg",
            // 关键：避免移动端拖动页面而不是绘画
            style: { touchAction: "none" },
          }}
          penColor="#1a1a1a"
          onEnd={handleEnd}
          minDistance={1}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={hasSigned ? "text-primary inline-flex items-center gap-1" : "text-muted-foreground"}>
          {hasSigned ? (
            <>
              <Check className="h-3 w-3" />
              已签字
            </>
          ) : (
            "请在上方手写签字"
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || !hasSigned}
          className="h-7"
        >
          <Eraser className="h-3 w-3 mr-1" />
          清除重签
        </Button>
      </div>
    </div>
  );
}
