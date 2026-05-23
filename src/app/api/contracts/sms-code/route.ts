/**
 * POST /api/contracts/sms-code
 * 给当前签字方发短信验证码。
 *
 * 鉴权：
 *   - role=landlord：登录态 + RLS 校验 household 归属
 *   - role=agent/tenant：必须带 public_token 且与 signer.public_token 匹配
 *
 * 频控：单签字方 60 秒只能发一次
 * 顺序约束：前序签字方必须已签
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSmsCode } from "@/lib/econtract/tokens";
import { hashSmsCode } from "@/lib/econtract/hash";
import { sendContractVerifySms } from "@/lib/econtract/sms";
import type { ContractSigner, SignerRole } from "@/types/contract";

export const runtime = "nodejs";

const SMS_COOLDOWN_MS = 60_000;       // 60 秒频控
const CODE_TTL_MS = 5 * 60_000;       // 5 分钟有效期

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();

  let body: { contract_id?: string; role?: string; public_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }
  const { contract_id, role, public_token } = body;
  if (!contract_id || !role) {
    return NextResponse.json({ success: false, error: "缺少 contract_id 或 role" }, { status: 400 });
  }
  if (!["landlord", "agent", "tenant"].includes(role)) {
    return NextResponse.json({ success: false, error: "非法 role" }, { status: 400 });
  }

  // ===== 鉴权 =====
  let signer: ContractSigner | null = null;
  if (role === "landlord") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    // RLS 会校验 household 归属
    const { data } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract_id)
      .eq("role", "landlord")
      .single();
    signer = data as ContractSigner | null;
  } else {
    if (!public_token) {
      return NextResponse.json({ success: false, error: "缺少 public_token" }, { status: 400 });
    }
    const { data } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract_id)
      .eq("role", role)
      .eq("public_token", public_token)
      .single();
    signer = data as ContractSigner | null;
  }
  if (!signer) {
    return NextResponse.json({ success: false, error: "签署方不存在或令牌不匹配" }, { status: 404 });
  }
  if (signer.signed_at) {
    return NextResponse.json({ success: false, error: "您已签字" }, { status: 409 });
  }

  // ===== 顺序约束：前序签字方必须已签 =====
  const { data: prevSigners } = await supabase
    .from("contract_signers")
    .select("signed_at, role")
    .eq("contract_id", contract_id)
    .lt("sign_order", signer.sign_order);
  if ((prevSigners ?? []).some((p) => !p.signed_at)) {
    return NextResponse.json(
      { success: false, error: "请等待上一签署方完成签字" },
      { status: 409 }
    );
  }

  // ===== 频控 =====
  if (signer.sms_sent_at) {
    const elapsed = Date.now() - new Date(signer.sms_sent_at).getTime();
    if (elapsed < SMS_COOLDOWN_MS) {
      return NextResponse.json(
        {
          success: false,
          error: `${Math.ceil((SMS_COOLDOWN_MS - elapsed) / 1000)} 秒后再试`,
          retry_after_seconds: Math.ceil((SMS_COOLDOWN_MS - elapsed) / 1000),
        },
        { status: 429 }
      );
    }
  }

  // ===== 锁定中？=====
  if (signer.sms_locked_until && new Date(signer.sms_locked_until) > new Date()) {
    return NextResponse.json(
      { success: false, error: "签字尝试次数过多已锁定，请稍后再试" },
      { status: 429 }
    );
  }

  // ===== 生成 & 发送 =====
  const code = generateSmsCode();
  const result = await sendContractVerifySms(signer.phone, code);
  if (!result.ok) {
    console.error("[contracts/sms-code] send fail:", result);
    return NextResponse.json(
      { success: false, error: `短信发送失败：${result.message ?? "未知"}` },
      { status: 502 }
    );
  }

  // ===== 入库 =====
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await supabase
    .from("contract_signers")
    .update({
      sms_code_hash: hashSmsCode(code, signer.id),
      sms_code_expires_at: expiresAt.toISOString(),
      sms_sent_at: now.toISOString(),
      sms_attempts: 0,        // 新一轮验证码，重置尝试计数
      sms_locked_until: null,
    })
    .eq("id", signer.id);

  return NextResponse.json({
    success: true,
    expires_at: expiresAt.toISOString(),
    cooldown_seconds: SMS_COOLDOWN_MS / 1000,
  });
}

// 抑制 unused warning
export type { SignerRole };
