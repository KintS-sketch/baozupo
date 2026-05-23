/**
 * POST /api/contracts/sign
 * 当前签字方提交签字（手写图 + 短信验证码）。
 *
 * 鉴权：
 *   - role=landlord：登录态
 *   - role=agent/tenant：必须带 public_token
 *
 * 流程：
 *   1. 验证码哈希校验（5 分钟有效期 / 3 次错锁定 30 分钟）
 *   2. 签名图（PNG base64）解码上传 Storage
 *   3. 更新 contract_signers
 *   4. 若还有未签的：合同 status=partial，给下一方发邀请短信
 *   5. 若全签完：下载初稿 + 所有签名图 → composer 合成最终 PDF → 算 SHA256 → 上传 final.pdf → 通知所有人
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashSmsCode, sha256Hex, safeEqualHex } from "@/lib/econtract/hash";
import { composeFinalPdf, type SignerAuditInfo } from "@/lib/econtract/pdf-composer";
import { sendContractInviteSms, sendContractDoneSms } from "@/lib/econtract/sms";
import type { ContractSigner, SignerRole } from "@/types/contract";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_SMS_ATTEMPTS = 3;
const LOCK_MS = 30 * 60_000;

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();

  let body: {
    contract_id?: string;
    role?: string;
    public_token?: string;
    sms_code?: string;
    signature_image?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }
  const { contract_id, role, public_token, sms_code, signature_image } = body;
  if (!contract_id || !role || !sms_code || !signature_image) {
    return NextResponse.json(
      { success: false, error: "缺少 contract_id / role / sms_code / signature_image" },
      { status: 400 }
    );
  }
  if (!["landlord", "agent", "tenant"].includes(role)) {
    return NextResponse.json({ success: false, error: "非法 role" }, { status: 400 });
  }

  // ===== 取签字方 + 鉴权 =====
  let signer: ContractSigner | null = null;
  if (role === "landlord") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
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

  // ===== 锁定检查 =====
  if (signer.sms_locked_until && new Date(signer.sms_locked_until) > new Date()) {
    return NextResponse.json(
      { success: false, error: "尝试次数过多已锁定，30 分钟后再试" },
      { status: 429 }
    );
  }

  // ===== 验证码校验 =====
  if (!signer.sms_code_hash || !signer.sms_code_expires_at) {
    return NextResponse.json({ success: false, error: "请先获取验证码" }, { status: 400 });
  }
  if (new Date(signer.sms_code_expires_at) < new Date()) {
    return NextResponse.json({ success: false, error: "验证码已过期，请重新获取" }, { status: 400 });
  }
  const expectedHash = hashSmsCode(sms_code, signer.id);
  if (!safeEqualHex(expectedHash, signer.sms_code_hash)) {
    const attempts = (signer.sms_attempts ?? 0) + 1;
    const locked = attempts >= MAX_SMS_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    await supabase
      .from("contract_signers")
      .update({ sms_attempts: attempts, sms_locked_until: locked })
      .eq("id", signer.id);
    return NextResponse.json(
      {
        success: false,
        error: "验证码错误",
        attempts_left: Math.max(0, MAX_SMS_ATTEMPTS - attempts),
      },
      { status: 400 }
    );
  }

  // ===== 签名图：data URL 转 Buffer =====
  const m = /^data:image\/png;base64,(.+)$/.exec(signature_image);
  if (!m) {
    return NextResponse.json({ success: false, error: "签名图格式错误（需 data:image/png;base64,...）" }, { status: 400 });
  }
  const sigBuf = Buffer.from(m[1], "base64");
  if (sigBuf.length > 200_000) {
    return NextResponse.json({ success: false, error: "签名图过大（>200KB）" }, { status: 413 });
  }

  // 取合同 household_id 拼路径
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, household_id, pdf_initial_path, status, expires_at")
    .eq("id", contract_id)
    .single();
  if (!contract) {
    return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });
  }
  if (contract.status === "void" || contract.status === "expired") {
    return NextResponse.json({ success: false, error: `合同已${contract.status === "void" ? "撤销" : "过期"}` }, { status: 409 });
  }

  const sigPath = `${contract.household_id}/${contract_id}/sig-${role}.png`;
  const { error: sigUpErr } = await supabase.storage
    .from("contracts")
    .upload(sigPath, sigBuf, { contentType: "image/png", upsert: true });
  if (sigUpErr) {
    return NextResponse.json({ success: false, error: `签名图上传失败：${sigUpErr.message}` }, { status: 500 });
  }

  // ===== 更新签字方记录 =====
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent");
  const nowIso = new Date().toISOString();

  await supabase
    .from("contract_signers")
    .update({
      signed_at: nowIso,
      sign_ip: ip,
      sign_ua: ua,
      signature_image_path: sigPath,
      sms_verified_at: nowIso,
      sms_code_hash: null,           // 清掉用过的验证码
      sms_code_expires_at: null,
    })
    .eq("id", signer.id);

  // ===== 取所有签字方 =====
  const { data: allSigners } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("contract_id", contract_id)
    .order("sign_order", { ascending: true });
  const signers = (allSigners ?? []) as ContractSigner[];
  const allSigned = signers.every((s) => s.signed_at);

  // ===== 若未全签：通知下一方 =====
  if (!allSigned) {
    await supabase.from("contracts").update({ status: "partial" }).eq("id", contract_id);
    const next = signers.find((s) => !s.signed_at);
    if (next && next.public_token) {
      const landlord = signers.find((s) => s.role === "landlord");
      // 阿里云模板里域名 https://tendapp.cn/sign/ 已写死，这里只传 token 部分
      const inviteResult = await sendContractInviteSms(
        next.phone,
        landlord?.name ?? "房东",
        next.public_token
      );
      if (!inviteResult.ok) {
        console.error("[contracts/sign] invite SMS fail:", inviteResult);
      }
    }
    return NextResponse.json({
      success: true,
      contract_status: "partial",
      next_signer_role: next?.role,
    });
  }

  // ===== 全签完：合成最终 PDF =====
  if (!contract.pdf_initial_path) {
    return NextResponse.json({ success: false, error: "初稿 PDF 路径丢失" }, { status: 500 });
  }
  const { data: initialFile, error: dlErr } = await supabase.storage
    .from("contracts")
    .download(contract.pdf_initial_path);
  if (dlErr || !initialFile) {
    return NextResponse.json({ success: false, error: `下载初稿 PDF 失败：${dlErr?.message}` }, { status: 500 });
  }
  const initialBuf = Buffer.from(await initialFile.arrayBuffer());

  // 下载所有签名图（部分可能失败，记 log 不阻塞）
  const sigInfos: SignerAuditInfo[] = await Promise.all(
    signers.map(async (s): Promise<SignerAuditInfo> => {
      let png: Buffer | undefined;
      if (s.signature_image_path) {
        const { data, error } = await supabase.storage
          .from("contracts")
          .download(s.signature_image_path);
        if (error) {
          console.error("[contracts/sign] download sig fail:", s.role, error);
        } else if (data) {
          png = Buffer.from(await data.arrayBuffer());
        }
      }
      return {
        role: s.role as SignerRole,
        name: s.name,
        phone: s.phone,
        signed_at: s.signed_at ?? "",
        sign_ip: s.sign_ip,
        sign_ua: s.sign_ua,
        sms_verified_at: s.sms_verified_at,
        signature_png: png,
      };
    })
  );

  let finalBuf: Buffer;
  try {
    finalBuf = await composeFinalPdf({
      initialPdf: initialBuf,
      signers: sigInfos,
      contractId: contract_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `PDF 合成失败：${msg}` }, { status: 500 });
  }

  const finalPath = `${contract.household_id}/${contract_id}/final.pdf`;
  const { error: finUpErr } = await supabase.storage
    .from("contracts")
    .upload(finalPath, finalBuf, { contentType: "application/pdf", upsert: true });
  if (finUpErr) {
    return NextResponse.json({ success: false, error: `最终 PDF 上传失败：${finUpErr.message}` }, { status: 500 });
  }

  const finalHash = sha256Hex(finalBuf);
  await supabase
    .from("contracts")
    .update({
      status: "signed",
      pdf_final_path: finalPath,
      pdf_hash_sha256: finalHash,
      signed_at: nowIso,
    })
    .eq("id", contract_id);

  // 通知所有方。模板里域名 https://tendapp.cn/contracts/ 已写死，这里只传 contract_id
  await Promise.all(
    signers.map(async (s) => {
      const r = await sendContractDoneSms(s.phone, contract_id);
      if (!r.ok) console.error("[contracts/sign] done SMS fail:", s.role, r);
    })
  );

  return NextResponse.json({
    success: true,
    contract_status: "signed",
    pdf_hash_sha256: finalHash,
  });
}

export type { SignerRole };
