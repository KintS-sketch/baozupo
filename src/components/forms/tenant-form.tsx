"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Camera, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isValidPhone } from "@/lib/format";
import { toast } from "sonner";
import type { Tenant } from "@/types";
import type { AiRecognizeIdCardResponse } from "@/types/ai";

const schema = z.object({
  name: z.string().min(1, "请输入姓名"),
  phone: z.string().min(1, "请输入手机号").refine(isValidPhone, "请输入有效的中国大陆手机号"),
  id_type: z.enum(["id_card", "passport", "other"]),
  id_number: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z
    .string()
    .optional()
    .refine((v) => !v || isValidPhone(v), "请输入有效的手机号"),
  notes: z.string().optional(),
});

export type TenantFormValues = z.infer<typeof schema>;

interface TenantFormProps {
  defaultValues?: Partial<Tenant>;
  onSubmit: (values: TenantFormValues) => Promise<void>;
  onCancel: () => void;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_MB = 5;

/** 把 File 转成 base64（不含 data: 前缀） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:image/jpeg;base64,XXX → 取逗号后部分
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function TenantForm({ defaultValues, onSubmit, onCancel }: TenantFormProps) {
  const form = useForm<TenantFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      phone: defaultValues?.phone ?? "",
      id_type: defaultValues?.id_type ?? "id_card",
      id_number: defaultValues?.id_number ?? "",
      emergency_contact_name: defaultValues?.emergency_contact_name ?? "",
      emergency_contact_phone: defaultValues?.emergency_contact_phone ?? "",
      notes: defaultValues?.notes ?? "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  const handleIdCardFile = async (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("仅支持 JPG / PNG / WebP / GIF 格式");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`图片过大，请上传 ${MAX_IMAGE_MB}MB 以内的照片`);
      return;
    }

    setScanning(true);
    const t = toast.loading("AI 正在识别身份证...");
    try {
      const image_base64 = await fileToBase64(file);
      const res = await fetch("/api/ai/recognize-id-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64, media_type: file.type }),
      });
      const json = (await res.json()) as AiRecognizeIdCardResponse;
      toast.dismiss(t);

      if (!json.success || !json.data) {
        toast.error(json.error ?? "识别失败，请重试或手动填写");
        return;
      }

      const { name, id_number, confidence } = json.data;
      let filled = 0;
      if (name) {
        form.setValue("name", name, { shouldValidate: true });
        filled++;
      }
      if (id_number) {
        form.setValue("id_number", id_number, { shouldValidate: true });
        form.setValue("id_type", "id_card", { shouldValidate: true });
        filled++;
      }

      if (filled === 0) {
        toast.warning("没识别到关键字段，请手动填写");
      } else if (confidence < 0.6) {
        toast.warning(`已填 ${filled} 项，但识别置信度较低，请核对一遍`);
      } else {
        toast.success(`已自动填入 ${filled} 项，请核对`);
      }
    } catch (err) {
      toast.dismiss(t);
      const msg = err instanceof Error ? err.message : "网络异常，请重试";
      toast.error(msg);
    } finally {
      setScanning(false);
      // 重置 input，使重复选同一张图也能触发
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* AI 拍身份证识别按钮（仅新增时显示） */}
        {!defaultValues?.id && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="font-medium">拍身份证，自动填写</span>
              <span className="text-xs text-muted-foreground">省去手动输入</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleIdCardFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full bg-white"
              disabled={scanning || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
            >
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}
              {scanning ? "识别中..." : "拍照 / 从相册选身份证"}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>姓名 *</FormLabel>
                <FormControl>
                  <Input placeholder="张三" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>手机号 *</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="13800138000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="id_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>证件类型</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="id_card">身份证</SelectItem>
                    <SelectItem value="passport">护照</SelectItem>
                    <SelectItem value="other">其他证件</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="id_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>证件号码</FormLabel>
                <FormControl>
                  {/* TODO(Phase 2): 此字段应加密传输和存储，列表页仅展示脱敏后内容 */}
                  <Input placeholder="仅用于存档，不会公开展示" {...field} />
                </FormControl>
                <FormDescription>证件号仅内部存档使用</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="emergency_contact_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>紧急联系人姓名</FormLabel>
                <FormControl>
                  <Input placeholder="李四" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="emergency_contact_phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>紧急联系人电话</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="13900139000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注</FormLabel>
              <FormControl>
                <Textarea placeholder="其他说明..." rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {defaultValues?.id ? "保存修改" : "添加租客"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
