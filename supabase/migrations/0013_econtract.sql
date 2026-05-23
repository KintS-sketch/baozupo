-- ============================================================
-- 0013 — 轻签约 v1：电子合同 + 签署方
--
-- 依据《电子签名法》第 13/14 条做轻量电子签约
-- 双签（直租）/ 三签（中介居间）共用同一套表
-- ============================================================

-- contracts：一份合同对应一条记录
create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  lease_id        uuid not null references public.leases(id) on delete cascade,
  template_type   text not null check (template_type in ('direct', 'agent')),
  status          text not null default 'draft'
                  check (status in ('draft', 'partial', 'signed', 'void', 'expired')),
  pdf_initial_path text,                  -- Storage 路径 contracts/{household_id}/{contract_id}/initial.pdf
  pdf_final_path   text,                  -- Storage 路径 contracts/{household_id}/{contract_id}/final.pdf
  pdf_hash_sha256  text,                  -- 最终 PDF 的 SHA256 hex
  ts_token         text,                  -- 可信时间戳（v1.1 加，预留）
  expires_at       timestamptz not null default (now() + interval '7 days'),
  signed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists idx_contracts_lease     on public.contracts(lease_id)     where deleted_at is null;
create index if not exists idx_contracts_household on public.contracts(household_id) where deleted_at is null;
create index if not exists idx_contracts_status    on public.contracts(status)       where deleted_at is null;

-- contract_signers：每方一行（直租 2 行 / 中介 3 行）
create table if not exists public.contract_signers (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null references public.contracts(id) on delete cascade,
  role                text not null check (role in ('landlord', 'agent', 'tenant')),
  sign_order          int  not null check (sign_order between 1 and 3),
  name                text not null,
  phone               text not null,
  id_number           text,                                   -- 中介可无身份证号
  public_token        text unique,                            -- 公开签字页访问令牌（房东可为 null）
  signed_at           timestamptz,
  sign_ip             text,
  sign_ua             text,
  signature_image_path text,                                  -- Storage 路径
  sms_code_hash       text,
  sms_code_expires_at timestamptz,
  sms_sent_at         timestamptz,
  sms_verified_at     timestamptz,
  sms_attempts        int not null default 0,
  sms_locked_until    timestamptz,
  created_at          timestamptz not null default now(),
  unique (contract_id, role)
);

create index if not exists idx_signers_contract on public.contract_signers(contract_id);
create index if not exists idx_signers_token    on public.contract_signers(public_token) where public_token is not null;

-- ===== RLS =====
alter table public.contracts        enable row level security;
alter table public.contract_signers enable row level security;

-- contracts：房东只看 / 改自己 household 下的（沿用 0002 的 household_members 模式）
drop policy if exists "contracts_household_members" on public.contracts;
create policy "contracts_household_members" on public.contracts
  for all
  using (
    household_id in (
      select household_id from public.household_members where user_id = auth.uid()
    )
  )
  with check (
    household_id in (
      select household_id from public.household_members where user_id = auth.uid()
    )
  );

-- contract_signers：通过 contract -> household 关联鉴权
drop policy if exists "signers_household_members" on public.contract_signers;
create policy "signers_household_members" on public.contract_signers
  for all
  using (
    contract_id in (
      select c.id from public.contracts c
      where c.household_id in (
        select household_id from public.household_members where user_id = auth.uid()
      )
    )
  )
  with check (
    contract_id in (
      select c.id from public.contracts c
      where c.household_id in (
        select household_id from public.household_members where user_id = auth.uid()
      )
    )
  );

-- ===== 触发器：updated_at 自动维护 =====
create or replace function public.set_contracts_updated_at()
  returns trigger
  language plpgsql
  as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_contracts_updated_at();

-- ===== 授权 =====
grant all on public.contracts        to authenticated;
grant all on public.contract_signers to authenticated;
