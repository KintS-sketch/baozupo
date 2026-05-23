/**
 * GET /api/contracts/[id]
 * 返回合同详情 + 签字方（脱敏后）状态。
 *
 * 访问鉴权：
 *   - 登录用户：通过 RLS 校验 household 归属
 *   - 匿名 + ?token=xxx：通过 service_role 反查 token 验证后返回
 *
 * 顺带处理：若 expires_at 已过且 status in (draft, partial)，自动转 expired
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Contract, ContractSigner } from "@/types/contract";

export const runtime = "nodejs";

interface PublicSigner {
  id: string;
  role: ContractSigner["role"];
  sign_order: number;
  name: string;
  phone: string;       // 已脱敏
  signed_at: string | null;
  sign_ip: string | null;
  sms_verified_at: string | null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ===== 鉴权分支 =====
  let contract: Contract | null = null;
  let signers: ContractSigner[] = [];

  if (user) {
    const { data } = await supabase.from("contracts").select("*").eq("id", id).single();
    contract = data as Contract | null;
    const { data: ss } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", id)
      .order("sign_order");
    signers = (ss ?? []) as ContractSigner[];
  } else if (token) {
    // 匿名带 token：用 service_role 校验 token 后读
    const service = createServiceClient();
    const { data: signer } = await service
      .from("contract_signers")
      .select("contract_id")
      .eq("public_token", token)
      .eq("contract_id", id)
      .single();
    if (!signer) {
      return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    }
    const { data: c } = await service.from("contracts").select("*").eq("id", id).single();
    contract = c as Contract | null;
    const { data: ss } = await service
      .from("contract_signers")
      .select("*")
      .eq("contract_id", id)
      .order("sign_order");
    signers = (ss ?? []) as ContractSigner[];
  } else {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  if (!contract) {
    return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });
  }

  // ===== 懒过期检测 =====
  if (
    contract.expires_at &&
    new Date(contract.expires_at) < new Date() &&
    (contract.status === "draft" || contract.status === "partial")
  ) {
    const service = createServiceClient();
    await service.from("contracts").update({ status: "expired" }).eq("id", id);
    contract.status = "expired";
  }

  // ===== 脱敏签字方信息（不返回 sms_code_hash 等敏感字段）=====
  const publicSigners: PublicSigner[] = signers.map((s) => ({
    id: s.id,
    role: s.role,
    sign_order: s.sign_order,
    name: s.name,
    phone: maskPhone(s.phone),
    signed_at: s.signed_at,
    sign_ip: s.sign_ip ? maskIp(s.sign_ip) : null,
    sms_verified_at: s.sms_verified_at,
  }));

  return NextResponse.json({
    success: true,
    contract,
    signers: publicSigners,
  });
}

function maskPhone(p: string): string {
  if (!p || p.length < 7) return p ?? "";
  return p.slice(0, 3) + "****" + p.slice(-4);
}

function maskIp(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
}
