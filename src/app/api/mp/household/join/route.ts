/**
 * POST /api/mp/household/join
 *
 * 用 6 位邀请码加入别人的家庭组。
 * Body: { code: string }
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface JoinBody {
  code?: string;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: JoinBody;
  try {
    body = (await req.json()) as JoinBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const code = (body.code ?? "").trim().toUpperCase();
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: "请输入 6 位邀请码" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json({ error: "服务端配置缺失" }, { status: 500 });

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 找邀请码
  const { data: invite } = await admin
    .from("household_invites")
    .select("id, household_id, used_at, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: "邀请码无效" }, { status: 404 });
  if (invite.used_at) return NextResponse.json({ error: "邀请码已被使用" }, { status: 410 });
  if (new Date(invite.expires_at) < new Date())
    return NextResponse.json({ error: "邀请码已过期" }, { status: 410 });

  // 校验：用户当前不在这个 household
  const { data: existing } = await admin
    .from("household_members")
    .select("id")
    .eq("household_id", invite.household_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "你已经是该家庭组的成员" }, { status: 409 });
  }

  // 检查用户当前已在的 household 列表
  // - 注册时 migration 0017 会自动建一个"我的家庭组"给每个新用户，所以单纯检查
  //   是否有 member 记录会让"加入家人家庭组"永远失败
  // - 改造：
  //   1. 若当前 household 是"空壳"（无 properties / leases / tenants）→ 自动回收（删空 household
  //      和对应 household_members）→ 让用户能加入新家庭组（典型场景：新用户注册后扫码加入老婆的家庭组）
  //   2. 若当前 household 已有业务数据 → 报错引导清理（避免静默丢数据）
  const { data: anyMembers } = await admin
    .from("household_members")
    .select("id, household_id")
    .eq("user_id", user.id);

  if (anyMembers && anyMembers.length > 0) {
    const currentHouseholdIds = anyMembers.map((m) => m.household_id);

    // 数核心业务数据：properties + leases + tenants 三个有 household_id 字段且能代表"是否用过"
    // bills / payments / meter_readings / form_invites 都依赖前三者，间接覆盖
    const [propsRes, leasesRes, tenantsRes] = await Promise.all([
      admin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .in("household_id", currentHouseholdIds),
      admin
        .from("leases")
        .select("id", { count: "exact", head: true })
        .in("household_id", currentHouseholdIds),
      admin
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .in("household_id", currentHouseholdIds),
    ]);

    const propCount = propsRes.count ?? 0;
    const leaseCount = leasesRes.count ?? 0;
    const tenantCount = tenantsRes.count ?? 0;
    const hasData = propCount + leaseCount + tenantCount > 0;

    if (hasData) {
      return NextResponse.json(
        {
          error: `你账号下已有数据（${propCount} 套房源 / ${leaseCount} 份租约 / ${tenantCount} 个租客），请先在「我的 → 家庭组」里清理或转移，再扫码加入新家庭组`,
        },
        { status: 409 }
      );
    }

    // 全空 → 安全回收：删 household_members + 孤立 household
    for (const m of anyMembers) {
      const { error: delMemberErr } = await admin
        .from("household_members")
        .delete()
        .eq("user_id", user.id)
        .eq("household_id", m.household_id);
      if (delMemberErr) {
        return NextResponse.json(
          { error: "切换家庭组失败：" + delMemberErr.message },
          { status: 500 }
        );
      }

      // 检查这个 household 是不是变空了，空就一并删
      const { count: membersLeft } = await admin
        .from("household_members")
        .select("id", { count: "exact", head: true })
        .eq("household_id", m.household_id);
      if ((membersLeft ?? 0) === 0) {
        await admin.from("households").delete().eq("id", m.household_id);
      }
    }
  }

  // 加入 household
  const { error: insErr } = await admin.from("household_members").insert({
    household_id: invite.household_id,
    user_id: user.id,
    role: "member",
  });
  if (insErr) {
    return NextResponse.json(
      { error: "加入失败：" + insErr.message },
      { status: 500 }
    );
  }

  // 标记邀请码已用
  await admin
    .from("household_invites")
    .update({ used_at: new Date().toISOString(), used_by: user.id })
    .eq("id", invite.id);

  return NextResponse.json({
    success: true,
    household_id: invite.household_id,
  });
}
