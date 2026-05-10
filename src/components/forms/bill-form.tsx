"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { generateBillPeriods } from "@/lib/billing";
import { formatCurrency } from "@/lib/format";
import { differenceInDays } from "date-fns";
import type { Lease } from "@/types";

const schema = z.object({
  lease_id: z.string().min(1, "请选择租约"),
  period_start: z.string().min(1, "请填写账期开始"),
  period_end: z.string().min(1, "请填写账期结束"),
  due_date: z.string().min(1, "请填写到期日"),
  rent_amount: z.coerce.number().min(0, "不能为负数"),
  utility_amount: z.coerce.number().min(0, "不能为负数").default(0),
  other_amount: z.coerce.number().min(0, "不能为负数").default(0),
  notes: z.string().optional(),
}).refine(
  (d) => !d.period_start || !d.period_end || new Date(d.period_end) >= new Date(d.period_start),
  { message: "账期结束不能早于开始", path: ["period_end"] }
);

export type BillFormValues = z.infer<typeof schema>;

interface BillFormProps {
  onSubmit: (values: BillFormValues & { total_amount: number; days_in_period: number; ratio: number }) => Promise<void>;
  onCancel: () => void;
}

type LeaseOption = Pick<Lease, "id" | "monthly_rent" | "start_date" | "end_date" | "billing_mode" | "rent_due_day"> & {
  property: { name: string };
  lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } }>;
};

export function BillForm({ onSubmit, onCancel }: BillFormProps) {
  const { householdId } = useUser();
  const [leases, setLeases] = useState<LeaseOption[]>([]);
  const [selectedLease, setSelectedLease] = useState<LeaseOption | null>(null);
  const [suggestedPeriods, setSuggestedPeriods] = useState<string>("");
  const supabase = createClient();

  const form = useForm<BillFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      lease_id: "",
      period_start: "",
      period_end: "",
      due_date: "",
      rent_amount: 0,
      utility_amount: 0,
      other_amount: 0,
      notes: "",
    },
  });

  useEffect(() => {
    if (!householdId) return;
    supabase
      .from("leases")
      .select("id, monthly_rent, start_date, end_date, billing_mode, rent_due_day, property:properties(name), lease_tenants(is_primary, tenant:tenants(name))")
      .eq("household_id", householdId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => setLeases((data ?? []) as unknown as LeaseOption[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const handleLeaseChange = (leaseId: string) => {
    form.setValue("lease_id", leaseId);
    const lease = leases.find((l) => l.id === leaseId);
    setSelectedLease(lease ?? null);
    if (!lease) return;

    // 用账单算法建议第一个账期
    try {
      const periods = generateBillPeriods(
        new Date(lease.start_date),
        new Date(lease.end_date),
        Number(lease.monthly_rent),
        lease.billing_mode,
        lease.rent_due_day
      );
      if (periods.length > 0) {
        const p = periods[0];
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        form.setValue("period_start", fmt(p.periodStart));
        form.setValue("period_end", fmt(p.periodEnd));
        form.setValue("due_date", fmt(p.dueDate));
        form.setValue("rent_amount", p.rentAmount);
        setSuggestedPeriods(`共 ${periods.length} 期，已预填第1期`);
      }
    } catch {
      // 忽略算法错误，允许手动填写
    }
  };

  const watchedValues = form.watch(["rent_amount", "utility_amount", "other_amount", "period_start", "period_end"]);
  const totalAmount = (Number(watchedValues[0]) || 0) + (Number(watchedValues[1]) || 0) + (Number(watchedValues[2]) || 0);

  const handleSubmit = async (values: BillFormValues) => {
    const days = values.period_start && values.period_end
      ? differenceInDays(new Date(values.period_end), new Date(values.period_start)) + 1
      : 1;
    const daysInMonth = 30; // 简化计算，实际会在算法中处理
    const ratio = parseFloat((days / daysInMonth).toFixed(6));

    await onSubmit({ ...values, total_amount: totalAmount, days_in_period: days, ratio });
  };

  const isSubmitting = form.formState.isSubmitting;
  const primaryTenant = (lease: LeaseOption) => {
    const p = lease.lease_tenants?.find((lt) => lt.is_primary);
    return p?.tenant?.name ?? lease.lease_tenants?.[0]?.tenant?.name ?? "";
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="lease_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>关联租约 *</FormLabel>
              <Select value={field.value} onValueChange={handleLeaseChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择生效中的租约" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {leases.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.property?.name ?? "—"} · {primaryTenant(l)} · {formatCurrency(Number(l.monthly_rent))}/月
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {suggestedPeriods && (
                <FormDescription className="text-primary">{suggestedPeriods}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="period_start"
            render={({ field }) => (
              <FormItem>
                <FormLabel>账期开始 *</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="period_end"
            render={({ field }) => (
              <FormItem>
                <FormLabel>账期结束 *</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="due_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>到期日 *</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-3 gap-3">
          <FormField
            control={form.control}
            name="rent_amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>租金（元）</FormLabel>
                <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="utility_amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>水电（元）</FormLabel>
                <FormControl><Input type="number" step="0.01" min="0" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="other_amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>其他（元）</FormLabel>
                <FormControl><Input type="number" step="0.01" min="0" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* 应收总额预览 */}
        <div className="rounded-lg bg-muted px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">应收总额</span>
          <span className="text-lg font-bold">{formatCurrency(totalAmount)}</span>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注</FormLabel>
              <FormControl><Textarea placeholder="水电抄表数、特殊说明等..." rows={2} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>取消</Button>
          <Button type="submit" disabled={isSubmitting || totalAmount <= 0}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建账单
          </Button>
        </div>
      </form>
    </Form>
  );
}
