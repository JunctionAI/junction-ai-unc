begin;
set local lock_timeout = '5s';

-- An operational hold, not a routine switch or permission to execute actions.
alter table accounts add column automation_paused boolean not null default false;

create schema if not exists unc_private;
revoke all on schema unc_private from public, anon, authenticated;

-- Recoverable context repairs stay outside the exposed API schemas. No credentials
-- belong in this archive. Only a database administrator performs a repair/restore.
create table unc_private.context_repairs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  created_at timestamptz not null default now(),
  reason text not null,
  before_generation bigint not null,
  after_generation bigint not null,
  original_rows jsonb not null,
  evidence jsonb not null default '{}'::jsonb
);
alter table unc_private.context_repairs enable row level security;
revoke all on unc_private.context_repairs from public, anon, authenticated, service_role;

-- This trigger is not a callable RPC. Its narrow definer privilege only reads and
-- locks account controls; original table grants/RLS still authorize every write.
-- FOR SHARE serializes a write with an operator's pause/repair transaction.
create function unc_private.guard_automation_pause() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_account uuid;
  new_account uuid;
  row_account record;
begin
  -- Administrative SQL repair only. A service-role request inside another definer
  -- function is NOT exempt: session_user/role still identify the API caller.
  if session_user in ('postgres', 'supabase_admin')
    and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin') then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;
  if TG_OP <> 'INSERT' then old_account := OLD.account_id; end if;
  if TG_OP <> 'DELETE' then new_account := NEW.account_id; end if;
  -- Turning a switch OFF remains possible during a hold.
  if TG_TABLE_NAME = 'routine_states' then
    if TG_OP <> 'DELETE' and NEW.enabled = false then return NEW; end if;
  end if;
  -- Ordinary state saves can update a plan draft but cannot agree a held plan.
  if TG_TABLE_NAME = 'plans' then
    if TG_OP = 'DELETE' then return OLD; end if;
    if NEW.agreed_at is null then return NEW; end if;
    if TG_OP = 'UPDATE' and NEW.agreed_at is not distinct from OLD.agreed_at then return NEW; end if;
  end if;
  for row_account in
    select id, automation_paused from public.accounts
    where id in (old_account, new_account) order by id for share
  loop
    if row_account.automation_paused then
      raise exception 'Account automation is paused for verified setup' using errcode = '55000';
    end if;
  end loop;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;
revoke all on function unc_private.guard_automation_pause() from public, anon, authenticated, service_role;

do $$
declare target text;
begin
  foreach target in array array[
    'routine_states', 'routine_runs', 'approvals', 'artifacts', 'daily_briefs',
    'self_reviews', 'routine_outcomes', 'routine_params', 'account_presets',
    'account_profiles', 'action_ledger', 'outbound_messages', 'routine_commands', 'plans'
  ] loop
    execute format('create trigger account_automation_pause before insert or update or delete on public.%I for each row execute function unc_private.guard_automation_pause()', target);
  end loop;
end;
$$;

-- The account snapshot stays atomic and includes the server-owned hold state.
create or replace function public.load_account_state_snapshot(p_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'account', jsonb_build_object('id',a.id,'currency',a.currency,'name',a.name,'context_generation',a.context_generation,'automation_paused',a.automation_paused),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at) from public.goals g where g.account_id=a.id),'[]'),
    'resourceProfile', (select to_jsonb(r) from public.resource_profiles r where r.account_id=a.id),
    'teamMembers', coalesce((select jsonb_agg(to_jsonb(t) order by t.position) from public.team_members t where t.account_id=a.id),'[]'),
    'businessProfile', (select to_jsonb(b) from public.business_profiles b where b.account_id=a.id),
    'routineStates', coalesce((select jsonb_agg(jsonb_build_object('account_id',s.account_id,'routine_id',s.routine_id,'enabled',s.enabled)) from public.routine_states s where s.account_id=a.id),'[]'),
    'connectors', coalesce((select jsonb_agg(jsonb_build_object('account_id',c.account_id,'platform',c.platform,'status',c.status)) from public.connectors c where c.account_id=a.id),'[]'),
    'chatMessages', coalesce((select jsonb_agg(to_jsonb(m) order by m.position) from public.chat_messages m where m.account_id=a.id and m.channel='app'),'[]'),
    'stateMeta', (select jsonb_build_object('account_id',s.account_id,'schema_version',s.schema_version,'client_state',s.client_state,'revision',s.revision) from public.account_state_meta s where s.account_id=a.id)
  ) from public.accounts a where a.id=p_account_id;
$$;
commit;
