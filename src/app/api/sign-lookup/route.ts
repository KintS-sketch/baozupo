/**
 * GET /api/sign-lookup?token=xxx
 * 公开签字页通过 token 反查需要哪个 contract + 哪个角色。
 *
 * 用 service_role（匿名访问 + 受 RLS 保护的表）。
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token || token.length < 32) {
    return NextResponse.json({ success: false, error: "缺少或非法 token" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: signer } = await service
    .from("contract_signers")
    .select("contract_id, role, signed_at, name")
    .eq("public_token", token)
    .single();

  if (!signer) {
    return NextResponse.json({ success: false, error: "签字链接无效或已过期" }, { status: 404 });
  }
  if (signer.signed_at) {
    return NextResponse.json(
      { success: false, error: "您已完成签字" },
      { status: 409 }
    );
  }

  // 取合同状态 + 房东姓名（公开页要显示"房东 XX 邀请你签字"）
  const { data: contract } = await service
    .from("contracts")
    .select("id, status, expires_at, lease_id")
    .eq("id", signer.contract_id)
    .single();
  if (!contract) {
    return NextResponse.json({ success: false, error: "合同已被撤销" }, { status: 410 });
  }
  if (contract.status === "void" || contract.status === "expired") {
    return NextResponse.json(
      { success: false, error: `合同已${contract.status === "void" ? "撤销" : "过期"}` },
      { status: 410 }
    );
  }
  if (contract.expires_at && new Date(contract.expires_at) < new Date()) {
    // 顺手标 expired
    await service.from("contracts").update({ status: "expired" }).eq("id", contract.id);
    return NextResponse.json({ success: false, error: "合同已过期" }, { status: 410 });
  }

  const { data: landlord } = await service
    .from("contract_signers")
    .select("name")
    .eq("contract_id", signer.contract_id)
    .eq("role", "landlord")
    .single();

  return NextResponse.json({
    success: true,
    contractId: signer.contract_id,
    role: signer.role,
    landlordName: landlord?.name ?? "房东",
    yourName: signer.name,
  });
}
