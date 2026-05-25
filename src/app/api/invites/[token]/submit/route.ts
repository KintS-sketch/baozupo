import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

interface SubmitBody {
  // 租客信息
  name?: string;
  phone?: string;
  id_number?: string;
  wechat_id?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
  // 租约信息（让租客填，房东采纳时核对）
  start_date?: string;
  duration_months?: number | string;
  monthly_rent?: number | string;
  deposit?: number | string;
  payment_cycle?: string;
  // 中介信息（agent 模式或 dualRole 模式选中介时携带）
  agent_name?: string;
  agent_phone?: string;
  // dualRole 模式下，填表人自己选的角色: "tenant" | "agent"
  chosen_role?: string;
}

// 简单中国大陆手机号校验
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 6) {
    return NextResponse.json({ error: "链接无效" }, { status: 400 });
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  // 校验
  const name = (body.name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  if (!name) return NextResponse.json({ error: "请填写姓名" }, { status: 400 });
  if (!isValidPhone(phone)) {
    return NextResponse.json({ error: "请输入有效的中国大陆手机号" }, { status: 400 });
  }
  if (
    body.emergency_contact_phone &&
    !isValidPhone(body.emergency_contact_phone.trim())
  ) {
    return NextResponse.json(
      { error: "紧急联系人电话格式不正确" },
      { status: 400 }
    );
  }

  // 租约字段校验
  const startDate = (body.start_date ?? "").trim();
  const durationMonths = Number(body.duration_months);
  const monthlyRent = Number(body.monthly_rent);
  const deposit = Number(body.deposit);
  const paymentCycle = (body.payment_cycle ?? "").trim();
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "请填写起租日期" }, { status: 400 });
  }
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
    return NextResponse.json({ error: "租期需为 1-120 之间的整数" }, { status: 400 });
  }
  if (!Number.isFinite(monthlyRent) || monthlyRent < 0) {
    return NextResponse.json({ error: "月租金格式不正确" }, { status: 400 });
  }
  if (!Number.isFinite(deposit) || deposit < 0) {
    return NextResponse.json({ error: "押金格式不正确" }, { status: 400 });
  }
  if (!["monthly", "quarterly", "semiannual", "annual"].includes(paymentCycle)) {
    return NextResponse.json({ error: "请选择有效的付款周期" }, { status: 400 });
  }

  // 用 anon 客户端（无 user session）走 RLS public_submit_by_token 策略
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  // 先验证 token 存在且未提交未过期
  const { data: invite, error: fetchErr } = await supabase
    .from("form_invites")
    .select("id, submitted_at, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (fetchErr || !invite) {
    return NextResponse.json({ error: "链接不存在或已过期" }, { status: 404 });
  }
  if (invite.submitted_at) {
    return NextResponse.json(
      { error: "本链接已提交过了，无法重复填写" },
      { status: 409 }
    );
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "本链接已失效" }, { status: 410 });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "链接已过期" }, { status: 410 });
  }

  const submittedData = {
    name,
    phone,
    id_number: body.id_number?.trim() || null,
    wechat_id: body.wechat_id?.trim() || null,
    emergency_contact_name: body.emergency_contact_name?.trim() || null,
    emergency_contact_phone: body.emergency_contact_phone?.trim() || null,
    notes: body.notes?.trim() || null,
    // 租约信息（房东采纳时核对 + 自动建租约）
    start_date: startDate,
    duration_months: durationMonths,
    monthly_rent: monthlyRent,
    deposit: deposit,
    payment_cycle: paymentCycle,
    // 中介信息（agent / dualRole 模式选中介时）
    agent_name: body.agent_name?.trim() || null,
    agent_phone: body.agent_phone?.trim() || null,
    // 反馈 #12: 填表人自选角色（dualRole 用），房东采纳时据此决定直租/中介
    chosen_role: body.chosen_role === "agent" ? "agent" : "tenant",
  };

  const { error: updateErr } = await supabase
    .from("form_invites")
    .update({
      submitted_data: submittedData,
      submitted_at: new Date().toISOString(),
    })
    .eq("token", token);

  if (updateErr) {
    return NextResponse.json(
      { error: "提交失败：" + updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
