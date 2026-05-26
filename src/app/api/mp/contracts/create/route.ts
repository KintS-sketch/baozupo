/**
 * POST /api/mp/contracts/create
 *
 * mp 端「发起电子合同」入口。复刻 /api/contracts/create 的逻辑，
 * 仅鉴权方式不同（Bearer 替代 cookie session）。
 *
 * Body: { lease_id }
 * Returns: { success, contract_id, reused, landlord_sign_url, tenant_sign_url }
 *
 * 流程：
 *   1. 校验租约归属
 *   2. 已存在 draft/partial/signed 合同则复用
 *   3. 校验主租客 + 房东实名信息齐全
 *   4. 生成初稿 PDF 上传 storage
 *   5. 创建 contract_signers（landlord + tenant）
 *   6. 返回两条签字链接给前端展示给房东（用于自己签 + 转发给租客）
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";
import { generateInitialPdf } from "@/lib/econtract/pdf-generator";
import { generatePublicToken } from "@/lib/econtract/tokens";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const BASE_URL = "https://tendapp.cn";

interface LeaseRow {
  id: string;
  household_id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number | string;
  deposit: number | string | null;
  rent_due_day: number | null;
  payment_cycle: string | null;
  rental_source: string | null;
  property: { name: string; address: string | null; area_sqm: number | null } | null;
  lease_tenants: Array<{
    is_primary: boolean;
    tenant: { id: string; name: string; phone: string; id_number: string | null } | null;
  }>;
}

function normalizeLease(row: Record<string, unknown>): LeaseRow {
  const property = Array.isArray(row.property) ? row.property[0] : row.property;
  const lease_tenants = (row.lease_tenants ?? []) as Array<{ is_primary: boolean; tenant: unknown }>;
  return {
    ...row,
    property: (property as LeaseRow["property"]) ?? null,
    lease_tenants: lease_tenants.map((lt) => ({
      is_primary: lt.is_primary,
      tenant: Array.isArray(lt.tenant)
        ? (lt.tenant[0] as LeaseRow["lease_tenants"][number]["tenant"])
        : (lt.tenant as LeaseRow["lease_tenants"][number]["tenant"]),
    })),
  } as LeaseRow;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ success: false, error: "无家庭组" }, { status: 400 });

  let body: { lease_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }
  const leaseId = body.lease_id;
  if (!leaseId)
    return NextResponse.json({ success: false, error: "缺少 lease_id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ success: false, error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ===== 1. 租约 =====
  const { data: leaseRaw, error: leaseErr } = await admin
    .from("leases")
    .select(
      `id, household_id, start_date, end_date,
       monthly_rent, deposit, rent_due_day, payment_cycle, rental_source,
       property:properties(name, address, area_sqm:area),
       lease_tenants(is_primary, tenant:tenants(id, name, phone, id_number))`
    )
    .eq("id", leaseId)
    .is("deleted_at", null)
    .single();

  if (leaseErr || !leaseRaw) {
    console.error("[api/mp/contracts/create] lease query fail", leaseErr, leaseId);
    return NextResponse.json(
      {
        success: false,
        error: leaseErr?.message
          ? `查询租约失败：${leaseErr.message}`
          : "租约不存在",
      },
      { status: 404 }
    );
  }
  const lease = normalizeLease(leaseRaw as Record<string, unknown>);
  if (lease.household_id !== user.household_id) {
    return NextResponse.json({ success: false, error: "无权操作" }, { status: 403 });
  }

  // ===== 2. 复用已有合同 =====
  const { data: existing } = await admin
    .from("contracts")
    .select("id, status")
    .eq("lease_id", leaseId)
    .is("deleted_at", null)
    .in("status", ["draft", "partial", "signed"])
    .maybeSingle();

  if (existing) {
    // 拉 tenant 那一行的 public_token 给前端展示
    const { data: tenantSigner } = await admin
      .from("contract_signers")
      .select("public_token")
      .eq("contract_id", existing.id)
      .eq("role", "tenant")
      .maybeSingle();
    return NextResponse.json({
      success: true,
      contract_id: existing.id,
      reused: true,
      landlord_sign_url: `${BASE_URL}/contracts/${existing.id}/sign`,
      tenant_sign_url: tenantSigner?.public_token
        ? `${BASE_URL}/sign/${tenantSigner.public_token}`
        : null,
      contract_status: existing.status,
    });
  }

  // ===== 3. 主租客 =====
  const primaryTenant =
    lease.lease_tenants?.find((lt) => lt.is_primary)?.tenant ??
    lease.lease_tenants?.[0]?.tenant ??
    null;
  if (!primaryTenant) {
    return NextResponse.json({ success: false, error: "租约没有租客" }, { status: 400 });
  }

  // ===== 4. 必填字段校验 =====
  const tenantMissing: string[] = [];
  if (!primaryTenant.name) tenantMissing.push("租客姓名");
  if (!primaryTenant.phone) tenantMissing.push("租客手机");
  if (!primaryTenant.id_number) tenantMissing.push("租客身份证号");
  if (Number(lease.monthly_rent) <= 0) tenantMissing.push("月租金");
  if (tenantMissing.length > 0) {
    return NextResponse.json(
      { success: false, error: `请先补全：${tenantMissing.join("、")}` },
      { status: 400 }
    );
  }

  // ===== 5. 房东信息（user_profiles + auth.users.phone）=====
  const { data: profile } = await admin
    .from("user_profiles")
    .select("real_name, id_number")
    .eq("id", user.id)
    .maybeSingle();

  // 拿 auth.users.phone 需要 admin
  const { data: authData } = await admin.auth.admin.getUserById(user.id);
  const landlordPhone = authData?.user?.phone ?? user.phone ?? "";
  const landlordName = profile?.real_name ?? "";
  const landlordId = profile?.id_number ?? "";

  const landlordMissing: string[] = [];
  if (!landlordName) landlordMissing.push("姓名");
  if (!landlordPhone) landlordMissing.push("手机号");
  if (!landlordId) landlordMissing.push("身份证号");
  if (landlordMissing.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `请先到「我的 → 房东实名」补全：${landlordMissing.join("、")}`,
        code: "LANDLORD_PROFILE_INCOMPLETE",
      },
      { status: 412 }
    );
  }

  // ===== 6. 模板 =====
  const templateType = lease.rental_source === "agent" ? "agent" : "direct";
  if (templateType === "agent") {
    return NextResponse.json(
      { success: false, error: "中介居间模式正在开发中" },
      { status: 501 }
    );
  }

  // ===== 7. 建 contract =====
  const { data: contract, error: contractErr } = await admin
    .from("contracts")
    .insert({
      household_id: lease.household_id,
      lease_id: lease.id,
      template_type: templateType,
      status: "draft",
    })
    .select()
    .single();
  if (contractErr || !contract) {
    return NextResponse.json(
      { success: false, error: contractErr?.message ?? "创建合同失败" },
      { status: 500 }
    );
  }

  // ===== 8. 生成初稿 PDF =====
  let pdfBuf: Buffer;
  try {
    pdfBuf = await generateInitialPdf("direct", {
      contract_id: contract.id,
      landlord: { name: landlordName, phone: landlordPhone, id_number: landlordId },
      tenant: {
        name: primaryTenant.name,
        phone: primaryTenant.phone,
        id_number: primaryTenant.id_number ?? "",
      },
      property: {
        name: lease.property?.name ?? "—",
        address: lease.property?.address ?? "",
        area_sqm: lease.property?.area_sqm ?? null,
      },
      lease: {
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: Number(lease.monthly_rent),
        deposit: Number(lease.deposit ?? 0),
        rent_due_day: Number(lease.rent_due_day ?? 5),
        payment_cycle: lease.payment_cycle ?? "monthly",
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("contracts").delete().eq("id", contract.id);
    return NextResponse.json(
      { success: false, error: `PDF 生成失败：${msg}` },
      { status: 500 }
    );
  }

  // ===== 9. 上传 Storage =====
  const initialPath = `${lease.household_id}/${contract.id}/initial.pdf`;
  const { error: upErr } = await admin.storage
    .from("contracts")
    .upload(initialPath, pdfBuf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    await admin.from("contracts").delete().eq("id", contract.id);
    return NextResponse.json(
      { success: false, error: `PDF 上传失败：${upErr.message}` },
      { status: 500 }
    );
  }
  await admin.from("contracts").update({ pdf_initial_path: initialPath }).eq("id", contract.id);

  // ===== 10. 创建 signers =====
  const tenantToken = generatePublicToken();
  await admin.from("contract_signers").insert([
    {
      contract_id: contract.id,
      role: "landlord",
      sign_order: 1,
      name: landlordName,
      phone: landlordPhone,
      id_number: landlordId,
      public_token: null,
    },
    {
      contract_id: contract.id,
      role: "tenant",
      sign_order: 2,
      name: primaryTenant.name,
      phone: primaryTenant.phone,
      id_number: primaryTenant.id_number,
      public_token: tenantToken,
    },
  ]);

  return NextResponse.json({
    success: true,
    contract_id: contract.id,
    reused: false,
    landlord_sign_url: `${BASE_URL}/contracts/${contract.id}/sign`,
    tenant_sign_url: `${BASE_URL}/sign/${tenantToken}`,
    contract_status: "draft",
  });
}
