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
import { PROVINCES, CITIES_BY_PROVINCE } from "@/lib/cn-regions";
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

  // 监听省份字段变化，自动联动城市选项
  // 字段名是 district（历史遗留），但实际存的是省份
  const selectedProvince = form.watch("district");
  const cityOptions = selectedProvince ? CITIES_BY_PROVINCE[selectedProvince] ?? [] : [];

  return (
    <Form {...form}>
      {/* datalist 给 input 提供下拉建议，但仍允许手填任意值 */}
      <datalist id="cn-provinces">
        {PROVINCES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="cn-cities">
        {cityOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>房源名称 *</FormLabel>
                <FormControl>
                  <Input placeholder="例：碧桂园 / 万科城" {...field} />
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
                  <Input placeholder="例：A座102 / 3栋1单元202" {...field} />
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
                  <Input
                    list="cn-provinces"
                    placeholder=""
                    autoComplete="address-level1"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      // 切换省份时清空城市，避免不匹配
                      const newProvince = e.target.value;
                      const currentCity = form.getValues("city");
                      if (currentCity && newProvince && !(CITIES_BY_PROVINCE[newProvince] ?? []).includes(currentCity)) {
                        form.setValue("city", "");
                      }
                    }}
                  />
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
                  <Input
                    list="cn-cities"
                    placeholder=""
                    autoComplete="address-level2"
                    {...field}
                  />
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
                  <Input placeholder="例：2室1厅1卫" {...field} />
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
                <FormLabel>面积</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder=""
                      className="pr-10"
                      {...field}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      ㎡
                    </span>
                  </div>
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
