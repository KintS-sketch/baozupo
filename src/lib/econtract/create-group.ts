/**
 * 创建一组关联合同（《租赁合同》+《居间服务协议》）。
 * 同 contract_group_id；分别生成 PDF；分别建 4 个 signers。
 *
 * 失败时回滚（删除已创建的 contracts 行）。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { generateInitialPdf } from "./pdf-generator";

// 项目暂无生成的 Database 类型，用 any 让 .from(...).insert(...) 接受未声明的列
// （契合 src/lib/supabase/service.ts 的写法）。
type SupabaseAdmin = SupabaseClient<any, "public", any>;

interface CreateGroupInput {
  admin: SupabaseAdmin;
  lease: {
    id: string;
    household_id: string;
    start_date: string;
    end_date: string;
    monthly_rent: number;
    deposit: number;
    rent_due_day: number;
    payment_cycle: string;
    agent_name: string;
    agent_phone: string;
    agent_fee: number;
    property: { name: string; address: string; area_sqm?: number | null; city?: string | null };
  };
  landlord: { name: string; phone: string; id_number: string };
  primaryTenant: { name: string; phone: string; id_number: string };
}

interface CreateGroupResult {
  success: true;
  contract_group_id: string;
  rental_contract_id: string;
  broker_contract_id: string;
}

export async function createBrokerContractGroup(
  input: CreateGroupInput
): Promise<CreateGroupResult> {
  const { admin, lease, landlord, primaryTenant } = input;

  // 必填校验
  if (!lease.agent_name?.trim() || !lease.agent_phone?.trim() || !lease.agent_fee) {
    throw new Error("中介姓名 / 手机号 / 居间费不能为空");
  }

  const groupId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();
  const createdContractIds: string[] = [];

  try {
    // ===== 1. 创建《租赁合同》contract A =====
    const { data: contractA, error: errA } = await admin
      .from("contracts")
      .insert({
        household_id: lease.household_id,
        lease_id: lease.id,
        template_type: "direct",
        contract_group_id: groupId,
        status: "draft",
      })
      .select()
      .single();
    if (errA || !contractA) throw new Error(`创建租赁合同失败：${errA?.message}`);
    createdContractIds.push(contractA.id as string);

    // ===== 2. 创建《居间服务协议》contract B =====
    const { data: contractB, error: errB } = await admin
      .from("contracts")
      .insert({
        household_id: lease.household_id,
        lease_id: lease.id,
        template_type: "broker",
        contract_group_id: groupId,
        status: "draft",
      })
      .select()
      .single();
    if (errB || !contractB) throw new Error(`创建居间协议失败：${errB?.message}`);
    createdContractIds.push(contractB.id as string);

    // ===== 3. 生成 PDF A（直租 + 居间介绍行）=====
    const pdfA = await generateInitialPdf("direct", {
      contract_id: contractA.id as string,
      landlord,
      tenant: primaryTenant,
      property: {
        name: lease.property.name,
        address: lease.property.address,
        area_sqm: lease.property.area_sqm,
      },
      lease: {
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: Number(lease.monthly_rent),
        deposit: Number(lease.deposit),
        rent_due_day: Number(lease.rent_due_day),
        payment_cycle: lease.payment_cycle,
      },
      broker: { name: lease.agent_name, phone: lease.agent_phone },
      generated_at: generatedAt,
    });

    // ===== 4. 生成 PDF B（居间协议）=====
    const pdfB = await generateInitialPdf("broker", {
      contract_id: contractB.id as string,
      landlord,
      broker: {
        name: lease.agent_name,
        phone: lease.agent_phone,
        id_number: "", // 中介签字时填
      },
      property: {
        name: lease.property.name,
        address: lease.property.address,
        city: lease.property.city,
      },
      lease: {
        start_date: lease.start_date,
        monthly_rent: Number(lease.monthly_rent),
      },
      agent_fee: Number(lease.agent_fee),
      generated_at: generatedAt,
    });

    // ===== 5. 上传 PDF 到 Storage =====
    const pathA = `${lease.household_id}/${contractA.id}/initial.pdf`;
    const pathB = `${lease.household_id}/${contractB.id}/initial.pdf`;

    const { error: upErrA } = await admin.storage
      .from("contracts")
      .upload(pathA, pdfA, { contentType: "application/pdf", upsert: true });
    if (upErrA) throw new Error(`上传租赁合同 PDF 失败：${upErrA.message}`);

    const { error: upErrB } = await admin.storage
      .from("contracts")
      .upload(pathB, pdfB, { contentType: "application/pdf", upsert: true });
    if (upErrB) throw new Error(`上传居间协议 PDF 失败：${upErrB.message}`);

    // ===== 6. 写 contract.pdf_initial_path =====
    await admin.from("contracts").update({ pdf_initial_path: pathA }).eq("id", contractA.id as string);
    await admin.from("contracts").update({ pdf_initial_path: pathB }).eq("id", contractB.id as string);

    // ===== 7. 创建 4 个 signers =====
    const { error: signersErr } = await admin.from("contract_signers").insert([
      // 租赁合同 A
      {
        contract_id: contractA.id,
        role: "landlord",
        sign_order: 1,
        name: landlord.name,
        phone: landlord.phone,
        id_number: landlord.id_number,
        public_token: null,
      },
      {
        contract_id: contractA.id,
        role: "tenant",
        sign_order: 2,
        name: primaryTenant.name,
        phone: primaryTenant.phone,
        id_number: primaryTenant.id_number,
        public_token: crypto.randomUUID(),
      },
      // 居间协议 B
      {
        contract_id: contractB.id,
        role: "landlord",
        sign_order: 1,
        name: landlord.name,
        phone: landlord.phone,
        id_number: landlord.id_number,
        public_token: null,
      },
      {
        contract_id: contractB.id,
        role: "broker",
        sign_order: 2,
        name: lease.agent_name,
        phone: lease.agent_phone,
        id_number: null, // 中介签字时自填
        public_token: crypto.randomUUID(),
      },
    ]);
    if (signersErr) throw new Error(`创建签字人失败：${signersErr.message}`);

    return {
      success: true,
      contract_group_id: groupId,
      rental_contract_id: contractA.id as string,
      broker_contract_id: contractB.id as string,
    };
  } catch (err) {
    // 回滚：删除已创建的 contracts（contract_signers 通过 FK CASCADE 一并清）
    for (const id of createdContractIds) {
      await admin.from("contracts").delete().eq("id", id);
    }
    throw err;
  }
}
