"use client";

import { use, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Camera, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { isValidPhone } from "@/lib/format";
import { toast } from "sonner";
import type { AiRecognizeIdCardResponse } from "@/types/ai";

const schema = z.object({
  name: z.string().min(1, "请输入姓名"),
  phone: z.string().refine(isValidPhone, "请输入有效的中国大陆手机号"),
  id_number: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z
    .string()
    .optional()
    .refine((v) => !v || isValidPhone(v), "请输入有效的手机号"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_MB = 5;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface InviteRow {
  id: string;
  household_id: string;
  purpose: "tenant_register" | "agent_register";
  prefilled_data: Record<string, unknown> | null;
  submitted_at: string | null;
  accepted_at: string | null;
  expires_at: string;
}

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteRow | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      id_number: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      notes: "",
    },
  });

  // 拉邀请信息（公开 RLS 策略允许 anon 通过 token 读单条）
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("form_invites")
        .select("id, household_id, purpose, prefilled_data, submitted_at, accepted_at, expires_at")
        .eq("token", token)
        .maybeSingle();

      if (error || !data) {
        setErrorMsg("链接不存在、已过期或已失效");
      } else if (data.submitted_at) {
        setErrorMsg("本链接已经提交过了，请联系房东确认");
      } else if (data.accepted_at) {
        setErrorMsg("本链接已失效");
      } else if (new Date(data.expires_at) < new Date()) {
        setErrorMsg("链接已过期");
      } else {
        setInvite(data as InviteRow);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (values: FormValues) => {
    try {
      const res = await fetch(`/api/invites/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "提交失败");
        return;
      }
      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络异常";
      toast.error(msg);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h1 className="text-lg font-bold">提交成功</h1>
            <p className="text-sm text-muted-foreground">
              资料已发送给房东，房东核对后会和你联系。
            </p>
            <p className="text-xs text-muted-faint pt-2">本页可以关闭</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <h1 className="text-lg font-bold">无法填写</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <p className="text-xs text-muted-faint pt-2">请联系房东重新生成链接</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invite) return null;

  const purposeLabel =
    invite.purpose === "agent_register" ? "中介信息登记" : "租客信息登记";

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="max-w-md mx-auto px-4 space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">{purposeLabel}</h1>
          <p className="text-xs text-muted-foreground">
            房东邀请你填写信息 · 提交后将自动发送给房东
          </p>
        </div>

        <Card>
          <CardContent className="pt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                {/* AI 拍身份证识别按钮 */}
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
                    disabled={scanning}
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
                  name="id_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>身份证号</FormLabel>
                      <FormControl>
                        <Input placeholder="选填，房东核对用" {...field} />
                      </FormControl>
                      <FormDescription>仅房东可见，不公开展示</FormDescription>
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
                        <Input placeholder="选填" {...field} />
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
                        <Input type="tel" placeholder="选填" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>备注</FormLabel>
                      <FormControl>
                        <Textarea placeholder="想跟房东说的话..." rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  提交
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-faint">
          由 养房 Tend 提供 · tendapp.cn
        </p>
      </div>
    </div>
  );
}
