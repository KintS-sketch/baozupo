/**
 * GET /api/contracts/[id]/pdf?v=initial|final[&token=xxx]
 * 下载合同 PDF。
 *
 * v=initial: 初稿（无签字）
 * v=final:   最终（含签字 + 审计页）— 必须 contract.status=signed
 *
 * 鉴权同 GET /api/contracts/[id]
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse | Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const version = url.searchParams.get("v") ?? "final";

  if (version !== "initial" && version !== "final") {
    return NextResponse.json({ success: false, error: "v 参数必须是 initial / final" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ===== 鉴权 =====
  let useService = false;
  if (!user) {
    if (!token) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const service = createServiceClient();
    const { data: signer } = await service
      .from("contract_signers")
      .select("id")
      .eq("contract_id", id)
      .eq("public_token", token)
      .single();
    if (!signer) {
      return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    }
    useService = true;
  }

  // ===== 取合同路径 =====
  const reader = useService ? createServiceClient() : supabase;
  const { data: contract } = await reader
    .from("contracts")
    .select("pdf_initial_path, pdf_final_path")
    .eq("id", id)
    .single();
  if (!contract) {
    return NextResponse.json({ success: false, error: "合同不存在" }, { status: 404 });
  }

  const path = version === "final" ? contract.pdf_final_path : contract.pdf_initial_path;
  if (!path) {
    return NextResponse.json(
      { success: false, error: `${version === "final" ? "最终" : "初稿"} PDF 尚未生成` },
      { status: 404 }
    );
  }

  // ===== 下载 Storage =====
  const storageClient = useService ? createServiceClient() : supabase;
  const { data, error } = await storageClient.storage.from("contracts").download(path);
  if (error || !data) {
    return NextResponse.json(
      { success: false, error: `下载失败：${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contract-${id}-${version}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
