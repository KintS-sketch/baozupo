"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeReading } from "@/lib/meter-billing";
import { formatCurrency } from "@/lib/format";
import {
  METER_TYPE_LABELS,
  METER_TYPE_UNITS,
  METER_TYPE_DEFAULT_UNIT_PRICE,
} from "@/types";
import type { MeterType, Property } from "@/types";
import { format } from "date-fns";

const schema = z.object({
  property_id: z.string().min(1, "请选择房源"),
  type: z.enum(["electricity", "water", "gas"]),
  reading_date: z.string().min(1, "请选择抄表日期"),
  value: z.coerce.number().nonnegative("读数不能为负"),
  previous_value: z.coerce.number().nonnegative("上次读数不能为负").optional().or(z.literal("")),
  unit_price: z.coerce.number().nonnegative("单价不能为负").optional().or(z.literal("")),
  notes: z.string().optional(),
});

export type MeterFormValues = z.infer<typeof schema>;

export interface MeterFormSubmit {
  property_id: string;
  type: MeterType;
  reading_date: string;
  value: number;
  previous_value: number | null;
  unit_price: number | null;
  usage: number | null;
  amount: number | null;
  notes: string | null;
}

interface MeterFormProps {
  properties: Property[];
  /** 自动获取上次读数的函数：返回 null 代表无历史 */
  getLastReading?: (propertyId: string, type: MeterType) => Promise<number | null>;
  defaultPropertyId?: string;
  onSubmit: (values: MeterFormSubmit) => Promise<void>;
  onCancel: () => void;
}

export function MeterForm({
  properties,
  getLastReading,
  defaultPropertyId,
  onSubmit,
  onCancel,
}: MeterFormProps) {
  const form = useForm<MeterFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      property_id: defaultPropertyId ?? properties[0]?.id ?? "",
      type: "electricity",
      reading_date: format(new Date(), "yyyy-MM-dd"),
      value: "" as unknown as number,
      previous_value: "" as unknown as number,
      unit_price: METER_TYPE_DEFAULT_UNIT_PRICE.electricity as unknown as number,
      notes: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;
  const propertyId = form.watch("property_id");
  const meterType = form.watch("type");
  const currentValue = form.watch("value");
  const previousValueField = form.watch("previous_value");
  const unitPriceField = form.watch("unit_price");

  const [lookupLoading, setLookupLoading] = useState(false);

  // 房源/表类型变化时：自动填上次读数 + 默认单价
  useEffect(() => {
    if (!propertyId || !meterType) return;
    let cancelled = false;
    (async () => {
      // 默认单价（用户没改过的情况下重置）
      const currentPrice = form.getValues("unit_price");
      const allDefaults = Object.values(METER_TYPE_DEFAULT_UNIT_PRICE) as number[];
      if (currentPrice === "" || currentPrice === undefined ||
          (typeof currentPrice === "number" && allDefaults.includes(currentPrice))) {
        form.setValue("unit_price", METER_TYPE_DEFAULT_UNIT_PRICE[meterType] as unknown as number);
      }

      if (!getLastReading) return;
      setLookupLoading(true);
      try {
        const last = await getLastReading(propertyId, meterType);
        if (cancelled) return;
        if (last !== null) {
          form.setValue("previous_value", last as unknown as number);
        } else {
          form.setValue("previous_value", "" as unknown as number);
        }
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, meterType]);

  // 实时计算用量和金额
  const numericCurrent = typeof currentValue === "number" ? currentValue : Number(currentValue);
  const numericPrev =
    previousValueField === "" || previousValueField === undefined
      ? null
      : Number(previousValueField);
  const numericPrice =
    unitPriceField === "" || unitPriceField === undefined ? null : Number(unitPriceField);
  const computed = !Number.isFinite(numericCurrent)
    ? { usage: null, amount: null }
    : computeReading(numericCurrent, numericPrev, numericPrice);

  const handleSubmit = async (values: MeterFormValues) => {
    const cur = Number(values.value);
    const prev =
      values.previous_value === "" || values.previous_value === undefined
        ? null
        : Number(values.previous_value);
    const price =
      values.unit_price === "" || values.unit_price === undefined
        ? null
        : Number(values.unit_price);
    const { usage, amount } = computeReading(cur, prev, price);

    await onSubmit({
      property_id: values.property_id,
      type: values.type,
      reading_date: values.reading_date,
      value: cur,
      previous_value: prev,
      unit_price: price,
      usage,
      amount,
      notes: values.notes?.trim() || null,
    });
  };

  const unit = METER_TYPE_UNITS[meterType];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="property_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>房源 *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择房源" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>表类型 *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="electricity">电（kWh）</SelectItem>
                    <SelectItem value="water">水（吨）</SelectItem>
                    <SelectItem value="gas">燃气（立方米）</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reading_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>抄表日期 *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="previous_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>上次读数</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder={lookupLoading ? "查询中..." : `首次抄表可留空`}
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">{unit}</p>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>本次读数 *</FormLabel>
                <FormControl>
                  <Input type="number" step="0.001" placeholder="0.000" {...field} />
                </FormControl>
                <p className="text-xs text-muted-foreground">{unit}</p>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="unit_price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>单价（元 / {unit}）</FormLabel>
              <FormControl>
                <Input type="number" step="0.0001" placeholder="留空则不算金额" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">本期用量</span>
            <span className="font-medium">
              {computed.usage === null ? "—" : `${computed.usage} ${unit}`}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1 mt-1">
            <span className="text-muted-foreground font-medium">应计费用</span>
            <span className="font-bold text-base">
              {computed.amount === null ? "—" : formatCurrency(computed.amount)}
            </span>
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注</FormLabel>
              <FormControl>
                <Textarea placeholder="如换表、估算等情况说明..." rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || properties.length === 0}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存抄表
          </Button>
        </div>
      </form>
    </Form>
  );
}
