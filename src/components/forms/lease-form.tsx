"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Paperclip, Upload, X, UserPlus, Users, Camera, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { isValidPhone } from "@/lib/format";
import { addMonths, format } from "date-fns";
import { toast } from "sonner";
import type { Lease, Property, Tenant } from "@/types";
import type { AiRecognizeIdCardResponse } from "@/types/ai";

// 18 位身份证号校验（17 位数字 + 末位数字或大写 X）
const ID_CARD_RE = /^\d{17}[\dXx]$/;
// 微信号校验：6-20 个字符，字母/数字/下划线/连字符。允许中文（部分老账号是中文）
const WECHAT_RE = /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$|^[一-龥_a-zA-Z0-9-]{2,20}$/;

const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
const CONTRACT_MAX_COUNT = 10; // 合同最多传 10 个文件（拍照可能多张）

export interface LeaseFormExtras {
  // 反馈：合同支持多个文件（文件 or 多张照片）
  contractFiles: File[];
  // 新建租客模式下，前端 handler 需要先 create tenant 再 create lease
  newTenant: NewTenantPayload | null;
}

export interface NewTenantPayload {
  name: string;
  phone: string;
  id_number: string;
  wechat_id: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_MB = 5;

/** 把 File 转成 base64（不含 data: 前缀），AI 识别身份证用 */
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

// 反馈 #11: 租客字段全部必填，身份证 18 位严格校验，加微信号
const schema = z.object({
  property_id: z.string().min(1, "请选择房源"),
  // 新增/已有：existing → 必须选 tenant_id；new → 必须填全部新租客字段
  tenant_mode: z.enum(["existing", "new"]).default("new"),
  tenant_id: z.string().optional(),
  new_tenant_name: z.string().optional(),
  new_tenant_phone: z.string().optional(),
  new_tenant_id_number: z.string().optional(),
  new_tenant_wechat_id: z.string().optional(),
  new_tenant_emergency_name: z.string().optional(),
  new_tenant_emergency_phone: z.string().optional(),
  start_date: z.string().min(1, "请选择起租日期"),
  end_date: z.string().min(1, "请选择结束日期"),
  monthly_rent: z.coerce.number().positive("租金必须大于0"),
  deposit: z.coerce.number().min(0, "押金不能为负数"),
  payment_cycle: z.enum(["monthly", "quarterly", "biannual", "annual"]),
  rent_due_day: z.coerce.number().int().min(1, "至少1号").max(31, "最多31号"),
  billing_mode: z.enum(["natural_month", "rolling_month"]),
  // 直租 / 中介
  rental_source: z.enum(["direct", "agent"]).default("direct"),
  agent_name: z.string().optional(),
  agent_phone: z.string().optional(),
  agent_fee: z.union([z.coerce.number().min(0, "中介费不能为负数"), z.literal("")]).optional(),
  generate_bills: z.boolean().default(true),
  notes: z.string().optional(),
})
  .refine(
    (data) => !data.start_date || !data.end_date || new Date(data.end_date) > new Date(data.start_date),
    { message: "结束日期必须晚于起租日期", path: ["end_date"] }
  )
  // 已有租客：必须选；新租客：所有字段必填
  .refine(
    (data) => {
      if (data.tenant_mode === "existing") return !!data.tenant_id;
      return !!(data.new_tenant_name && data.new_tenant_name.trim().length > 0);
    },
    { message: "请填写姓名", path: ["new_tenant_name"] }
  )
  .refine(
    (data) => {
      if (data.tenant_mode !== "new") return true;
      return !!(data.new_tenant_phone && isValidPhone(data.new_tenant_phone));
    },
    { message: "请输入正确的 11 位中国大陆手机号", path: ["new_tenant_phone"] }
  )
  .refine(
    (data) => {
      if (data.tenant_mode !== "new") return true;
      return !!(data.new_tenant_id_number && ID_CARD_RE.test(data.new_tenant_id_number.trim()));
    },
    { message: "请输入完整的 18 位身份证号", path: ["new_tenant_id_number"] }
  )
  // 微信号选填；填了才校验格式
  .refine(
    (data) => {
      if (data.tenant_mode !== "new" || !data.new_tenant_wechat_id) return true;
      return WECHAT_RE.test(data.new_tenant_wechat_id.trim());
    },
    { message: "请输入有效的微信号", path: ["new_tenant_wechat_id"] }
  )
  // 紧急联系人姓名选填；电话选填，但填了要校验格式
  .refine(
    (data) => {
      if (data.tenant_mode !== "new" || !data.new_tenant_emergency_phone) return true;
      return isValidPhone(data.new_tenant_emergency_phone);
    },
    { message: "请输入正确的紧急联系人手机号", path: ["new_tenant_emergency_phone"] }
  )
  .refine(
    (data) => {
      if (data.rental_source !== "agent") return true;
      return !!(data.agent_name && data.agent_name.trim().length > 0);
    },
    { message: "请填写中介姓名", path: ["agent_name"] }
  )
  .refine(
    (data) => {
      if (data.rental_source !== "agent" || !data.agent_phone) return true;
      return isValidPhone(data.agent_phone);
    },
    { message: "请输入正确的中介手机号", path: ["agent_phone"] }
  );

export type LeaseFormValues = z.infer<typeof schema>;

interface LeaseFormProps {
  defaultValues?: Partial<Lease & { tenant_id?: string }>;
  onSubmit: (values: LeaseFormValues, extras: LeaseFormExtras) => Promise<void>;
  onCancel: () => void;
}

export function LeaseForm({ defaultValues, onSubmit, onCancel }: LeaseFormProps) {
  const { householdId } = useUser();
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  // 反馈：合同改成多文件 — docInputRef 选 PDF/文档，photoInputRef 选图片
  const [contractFiles, setContractFiles] = useState<File[]>([]);
  const docInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const isEditing = !!defaultValues?.id;

  const handleContractChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    const tooBig = picked.find((f) => f.size > CONTRACT_MAX_BYTES);
    if (tooBig) {
      toast.error(`「${tooBig.name}」超过 10MB，请压缩后再传`);
    }
    const valid = picked.filter((f) => f.size <= CONTRACT_MAX_BYTES);
    setContractFiles((prev) => {
      const merged = [...prev, ...valid];
      if (merged.length > CONTRACT_MAX_COUNT) {
        toast.warning(`合同最多 ${CONTRACT_MAX_COUNT} 个文件，多余的已忽略`);
        return merged.slice(0, CONTRACT_MAX_COUNT);
      }
      return merged;
    });
    // 重置 input，使重复选同一个文件也能触发
    e.target.value = "";
  };

