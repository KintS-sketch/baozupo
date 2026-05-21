"use client";

import { useState } from "react";
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

/** 解析 "2室1厅1卫" → {rooms:2, halls:1, baths:1}（兼容历史数据） */
function parseLayout(layout: string | null | undefined): {
  rooms: number;
  halls: number;
  baths: number;
} {
  const m = (layout ?? "").match(/(\d+)\s*室\s*(\d+)\s*厅\s*(\d+)\s*卫/);
  return m
    ? { rooms: +m[1], halls: +m[2], baths: +m[3] }
    : { rooms: 0, halls: 0, baths: 0 };
}

function formatLayout(rooms: number, halls: number, baths: number): string {
  // 全 0 时存空串（"未填写"）；否则拼成标准格式
  if (!rooms && !halls && !baths) return "";
  return `${rooms}室${halls}厅${baths}卫`;
}

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

  // 户型拆 3 段：用户填数字，提交时合并为"X室X厅X卫"字符串存数据库
  const [layoutParts, setLayoutParts] = useState(() => parseLayout(defaultValues?.layout));

  const updateLayoutPart = (key: "rooms" | "halls" | "baths", value: number) => {
    const safe = Math.max(0, Math.min(20, Math.floor(value || 0)));
    const next = { ...layoutParts, [key]: safe };
    setLayoutParts(next);
    form.setValue("layout", formatLayout(next.rooms, next.halls, next.baths));
  };

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

          {/* 户型：3 个数字框（室/厅/卫），少打字 */}
          <FormItem>
            <FormLabel>户型</FormLabel>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                className="w-14 text-center px-2"
                value={layoutParts.rooms || ""}
                onChange={(e) => updateLayoutPart("rooms", Number(e.target.value))}
              />
              <span className="text-sm text-muted-foreground">室</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                className="w-14 text-center px-2"
                value={layoutParts.halls || ""}
                onChange={(e) => updateLayoutPart("halls", Number(e.target.value))}
              />
              <span className="text-sm text-muted-foreground">厅</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                className="w-14 text-center px-2"
                value={layoutParts.baths || ""}
                onChange={(e) => updateLayoutPart("baths", Number(e.target.value))}
              />
              <span className="text-sm text-muted-foreground">卫</span>
            </div>
          </FormItem>

          <FormField
            control={form.control}
            name="area"
            render={({ field }) => (
              <FormItem>
                <FormLabel>面积</FormLabel>
                <FormControl>
                  {/* max-w 限宽，跟左侧户型 3 数字框视觉对齐 */}
                  <div className="relative max-w-[160px]">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder=""
                      className="pr-10 text-right"
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
