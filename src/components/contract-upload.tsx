"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { toast } from "sonner";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf";

interface LeaseOption {
  id: string;
  label: string;
}

interface ContractUploadProps {
  propertyId: string;
  leaseOptions: LeaseOption[];
  onUploaded: () => void;
}

export function ContractUpload({ propertyId, leaseOptions, onUploaded }: ContractUploadProps) {
  const { householdId } = useUser();
  const [busy, setBusy] = useState(false);
  // 默认绑定到第一个生效租约（如有），否则绑到房源
  const [target, setTarget] = useState<string>(
    leaseOptions[0] ? `lease:${leaseOptions[0].id}` : `property:${propertyId}`
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!householdId) {
      toast.error("尚未确定家庭组，请刷新页面重试");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`文件超过 10MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
      return;
    }

    setBusy(true);
    const supabase = createClient();

    try {
      const [entityType, entityId] = target.split(":");
      const safeName = file.name.replace(/[^\w.\-一-龥]/g, "_");
      const objectPath = `${householdId}/${entityId}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("contracts")
        .upload(objectPath, file, { upsert: false, contentType: file.type });
      if (upErr) {
        if (upErr.message?.toLowerCase().includes("bucket") && upErr.message?.toLowerCase().includes("not found")) {
          toast.error("尚未创建 Storage bucket “contracts”，请按指引在 Supabase 配置后再试");
        } else {
          toast.error(`上传失败：${upErr.message}`);
        }
        return;
      }

      const { error: insertErr } = await supabase.from("attachments").insert({
        household_id: householdId,
        entity_type: entityType,
        entity_id: entityId,
        file_name: file.name,
        file_url: objectPath,
        file_size: file.size,
        mime_type: file.type || null,
      });
      if (insertErr) {
        toast.error(`保存附件记录失败：${insertErr.message}`);
        return;
      }

      toast.success("上传成功");
      onUploaded();
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" />
        <span>支持 PDF / 图片，单个文件最大 10MB</span>
      </div>

      {leaseOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">归属：</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {leaseOptions.map((l) => (
                <SelectItem key={l.id} value={`lease:${l.id}`} className="text-xs">
                  租约：{l.label}
                </SelectItem>
              ))}
              <SelectItem value={`property:${propertyId}`} className="text-xs">
                房源（不绑定具体租约）
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
        {busy ? "上传中…" : "选择文件并上传"}
      </Button>
    </div>
  );
}
