"use client";

import { Check, Clock } from "lucide-react";
import { format } from "date-fns";
import type { SignerRole } from "@/types/contract";

interface SignerLite {
  role: SignerRole;
  name: string;
  signed_at: string | null;
  sign_ip: string | null;
}

const ROLE_LABEL: Record<SignerRole, string> = {
  landlord: "房东",
  agent: "中介",
  tenant: "租客",
};

export function SignProgress({ signers }: { signers: SignerLite[] }) {
  return (
    <div className="space-y-2">
      {signers.map((s) => {
        const signed = !!s.signed_at;
        return (
          <div
            key={s.role}
            className="flex items-center gap-3 p-3 rounded-lg bg-secondary"
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                signed
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {signed ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {ROLE_LABEL[s.role]} · {s.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {signed
                  ? `已签字 · ${format(new Date(s.signed_at!), "yyyy-MM-dd HH:mm")}`
                  : "等待签字"}
                {signed && s.sign_ip ? (
                  <span className="ml-2 num">· IP {s.sign_ip}</span>
                ) : null}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
