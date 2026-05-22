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

// 18 位身份证号校验
const ID_CARD_RE = /^\d{17}[\dXx]$/;
// 微信号校验
const WECHAT_RE = /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$|^[一-龥_a-zA-Z0-9-]{2,20}$/;

// 公开表单：所有租客字段必填（除备注）。中介模式额外填中介自己。
const schema = z.object({
  // 租客信息
  name: z.string().min(1, "请填写租客姓名"),
  phone: z.string().refine(isValidPhone, "请输入正确的 11 位手机号"),
  id_number: z.string().refine((v) => ID_CARD_RE.test(v.trim()), "请输入完整的 18 位身份证号"),
  // 微信号选填；填了才校验格式
  wechat_id: z
    .string()
    .optional()
    .refine((v) => !v || WECHAT_RE.test(v.trim()), "请输入有效的微信号"),
  // 紧急联系人选填；电话填了才校验格式
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z
    .string()
    .optional()
    .refine((v) => !v || isValidPhone(v), "请输入正确的紧急联系人电话"),
  notes: z.string().optional(),
  // 中介信息（仅中介模式必填）
  agent_name: z.string().optional(),
  agent_phone: z.string().optional().refine((v) => !v || isValidPhone(v), "请输入正确的手机号"),
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

  // dualRole 模式下让填表人自己选角色；非 dualRole 走 invite.purpose
  const [chosenRole, setChosenRole] = useState<"tenant" | "agent" | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      id_number: "",
      wechat_id: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      notes: "",
      agent_name: "",
      agent_phone: "",
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
    // 中介模式下手动校验中介姓名（zod 不知道当前 mode，只能在这里补）
    const role =
      chosenRole ??
      (invite?.purpose === "agent_register" ? "agent" : "tenant");
    if (role === "agent" && !(values.agent_name && values.agent_name.trim())) {
      toast.error("请填写中介姓名");
      return;
    }
    try {
      const payload = { ...values, chosen_role: role };
      const res = await fetch(`/api/invites/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  // 反馈 #12: dualRole 模式下让填表人在公开页选自己角色
  const isDualRole = !!(invite.prefilled_data && (invite.prefilled_data as { dualRole?: boolean }).dualRole);
  // 角色 effective：dualRole 看用户选了什么；非 dualRole 看 invite.purpose
  const effectiveRole: "tenant" | "agent" | null = isDualRole
    ? chosenRole
    : invite.purpose === "agent_register" ? "agent" : "tenant";
  const isAgentMode = effectiveRole === "agent";

  // dualRole 模式下用户还没选角色 → 先让他选
  if (isDualRole && !chosenRole) {
    return (
      <div className="min-h-screen bg-muted/30 py-6">
        <div className="max-w-md mx-auto px-4 space-y-4">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold">你是？</h1>
            <p className="text-xs text-muted-foreground">房东请你帮忙填一份信息，先告诉我你是哪种身份</p>
          </div>
          <Card>
            <CardContent className="pt-4 space-y-3">
              <button
                type="button"
                onClick={() => setChosenRole("tenant")}
                className="w-full rounded-xl border border-border bg-white p-4 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">我是租客本人</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      只填我自己的信息（姓名、手机、身份证、微信号、紧急联系人）
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setChosenRole("agent")}
                className="w-full rounded-xl border border-border bg-white p-4 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">我是中介代填</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      填中介本人 + 租客信息，房东会自动建中介租约
                    </p>
                  </div>
                </div>
              </button>
            </CardContent>
          </Card>
          <p className="text-center text-[11px] text-muted-faint">
            由 养房 Tend 提供 · tendapp.cn
          </p>
        </div>
      </div>
    );
  }

  const purposeLabel = isAgentMode ? "中介代填租客信息" : "租客信息登记";
  const subtitle = isAgentMode
    ? "请填写中介本人 + 即将入住租客的信息"
    : "房东邀请你填写信息 · 提交后将自动发送给房东";

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="max-w-md mx-auto px-4 space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">{purposeLabel}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {isDualRole && (
            <button
              type="button"
              onClick={() => setChosenRole(null)}
              className="text-[11px] text-primary underline"
            >
              不是这个身份？重选
            </button>
          )}
        </div>

        <Card>
          <CardContent className="pt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                {/* 中介模式下：先填中介自己的信息 */}
                {isAgentMode && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-3">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-primary" />
                      中介信息
                    </p>
                    <FormField
                      control={form.control}
                      name="agent_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">中介姓名 *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="agent_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">中介电话</FormLabel>
                          <FormControl>
                            <Input type="tel" inputMode="numeric" maxLength={11} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* 分隔标题：下面是租客信息 */}
                {isAgentMode && (
                  <p className="text-sm font-medium text-foreground pt-1">
                    <Sparkles className="inline h-4 w-4 text-primary mr-1" />
                    租客信息
                  </p>
                )}

                {/* AI 拍身份证识别按钮 */}
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="font-medium">拍身份证，自动填写</span>
                    <span className="text-xs text-muted-foreground">省去手动输入</span>
                  </div>
                  {/* 不加 capture，让浏览器弹「拍照 / 从相册选」菜单 */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
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
                        <Input {...field} />
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
                        <Input type="tel" inputMode="numeric" maxLength={11} {...field} />
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
                      <FormLabel>身份证号 *</FormLabel>
                      <FormControl>
                        <Input maxLength={18} className="font-mono tracking-wider" {...field} />
                      </FormControl>
                      <FormDescription>仅房东可见，不公开展示</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="wechat_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>微信号（选填）</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>紧急联系人姓名（选填）</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>紧急联系人电话（选填）</FormLabel>
                      <FormControl>
                        <Input type="tel" inputMode="numeric" maxLength={11} {...field} />
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
