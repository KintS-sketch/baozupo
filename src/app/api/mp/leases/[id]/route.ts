/**
 * GET /api/mp/leases/[id]
 *
 * 单个租约详情。复刻 PWA leases/page.tsx 的 detailOpen 弹窗数据需求：
 *  - 租约基础字段
 *  - 房源 name + address
 *  - 主租客（含手机/证件号/紧急联系人 — 详情页要完整展示）
 *  - 所有账单（按 due_date 排序）— 交付情况一览
 *  - 附件列表 — 合同/文件
 *  - 电子签合同状态（如有）
 *
 * 认证：Bearer token
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.household_id)
    return NextResponse.json({ error: "无家庭组" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: lease, error: lErr } = await admin
      .from("leases")
      .select(
        `id, property_id, start_date, end_date, monthly_rent, deposit,
         payment_cycle, billing_mode, rent_due_day, status,
         rental_source, agent_name, agent_phone, agent_fee, notes,
         property:properties(name, address),
         lease_tenants(is_primary, tenant:tenants(
           id, name, phone, id_number, wechat_id,
           emergency_contact_name, emergency_contact_phone
         ))`
      )
      .eq("id", id)
      .eq("household_id", user.household_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!lease) {
      return NextResponse.json({ error: "租约不存在或不属于你" }, { status: 404 });
    }

    const [{ data: bills }, { data: attachments }, { data: contract }] =
      await Promise.all([
        admin
          .from("bills")
          .select(
            "id, period_start, period_end, due_date, total_amount, paid_amount, status"
          )
          .eq("lease_id", id)
          .order("due_date", { ascending: true }),
        admin
          .from("attachments")
          .select("id, file_name, file_url, mime_type, file_size, created_at")
          .eq("entity_type", "lease")
          .eq("entity_id", id)
          .order("created_at", { ascending: false }),
        admin
          .from("contracts")
          .select("id, status")
          .eq("lease_id", id)
          .maybeSingle()
          .then((res) => ({ data: res.data })),
      ]);

    // supabase 嵌套 join 字段兜底（可能是数组也可能单对象）
    const asArr = <T,>(v: T | T[] | null | undefined): T[] =>
      !v ? [] : Array.isArray(v) ? v : [v];
    type PropLite = { name: string; address: string | null };
    type TenantLite = {
      id: string;
      name: string;
      phone: string;
      id_number: string | null;
      wechat_id: string | null;
      emergency_contact_name: string | null;
      emergency_contact_phone: string | null;
    };
    const row = lease as unknown as {
      property: PropLite | PropLite[] | null;
      lease_tenants?: { is_primary: boolean; tenant: TenantLite | TenantLite[] | null }[];
    };
    const propRow = asArr(row.property)[0];
    const lts = row.lease_tenants ?? [];
    const tenantList = lts.flatMap((lt) => asArr(lt.tenant));
    const primary =
      lts.filter((lt) => lt.is_primary).flatMap((lt) => asArr(lt.tenant))[0] ??
      tenantList[0] ??
      null;

    // 准备生成附件签名 URL（PWA contracts bucket 是 private）
    let signedUrls: Record<string, string> = {};
    if (attachments && attachments.length > 0) {
      const results = await Promise.all(
        (attachments as Array<{ id: string; file_url: string }>).map(async (a) => {
          const { data: signed } = await admin.storage
            .from("contracts")
            .createSignedUrl(a.file_url, 60 * 60); // 1 小时有效
          return { id: a.id, url: signed?.signedUrl ?? null };
        })
      );
      signedUrls = Object.fromEntries(
        results.filter((r) => !!r.url).map((r) => [r.id, r.url!])
      );
    }

    return NextResponse.json({
      lease: {
        id: lease.id,
        property_id: lease.property_id,
        property_name: propRow?.name ?? "—",
        property_address: propRow?.address ?? null,
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent: Number(lease.monthly_rent),
        deposit: Number(lease.deposit),
        payment_cycle: lease.payment_cycle,
        billing_mode: lease.billing_mode,
        rent_due_day: lease.rent_due_day,
        status: lease.status,
        rental_source: lease.rental_source,
        agent_name: lease.agent_name,
        agent_phone: lease.agent_phone,
        agent_fee: lease.agent_fee != null ? Number(lease.agent_fee) : null,
        notes: lease.notes,
      },
      primary_tenant: primary,
      bills: (bills ?? []).map((b: { total_amount: number | string; paid_amount: number | string } & Record<string, unknown>) => ({
        ...b,
        total_amount: Number(b.total_amount),
        paid_amount: Number(b.paid_amount),
      })),
      attachments: (attachments ?? []).map((a: { id: string }) => ({
        ...a,
        signed_url: signedUrls[a.id] ?? null,
      })),
      contract,
    });
  } catch (err) {
    console.error("[api/mp/leases/[id]] fail", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}