  const removeContractFile = (idx: number) => {
    setContractFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // AI 拍身份证识别相关
  const idCardInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  const form = useForm<LeaseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      property_id: defaultValues?.property_id ?? "",
      // 编辑模式（有 id）或 prefill 模式（有 tenant_id）→ 走 existing；新建走 new
      tenant_mode: defaultValues?.id || defaultValues?.tenant_id ? "existing" : "new",
      tenant_id: defaultValues?.tenant_id ?? "",
      new_tenant_name: "",
      new_tenant_phone: "",
      new_tenant_id_number: "",
      new_tenant_wechat_id: "",
      new_tenant_emergency_name: "",
      new_tenant_emergency_phone: "",
      start_date: defaultValues?.start_date ?? "",
      end_date: defaultValues?.end_date ?? "",
      // 默认值用空串而不是 0：否则输入框里 0 占位，打 50 会变 "050"
      monthly_rent: defaultValues?.monthly_rent ?? ("" as unknown as number),
      deposit: defaultValues?.deposit ?? ("" as unknown as number),
      payment_cycle: defaultValues?.payment_cycle ?? "monthly",
      rent_due_day: defaultValues?.rent_due_day ?? 1,
      billing_mode: defaultValues?.billing_mode ?? "natural_month",
      rental_source: defaultValues?.rental_source ?? "direct",
      agent_name: defaultValues?.agent_name ?? "",
      agent_phone: defaultValues?.agent_phone ?? "",
      agent_fee: defaultValues?.agent_fee ?? ("" as unknown as number),
      generate_bills: !defaultValues?.id,
      notes: defaultValues?.notes ?? "",
    },
  });

  const tenantMode = form.watch("tenant_mode");
  const rentalSource = form.watch("rental_source");

  // 新增租客模式下，必填字段填完才允许选合同（微信号 / 紧急联系人都选填，不计入）
  const tenantFieldsAllFilled = (() => {
    if (tenantMode !== "new") return true;
    const v = form.getValues();
    return !!(
      v.new_tenant_name?.trim() &&
      v.new_tenant_phone && isValidPhone(v.new_tenant_phone) &&
      v.new_tenant_id_number && ID_CARD_RE.test(v.new_tenant_id_number.trim())
    );
  });
  // 让 watch 触发重渲染
  form.watch(["new_tenant_name", "new_tenant_phone", "new_tenant_id_number",
    "new_tenant_wechat_id", "new_tenant_emergency_name", "new_tenant_emergency_phone"]);

  // 反馈：租期快捷选项 — 选了半年/一年/两年，填起租日就自动算结束日
  // 编辑已有租约时默认 custom，保留原 end_date 不被覆盖
  type LeaseTerm = "6m" | "1y" | "2y" | "custom";
  const [leaseTerm, setLeaseTerm] = useState<LeaseTerm>(
    defaultValues?.id ? "custom" : "1y"
  );
  const startDate = form.watch("start_date");
  useEffect(() => {
    if (leaseTerm === "custom" || !startDate) return;
    const months = leaseTerm === "6m" ? 6 : leaseTerm === "1y" ? 12 : 24;
    const end = addMonths(new Date(startDate), months);
    if (!isNaN(end.getTime())) {
      form.setValue("end_date", format(end, "yyyy-MM-dd"), { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, leaseTerm]);

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
        form.setValue("new_tenant_name", name, { shouldValidate: true });
        filled++;
      }
      if (id_number) {
        form.setValue("new_tenant_id_number", id_number, { shouldValidate: true });
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
      if (idCardInputRef.current) idCardInputRef.current.value = "";
    }
  };

  const handleSubmitWithExtras = (values: LeaseFormValues) => {
    const newTenant: NewTenantPayload | null =
      values.tenant_mode === "new"
        ? {
            name: values.new_tenant_name!.trim(),
            phone: values.new_tenant_phone!.trim(),
            id_number: values.new_tenant_id_number!.trim(),
            wechat_id: values.new_tenant_wechat_id!.trim(),
            emergency_contact_name: values.new_tenant_emergency_name!.trim(),
            emergency_contact_phone: values.new_tenant_emergency_phone!.trim(),
          }
        : null;
    return onSubmit(values, { contractFiles, newTenant });
  };

  useEffect(() => {
    if (!householdId) return;
    const loadOptions = async () => {
      const [{ data: propsData }, { data: tenantsData }] = await Promise.all([
        // 反馈：选房源要能看到地址，区分同名房源（比如两个"碧桂园"）
        supabase.from("properties").select("id, name, address").eq("household_id", householdId).is("deleted_at", null).order("name"),
        supabase.from("tenants").select("id, name").eq("household_id", householdId).is("deleted_at", null).order("name"),
      ]);
      setProperties((propsData ?? []) as Property[]);
      setTenants((tenantsData ?? []) as Tenant[]);
      // 没有任何租客时强制走"新增"模式，避免下拉空白
      if (!defaultValues?.id && (tenantsData?.length ?? 0) === 0) {
        form.setValue("tenant_mode", "new");
      }
    };
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmitWithExtras)} className="space-y-4">
        {/* 房源 */}
        <FormField
          control={form.control}
          name="property_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>房源 *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder="选择房源" /></SelectTrigger></FormControl>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex flex-col">
                        <span className="font-medium">{p.name}</span>
                        {p.address && (
                          <span className="text-xs text-muted-foreground">{p.address}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 租客：新增 vs 已有 切换 */}
        {!isEditing && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="h-4 w-4 text-primary" />
              租客信息
            </div>

            <FormField
              control={form.control}
              name="tenant_mode"
              render={({ field }) => (
                <div className="inline-flex p-1 bg-secondary rounded-lg gap-1">
                  <button
                    type="button"
                    onClick={() => field.onChange("new")}
                    className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${
                      field.value === "new"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    <UserPlus className="inline h-3.5 w-3.5 mr-1" />
                    新增租客
                  </button>
                  <button
                    type="button"
                    onClick={() => field.onChange("existing")}
                    disabled={tenants.length === 0}
                    className={`px-3 h-8 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      field.value === "existing"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    <Users className="inline h-3.5 w-3.5 mr-1" />
                    选择已有 ({tenants.length})
                  </button>
                </div>
              )}
            />

            {tenantMode === "new" ? (
              <div className="space-y-3">
                {/* AI 拍身份证识别：高级感小卡片在最上面，省手敲姓名+身份证号 */}
                <div className="rounded-lg border border-primary/25 bg-gradient-to-br from-primary/5 to-primary/0 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium">拍身份证一键填</span>
                    <span className="text-[11px] text-muted-foreground">自动识别姓名+证件号</span>
                  </div>
                  {/* 不加 capture，让浏览器弹「拍照 / 从相册选」菜单 */}
                  <input
                    ref={idCardInputRef}
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
                    size="sm"
                    className="w-full bg-white"
                    disabled={scanning}
                    onClick={() => idCardInputRef.current?.click()}
                  >
                    {scanning ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {scanning ? "识别中..." : "拍照 / 选身份证照片"}
                  </Button>
                </div>

                {/* 租客字段网格：所有都必填 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="new_tenant_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>姓名 *</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="new_tenant_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>手机号 *</FormLabel>
                        <FormControl><Input type="tel" inputMode="numeric" maxLength={11} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="new_tenant_id_number"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>身份证号 *</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="text"
                            maxLength={18}
                            className="font-mono tracking-wider"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="new_tenant_wechat_id"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>微信号（选填）</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="new_tenant_emergency_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>紧急联系人（选填）</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="new_tenant_emergency_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>紧急联系人电话（选填）</FormLabel>
                        <FormControl><Input type="tel" inputMode="numeric" maxLength={11} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : (
              <FormField
                control={form.control}
                name="tenant_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>选择主租客 *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="选择租客" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        )}

        {/* 编辑时只显示已有租客选择（不允许在租约表里改成新增） */}
        {isEditing && (
          <FormField
            control={form.control}
            name="tenant_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>主租客</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="选择租客" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* 租约日期与金额 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>起租日期 *</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 租期快捷选项：选了之后填起租日自动算结束日 */}
          <FormItem className="sm:col-span-2">
            <FormLabel>租期</FormLabel>
            <div className="flex flex-wrap gap-1.5">
              {([
                { v: "6m" as const, label: "半年" },
                { v: "1y" as const, label: "一年" },
                { v: "2y" as const, label: "两年" },
                { v: "custom" as const, label: "自定义" },
              ]).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setLeaseTerm(t.v)}
                  className={`px-3 h-8 rounded-lg text-xs font-medium border transition-colors ${
                    leaseTerm === t.v
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </FormItem>

          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  结束日期 *
                  {leaseTerm !== "custom" && (
                    <span className="text-[11px] font-normal text-muted-foreground ml-1">
                      （按租期自动算，可选「自定义」手填）
                    </span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    readOnly={leaseTerm !== "custom"}
                    className={leaseTerm !== "custom" ? "bg-muted/50 text-muted-foreground" : ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="monthly_rent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>月租金（元）*</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="deposit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>押金（元）</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="payment_cycle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>付款周期</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="monthly">月付</SelectItem>
                    <SelectItem value="quarterly">季付</SelectItem>
                    <SelectItem value="biannual">半年付</SelectItem>
                    <SelectItem value="annual">年付</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="rent_due_day"
            render={({ field }) => (
              <FormItem>
                <FormLabel>收租日（每月几号）</FormLabel>
                <FormControl><Input type="number" min={1} max={31} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="billing_mode"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>账单模式</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="natural_month">自然月（按日历月拆分）</SelectItem>
                    <SelectItem value="rolling_month">整月顺延（从起租日整月计算）</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* 租约来源：直租 vs 中介 */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <FormField
            control={form.control}
            name="rental_source"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">租约来源</FormLabel>
                <div className="inline-flex p-1 bg-secondary rounded-lg gap-1">
                  <button
                    type="button"
                    onClick={() => field.onChange("direct")}
                    className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${
                      field.value === "direct"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    直租
                  </button>
                  <button
                    type="button"
                    onClick={() => field.onChange("agent")}
                    className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${
                      field.value === "agent"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    通过中介
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {rentalSource === "agent" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="agent_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>中介姓名 *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="agent_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>中介电话</FormLabel>
                    <FormControl><Input type="tel" inputMode="numeric" maxLength={11} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="agent_fee"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>中介费（元，一次性）</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>

        {!defaultValues?.id && (
          <FormField
            control={form.control}
            name="generate_bills"
            render={({ field }) => (
              <FormItem>
                <label className="flex items-start gap-3 rounded-lg border border-border bg-primary-soft/40 p-3 cursor-pointer hover:bg-primary-soft/60 transition-colors">
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  />
                  <div className="text-sm flex-1">
                    <p className="font-medium">立即生成全部账单</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      根据起租日、结束日和账单模式自动算出每个月的账单，省去手动录入
                    </p>
                  </div>
                </label>
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注（可选）</FormLabel>
              <FormControl><Textarea rows={3} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isEditing && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              <span>合同附件（可选，最多 {CONTRACT_MAX_COUNT} 个）</span>
              {!tenantFieldsAllFilled && (
                <span className="text-[10px] text-warning ml-auto">
                  填完租客信息才能上传
                </span>
              )}
            </div>

            {/* 文档选择 input — PDF / Word 等 */}
            <input
              ref={docInputRef}
              type="file"
              accept="application/pdf,.doc,.docx"
              multiple
              className="hidden"
              onChange={handleContractChange}
            />
            {/* 图片选择 input — 多张照片 */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleContractChange}
            />

            {/* 已选文件列表 */}
            {contractFiles.length > 0 && (
              <div className="space-y-1.5">
                {contractFiles.map((f, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-md bg-white border p-2">
                    <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {(f.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => removeContractFile(idx)}
                      disabled={isSubmitting}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* 两个上传入口：文件 / 图片 */}
            {contractFiles.length < CONTRACT_MAX_COUNT && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => docInputRef.current?.click()}
                  disabled={isSubmitting || !tenantFieldsAllFilled}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  上传文件
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isSubmitting || !tenantFieldsAllFilled}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  上传照片
                </Button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              文件支持 PDF / Word；照片可一次选多张，单个 ≤10MB
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>取消</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "保存修改" : "创建租约"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
