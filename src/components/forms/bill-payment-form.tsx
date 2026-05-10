"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Wallet, Building2, Banknote, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { formatCurrency } from "@/lib/format";
import { PaymentScreenshotUpload } from "@/components/forms/payment-screenshot-upload";
import type { Bill, PaymentMethod } from "@/types";
import type { AiPaymentRecognitionResult } from "@/types/ai";
import { format } from "date-fns";

const schema = z.object({
  amount: z.coerce.number().positive("付款金额必须大于0"),
  paid_at: z.string().min(1, "请选择付款时间"),
  method: z.enum(["wechat", "alipay", "bank", "cash", "other"]),
  notes: z.string().optional(),
});

export type BillPaymentFormValues = z.infer<typeof schema>;

interface BillPaymentFormProps {
  bill: Bill;
  tenantName?: string;
  propertyName?: string;
  onSubmit: (values: BillPaymentFormValues) => Promise<void>;
  onCancel: () => void;
}

const METHODS: { v: PaymentMethod; label: string; icon: typeof Wallet }[] = [
  { v: "wechat", label: "微信", icon: Wallet },
  { v: "alipay", label: "支付宝", icon: Coins },
  { v: "bank", label: "银行卡", icon: Building2 },
  { v: "cash", label: "现金", icon: Banknote },
];

export function BillPaymentForm({ bill, tenantName, propertyName, onSubmit, onCancel }: BillPaymentFormProps) {
  const remaining = bill.total_amount - bill.paid_amount;

  const form = useForm<BillPaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: remaining > 0 ? remaining : 0,
      paid_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      method: "wechat",
      notes: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;
  const currentAmount = form.watch("amount");
  const currentMethod = form.watch("method");

  const isOverpay = Number(currentAmount) > remaining;
  const isFull = Number(currentAmount) === remaining;

  const handleRecognized = (result: AiPaymentRecognitionResult) => {
    if (result.amount > 0) form.setValue("amount", result.amount, { shouldValidate: true });
    if (result.paid_at) {
      const dt = new Date(result.paid_at);
      if (!Number.isNaN(dt.getTime())) {
        form.setValue("paid_at", format(dt, "yyyy-MM-dd'T'HH:mm"), { shouldValidate: true });
      }
    }
    if (result.method && result.method !== "other") {
      form.setValue("method", result.method, { shouldValidate: true });
    }
    const fragments: string[] = [];
    if (result.from_name) fragments.push(`付款方：${result.from_name}`);
    if (result.to_name) fragments.push(`收款方：${result.to_name}`);
    if (fragments.length > 0) {
      const existing = form.getValues("notes");
      const aiNote = fragments.join(" · ");
      form.setValue("notes", existing ? `${existing}\n${aiNote}` : aiNote, { shouldValidate: true });
    }
  };

  return (
    <Form {...form}>
      {(tenantName || propertyName) && (
        <p className="text-xs text-muted-foreground -mt-2 mb-3">
          {[tenantName, propertyName].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Summary 卡 — 陶土软色 */}
      <div className="rounded-2xl bg-primary-soft text-primary-soft-foreground p-4 mb-4">
        <div className="flex justify-between text-sm opacity-90">
          <span>应收</span>
          <span className="num">{formatCurrency(bill.total_amount)}</span>
        </div>
        <div className="flex justify-between text-sm opacity-90 mt-1.5">
          <span>已收</span>
          <span className="num">{formatCurrency(bill.paid_amount)}</span>
        </div>
        <div className="h-px bg-primary/15 my-2.5" />
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold">本期待收</span>
          <span className="num text-2xl font-bold tracking-tight">{formatCurrency(remaining)}</span>
        </div>
      </div>

      {/* AI 截图上传 */}
      <div className="mb-4">
        <PaymentScreenshotUpload
          billId={bill.id}
          onRecognized={handleRecognized}
          disabled={isSubmitting}
        />
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>收款金额</FormLabel>
              <FormControl>
                <div className="relative flex items-baseline h-14 px-4 bg-secondary border border-border rounded-xl focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                  <span className="num text-lg text-muted-faint mr-1">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    {...field}
                    onChange={(e) => field.onChange(e.target.value)}
                    className="num flex-1 bg-transparent text-2xl font-bold tracking-tight focus:outline-none"
                  />
                  {isFull && !isOverpay && (
                    <span className="text-xs text-muted-foreground ml-2">全额</span>
                  )}
                </div>
              </FormControl>
              {isOverpay && (
                <p className="text-xs text-warning">
                  ⚠ 输入金额超过待收 {formatCurrency(remaining)}，将记录为超额收款
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 4 列支付方式 */}
        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>收款方式</FormLabel>
              <FormControl>
                <div className="grid grid-cols-4 gap-2">
                  {METHODS.map((m) => {
                    const active = currentMethod === m.v;
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.v}
                        type="button"
                        onClick={() => field.onChange(m.v)}
                        className={`aspect-[1/1.05] rounded-xl border-[1.5px] flex flex-col items-center justify-center gap-1 transition-all ${
                          active
                            ? "bg-primary-soft border-primary"
                            : "bg-card border-border hover:border-border-strong"
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                        <span
                          className={`text-xs ${
                            active ? "text-primary-soft-foreground font-semibold" : "font-medium"
                          }`}
                        >
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paid_at"
          render={({ field }) => (
            <FormItem>
              <FormLabel>收款时间</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
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
              <FormLabel>
                备注 <span className="text-muted-faint font-normal">· 可选</span>
              </FormLabel>
              <FormControl>
                <Textarea placeholder="交易备注、流水号等…" rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onCancel}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            取消
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            className="w-full sm:flex-1 shadow-soft-md min-w-0"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />}
            <span className="truncate">
              确认收款 · {formatCurrency(Number(currentAmount) || 0)}
            </span>
          </Button>
        </div>
      </form>
    </Form>
  );
}
