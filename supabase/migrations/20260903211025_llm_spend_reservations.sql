-- Atomic per-account LLM spend admission (2026-09-04).
--
-- A process-local mutex cannot stop the app and worker (or two app instances) from both
-- reading the same llm_usage total and spending past the monthly cap. A short-lived durable
-- reservation closes that gap: reserve_llm_spend locks the account row, totals committed usage
-- plus every active reservation, and inserts only when the request ceiling fits. Active
-- reservations admitted just before UTC month rollover still count until completion or expiry.
-- The router releases after its llm_usage insert is durable. A crash or ledger failure retains
-- that ceiling through the admission month (plus a short rollover buffer), so paid usage can
-- never disappear from the cap merely because its final ledger insert failed.

begin;

create table llm_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  ceiling_usd numeric not null check (ceiling_usd > 0),
  month_start date not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index llm_spend_reservations_account_active_idx
  on llm_spend_reservations (account_id, expires_at);

alter table llm_spend_reservations enable row level security;
revoke all on table llm_spend_reservations from public, anon, authenticated;
grant select, insert, delete on table llm_spend_reservations to service_role;

create function public.reserve_llm_spend(
  p_account_id uuid,
  p_ceiling_usd numeric,
  p_default_cap_usd numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_month_start timestamptz;
  v_month_date date;
  v_cap numeric;
  v_spent numeric;
  v_reserved numeric;
  v_reservation_id uuid;
  v_expires_at timestamptz;
begin
  if p_account_id is null then
    raise exception using errcode = '22023', message = 'account id is required';
  end if;
  if p_ceiling_usd is null
     or p_ceiling_usd <= 0
     or p_ceiling_usd::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = '22023', message = 'request ceiling must be a finite positive amount';
  end if;
  if p_default_cap_usd is null
     or p_default_cap_usd::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = '22023', message = 'default cap must be finite';
  end if;

  v_now := clock_timestamp();
  v_month_start := date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_month_date := (v_month_start at time zone 'UTC')::date;

  -- The account row is the shared mutex. Every reserve for one tenant serialises here before
  -- reading usage/reservations, so a later transaction sees the earlier committed reservation.
  select coalesce(a.monthly_llm_cap_usd, p_default_cap_usd)
    into v_cap
    from public.accounts as a
   where a.id = p_account_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'account not found';
  end if;
  if v_cap::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = '22023', message = 'account cap must be finite';
  end if;

  delete from public.llm_spend_reservations as r
   where r.account_id = p_account_id
     and r.expires_at <= v_now;

  select coalesce(sum(coalesce(u.est_cost_usd, 0)), 0)
    into v_spent
    from public.llm_usage as u
   where u.account_id = p_account_id
     and u.created_at >= v_month_start
     and u.created_at < v_month_start + interval '1 month';

  select coalesce(sum(r.ceiling_usd), 0)
    into v_reserved
    from public.llm_spend_reservations as r
   where r.account_id = p_account_id
     and r.expires_at > v_now;

  if v_spent + v_reserved + p_ceiling_usd > v_cap then
    return jsonb_build_object(
      'ok', false,
      'reason', 'budget_exceeded',
      'spent_usd', v_spent,
      'reserved_usd', v_reserved,
      'cap_usd', v_cap
    );
  end if;

  v_expires_at := v_month_start + interval '1 month 30 minutes';
  insert into public.llm_spend_reservations (
    account_id,
    ceiling_usd,
    month_start,
    expires_at,
    created_at
  ) values (
    p_account_id,
    p_ceiling_usd,
    v_month_date,
    v_expires_at,
    v_now
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'spent_usd', v_spent,
    'reserved_usd', v_reserved,
    'cap_usd', v_cap,
    'expires_at', v_expires_at
  );
end;
$function$;

create function public.release_llm_spend_reservation(
  p_account_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_account_id is null or p_reservation_id is null then
    raise exception using errcode = '22023', message = 'account id and reservation id are required';
  end if;

  -- Use the same per-account lock order as reserve so release and admission cannot interleave
  -- around the reservation sum.
  perform 1
    from public.accounts as a
   where a.id = p_account_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'account not found';
  end if;

  delete from public.llm_spend_reservations as r
   where r.id = p_reservation_id
     and r.account_id = p_account_id;
  return found;
end;
$function$;

revoke all on function public.reserve_llm_spend(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reserve_llm_spend(uuid, numeric, numeric) to service_role;

revoke all on function public.release_llm_spend_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_llm_spend_reservation(uuid, uuid) to service_role;

commit;
