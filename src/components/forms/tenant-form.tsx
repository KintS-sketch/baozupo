"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isValidPhone } from "@/lib/format";
import type { Tenant } from "@/types";

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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
