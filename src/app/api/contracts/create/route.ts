/**
 * POST /api/contracts/create
 * 房东点「发起电子签」→ 创建合同 + 生成初稿 PDF + 准备各方签字。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInitialPdf } from "@/lib/econtract/pdf-generator";
import { generatePublicToken } from "@/lib/econtract/tokens";

export const runtime = "nodejs";
export const maxDuration = 30;

interface LeaseTenantRel {
  is_primary: boolean;
  tenant: {
    id: string;
    name: string;
    phone: string;
    id_number: string | null;
  } | null;
}

interface LeaseRow {
  id: string;
  household_id: string;
  property_id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number | string;
  deposit: number | string | null;
  rent_due_day: number | null;
  payment_cycle: string | null;
  rental_source: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  agent_fee: number | string | null;
  property: {
    name: string;
    address: string | null;
    area_sqm: number | null;
  } | null;
  lease_tenants: LeaseTenantRel[] | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

  let body: { lease_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "无效 JSON" }, { status: 400 });
  }
  const leaseId = body.lease_id;
  if (!leaseId) return NextResponse.json({ success: false, error: "缺少 lease_id" }, { status: 400 });

  // ===== 1. 拉租约 + 关联数据 =====
  const { data: leaseRaw, error: leaseErr } = await supabase
    .from("leases")
    .select(`
      id, household_id, property_id, start_date, end_date,
      monthly_rent, deposit, rent_due_day, payment_cycle,
      rental_source, agent_name, agent_phone, agent_fee,
      property:properties(name, address, area_sqm:area),
      lease_tenants(is_primary, tenant:tenants(id, name, phone, id_number))
    `)
    .eq("id", leaseId)
    .is("deleted_at", null)
    .single();

  if (leaseErr || !leaseRaw) {
    return NextResponse.json({ success: false, error: "租约不存在" }, { status: 404 });
  }
  // supabase-js 把单条关联也包成数组，统一处理
  const lease = normalizeLease(leaseRaw);

  // ===== 2. 已存在合同则复用 =====
  const { data: existing } = await supabase
    .from("contracts")
    .select("id, status")
    .eq("lease_id", leaseId)
    .is("deleted_at", null)
    .in("status", ["draft", "partial", "signed"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ success: true, contract_id: existing.id, reused: true });
  }

  // ===== 3. 取主租客 =====
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

  // ===== 5. 取房东信息（从 auth.user.phone + user_profiles）=====
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("real_name, id_number")
    .eq("id", user.id)
    .single();
  const landlordPhone = user.phone ?? "";
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
        error: `请先到「设置 → 房东实名」补全：${landlordMissing.join("、")}`,
        code: "LANDLORD_PROFILE_INCOMPLETE",
      },
      { status: 412 }
    );
  }

  // ===== 6. 决定模板 =====
  const templateType = lease.rental_source === "agent" ? "agent" : "direct";
  if (templateType === "agent") {
    // Task 16 实现 agent 模板
    return NextResponse.json(
      { success: false, error: "中介居间模式正在开发中" },
      { status: 501 }
    );
  }

  // ===== 7. 创建 contract 行 =====
  const { data: contract, error: contractErr } = await supabase
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
    // 回滚 contract
    await supabase.from("contracts").delete().eq("id", contract.id);
    return NextResponse.json({ success: false, error: `PDF 生成失败：${msg}` }, { status: 500 });
  }

  // ===== 9. 上传 Storage =====
  // 路径规范（适配 0004 RLS）：contracts/{household_id}/{contract_id}/initial.pdf
  const initialPath = `${lease.household_id}/${contract.id}/initial.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(initialPath, pdfBuf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    await supabase.from("contracts").delete().eq("id", contract.id);
    return NextResponse.json({ success: false, error: `PDF 上传失败：${upErr.message}` }, { status: 500 });
  }
  await supabase.from("contracts").update({ pdf_initial_path: initialPath }).eq("id", contract.id);

  // ===== 10. 创建 contract_signers =====
  // 直租：landlord (order 1) + tenant (order 2)
  await supabase.from("contract_signers").insert([
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
      public_token: generatePublicToken(),
    },
  ]);

  return NextResponse.json({
    success: true,
    contract_id: contract.id,
    reused: false,
  });
}

/** supabase-js 把单条关联也包成数组，这里统一展平 */
function normalizeLease(row: Record<string, unknown>): LeaseRow {
  const property = Array.isArray(row.property) ? row.property[0] : row.property;
  const lease_tenants = (row.lease_tenants ?? []) as Array<{ is_primary: boolean; tenant: unknown }>;
  return {
    ...row,
    property: (property as LeaseRow["property"]) ?? null,
    lease_tenants: lease_tenants.map((lt) => ({
      is_primary: lt.is_primary,
      tenant: Array.isArray(lt.tenant) ? lt.tenant[0] : (lt.tenant as LeaseTenantRel["tenant"]),
    })),
  } as LeaseRow;
}
