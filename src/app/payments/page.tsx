"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/contexts/user-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/types";
import type { Payment } from "@/types";

type PaymentWithRelations = Payment & {
  bill: {
    period_start: string;
    period_end: string;
    lease: {
      property: { name: string };
      lease_tenants: Array<{ is_primary: boolean; tenant: { name: string } }>;
    };
  };
};

const METHOD_BADGE: Record<string, "success" | "info" | "secondary" | "muted"> = {
  wechat: "success",
  alipay: "info",
  bank: "secondary",
  cash: "muted",
  other: "muted",
};

export default function PaymentsPage() {
  const { householdId, loading: userLoading } = useUser();
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchPayments = async () => {
    if (!householdId) return;
    const leaseIds = await supabase
      .from("leases")
      .select("id")
      .eq("household_id", householdId)
      .is("deleted_at", null);

    if (!leaseIds.data) { setLoading(false); return; }
    const ids = leaseIds.data.map((l) => l.id);

    const billIds = await supabase
      .from("bills")
      .select("id")
      .in("lease_id", ids.length ? ids : ["_none_"]);

    if (!billIds.data?.length) { setLoading(false); return; }
    const bIds = billIds.data.map((b) => b.id);

    const { data, error } = await supabase
      .from("payments")
      .select("*, bill:bills(period_start, period_end, lease:leases(property:properties(name), lease_tenants(is_primary, tenant:tenants(name))))")
      .in("bill_id", bIds)
      .order("paid_at", { ascending: false });

    if (!error) setPayments((data ?? []) as PaymentWithRelations[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!userLoading) fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userLoading]);

  const getPrimaryTenant = (payment: PaymentWithRelations) => {
    const primary = payment.bill?.lease?.lease_tenants?.find((lt) => lt.is_primary);
    return primary?.tenant?.name ?? payment.bill?.lease?.lease_tenants?.[0]?.tenant?.name ?? "—";
  };

  const totalReceived = payments.reduce((s, p) => s + Number(p.amount), 0);

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold">收款记录</h1>
        <p className="text-sm text-muted-foreground">
          共 {payments.length} 笔 · 合计 {formatCurrency(totalReceived)}
        </p>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="还没有收款记录"
          description="在账单管理页面记录收款后，记录将显示在这里"
        />
      ) : (
        <div className="space-y-3">
          {payments.map((payment) => (
            <Card key={payment.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">
                        {payment.bill?.lease?.property?.name ?? "—"}
                      </span>
                      <Badge variant={METHOD_BADGE[payment.method] ?? "muted"}>
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </Badge>
                      {payment.ai_recognized && (
                        <Badge variant="info" className="text-xs">AI识别</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      租客：{getPrimaryTenant(payment)}
                    </p>
                    {payment.bill && (
                      <p className="text-xs text-muted-foreground">
                        账期：{formatDate(payment.bill.period_start)} — {formatDate(payment.bill.period_end)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      收款时间：{formatDate(payment.paid_at)}
                    </p>
                    {payment.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{payment.notes}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <p className="text-base font-bold text-green-600">
                      +{formatCurrency(payment.amount)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
