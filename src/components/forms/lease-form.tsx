"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Paperclip, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import type { Lease, Property, Tenant } from "@/types";

const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
const CONTRACT_ACCEPT = "image/*,application/pdf";

export interface LeaseFormExtras {
  contractFile: File | null;
}

const schema = z.object({
  property_id: z.string().min(1, "请选择房源"),
  tenant_id: z.string().min(1, "请选择租客（主租客）"),
  start_date: z.string().min(1, "请选择起租日期"),
  end_date: z.string().min(1, "请选择结束日期"),
  monthly_rent: z.coerce.number().positive("租金必须大于0"),
  deposit: z.coerce.number().min(0, "押金不能为负数"),
  payment_cycle: z.enum(["monthly", "quarterly", "biannual", "annual"]),
  rent_due_day: z.coerce.number().int().min(1, "至少1号").max(31, "最多31号"),
  billing_mode: z.enum(["natural_month", "rolling_month"]),
  generate_bills: z.boolean().default(true),
  notes: z.string().optional(),
}).refine(
  (data) => !data.start_date || !data.end_date || new Date(data.end_date) > new Date(data.start_date),
  { message: "结束日期必须晚于起租日期", path: ["end_date"] }
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
  const [contractFile, setContractFile] = useState<File | null>(null);
  const contractInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const isEditing = !!defaultValues?.id;

  const handlePickContract = () => contractInputRef.current?.click();

  const handleContractChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CONTRACT_MAX_BYTES) {
      alert(`合同文件不能超过 10MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
      return;
    }
    setContractFile(file);
  };

  const handleSubmitWithExtras = (values: LeaseFormValues) =>
    onSubmit(values, { contractFile });

  const form = useForm<LeaseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      property_id: defaultValues?.property_id ?? "",
      tenant_id: defaultValues?.tenant_id ?? "",
      start_date: defaultValues?.start_date ?? "",
      end_date: defaultValues?.end_date ?? "",
      monthly_rent: defaultValues?.monthly_rent ?? (0 as unknown as number),
      deposit: defaultValues?.deposit ?? 0,
      payment_cycle: defaultValues?.payment_cycle ?? "monthly",
      rent_due_day: defaultValues?.rent_due_day ?? 1,
      billing_mode: defaultValues?.billing_mode ?? "natural_month",
      generate_bills: !defaultValues?.id,
      notes: defaultValues?.notes ?? "",
    },
  });

  useEffect(() => {
    if (!householdId) return;
    const loadOptions = async () => {
      const [{ data: propsData }, { data: tenantsData }] = await Promise.all([
        supabase.from("properties").select("id, name").eq("household_id", householdId).is("deleted_at", null).order("name"),
        supabase.from("tenants").select("id, name").eq("household_id", householdId).is("deleted_at", null).order("name"),
      ]);
      setProperties((propsData ?? []) as Property[]);
      setTenants((tenantsData ?? []) as Tenant[]);
    };
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmitWithExtras)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="property_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>房源 *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="选择房源" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tenant_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>主租客 *</FormLabel>
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

          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>结束日期 *</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
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
                <FormControl><Input type="number" step="0.01" placeholder="3000.00" {...field} /></FormControl>
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
                <FormControl><Input type="number" step="0.01" placeholder="6000.00" {...field} /></FormControl>
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
                <FormControl><Input type="number" min={1} max={31} placeholder="1" {...field} /></FormControl>
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
              <FormLabel>备注</FormLabel>
              <FormControl><Textarea placeholder="合同特殊约定等..." rows={3} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isEditing && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              <span>合同附件（可选，租约创建后自动关联）</span>
            </div>
            <input
              ref={contractInputRef}
              type="file"
              accept={CONTRACT_ACCEPT}
              className="hidden"
              onChange={handleContractChange}
            />
            {contractFile ? (
              <div className="flex items-center gap-2 rounded-md bg-white border p-2">
                <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{contractFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(contractFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => {
                    setContractFile(null);
                    if (contractInputRef.current) contractInputRef.current.value = "";
                  }}
                  disabled={isSubmitting}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handlePickContract}
                disabled={isSubmitting}
              >
                <Upload className="mr-1 h-3.5 w-3.5" />
                选择合同文件（PDF / 图片，≤10MB）
              </Button>
            )}
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
