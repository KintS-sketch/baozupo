"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Property } from "@/types";

const schema = z.object({
  name: z.string().min(1, "请输入房源名称"),
  address: z.string().min(1, "请输入详细地址"),
  city: z.string().optional(),
  district: z.string().optional(),
  layout: z.string().optional(),
  area: z.coerce.number().positive("面积必须大于0").optional().or(z.literal("")),
  status: z.enum(["rented", "vacant", "renovating"]),
  notes: z.string().optional(),
});

export type PropertyFormValues = z.infer<typeof schema>;

interface PropertyFormProps {
  defaultValues?: Partial<Property>;
  onSubmit: (values: PropertyFormValues) => Promise<void>;
  onCancel: () => void;
}

export function PropertyForm({ defaultValues, onSubmit, onCancel }: PropertyFormProps) {
  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      address: defaultValues?.address ?? "",
      city: defaultValues?.city ?? "",
      district: defaultValues?.district ?? "",
      layout: defaultValues?.layout ?? "",
      area: defaultValues?.area ?? ("" as unknown as number),
      status: defaultValues?.status ?? "vacant",
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
              <FormItem className="sm:col-span-2">
                <FormLabel>房源名称 *</FormLabel>
                <FormControl>
                  <Input placeholder="例：朝阳区三里屯A座102" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>详细地址 *</FormLabel>
                <FormControl>
                  <Input placeholder="街道、楼栋、门牌号" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="district"
            render={({ field }) => (
              <FormItem>
                <FormLabel>省</FormLabel>
                <FormControl>
                  <Input placeholder="北京市 / 广东省" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>城市</FormLabel>
                <FormControl>
                  <Input placeholder="北京 / 深圳" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="layout"
            render={({ field }) => (
              <FormItem>
                <FormLabel>户型</FormLabel>
                <FormControl>
                  <Input placeholder="2室1厅1卫" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="area"
            render={({ field }) => (
              <FormItem>
                <FormLabel>面积（㎡）</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" placeholder="60.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>状态</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="vacant">空置</SelectItem>
                    <SelectItem value="rented">出租中</SelectItem>
                    <SelectItem value="renovating">装修中</SelectItem>
                  </SelectContent>
                </Select>
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
                <Textarea placeholder="其他说明信息..." rows={3} {...field} />
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
            {defaultValues?.id ? "保存修改" : "添加房源"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
