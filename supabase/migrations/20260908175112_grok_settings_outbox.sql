-- Installed as 20260908175112. No bindings are seeded by this migration.
create table public.grok_routine_settings (
 account_id uuid not null references public.accounts(id),
 routine_id text not null check(routine_id ~ '^D0[1-5]-W0[1-9]$'),
 context_generation bigint not null check(context_generation>=0),
 worker_id text not null check(length(worker_id) between 1 and 120),
 binding_evidence text not null check(length(binding_evidence) between 1 and 1000),
 enabled boolean not null default false,
 schedule_time time not null default '08:00',
 timezone text not null default 'UTC',
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(account_id,routine_id)
);
create table public.grok_settings_outbox (
 id uuid primary key,
 account_id uuid not null,
 routine_id text not null,
 context_generation bigint not null,
 revision bigint not null,
 change jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(account_id,routine_id) references public.grok_routine_settings(account_id,routine_id),
 unique(account_id,routine_id,revision)
);
alter table public.grok_routine_settings enable row level security;
alter table public.grok_settings_outbox enable row level security;
revoke all on public.grok_routine_settings,public.grok_settings_outbox from public,anon,authenticated,service_role;
grant select,insert on public.grok_routine_settings,public.grok_settings_outbox to service_role;
grant update(enabled,schedule_time,timezone,revision,updated_at) on public.grok_routine_settings to service_role;

-- Binding is a deliberate cutover, never a customer-controlled URL or bot name.
-- Accounts must be paused and all old work settled before registering ownership.
create function public.guard_grok_binding() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype;
begin
 select * into a from public.accounts where id=new.account_id for update;
 if not found or not a.automation_paused or a.context_generation is distinct from new.context_generation then
  raise exception 'Pause and verify account before runtime cutover' using errcode='40001';end if;
 if new.enabled or new.revision<>0 then raise exception 'Binding must start disabled' using errcode='23514';end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone' using errcode='22023';end if;
 if exists(select 1 from public.routine_states where account_id=new.account_id and routine_id=new.routine_id and enabled) or
    exists(select 1 from public.routine_runs where account_id=new.account_id and routine_id=new.routine_id and status in ('running','waiting_approval')) then
  raise exception 'Legacy routine must be disabled and settled' using errcode='40001';end if;
 return new;
end $$;
create trigger grok_binding_guard before insert on public.grok_routine_settings for each row execute function public.guard_grok_binding();

-- Old binaries still write routine_states/routine_runs: fence them in storage,
-- not only in the next scheduler build. Disabled legacy rows stay disabled.
alter table public.routine_runs add column scheduling_owner text not null default 'junction'
 check(scheduling_owner in ('junction','grok'));
create function public.guard_grok_scheduler_owner() returns trigger language plpgsql security invoker set search_path='' as $$
declare has_binding boolean;binding_generation bigint;current_generation bigint;binding_enabled boolean;
begin
 select context_generation into current_generation from public.accounts where id=new.account_id for share;
 select context_generation,enabled into binding_generation,binding_enabled from public.grok_routine_settings where account_id=new.account_id and routine_id=new.routine_id;
 has_binding:=found;
 if tg_table_name='routine_states' then
  if has_binding and new.enabled then raise exception 'Routine is managed by Grok' using errcode='40001';end if;
 else
  if (has_binding and (new.scheduling_owner<>'grok' or binding_generation is distinct from current_generation)) or
     (not has_binding and new.scheduling_owner<>'junction') then
   raise exception 'Wrong routine scheduling owner' using errcode='40001';end if;
  if has_binding and not binding_enabled and (tg_op='INSERT' or new.status in ('running','waiting_approval')) then
   raise exception 'Grok routine is disabled' using errcode='40001';end if;
  if tg_op='UPDATE' and new.scheduling_owner is distinct from old.scheduling_owner then
   raise exception 'Run scheduling owner is immutable' using errcode='23514';end if;
 end if;
 return new;
end $$;
create trigger grok_scheduler_owner before insert or update on public.routine_states for each row execute function public.guard_grok_scheduler_owner();
create trigger grok_scheduler_owner before insert or update on public.routine_runs for each row execute function public.guard_grok_scheduler_owner();

create function public.set_grok_agent_settings(p_account uuid,p_actor uuid,p_generation bigint,p_routine text,
 p_enabled boolean,p_time text,p_timezone text,p_expected_revision bigint,p_change_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype;s public.grok_routine_settings%rowtype;prior public.grok_settings_outbox%rowtype;change jsonb;
begin
 select * into a from public.accounts where id=p_account for share;
 perform 1 from public.account_members where account_id=p_account and user_id=p_actor and role='owner' for share;
 if not found or a.id is null then raise exception 'Owner required' using errcode='42501';end if;
 if a.context_generation is distinct from p_generation then raise exception 'Context changed' using errcode='40001';end if;
 if p_enabled is null or p_change_id is null or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
  p_expected_revision is null or p_expected_revision<0 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
  raise exception 'Invalid settings' using errcode='22023';end if;
 if p_enabled and a.automation_paused then raise exception 'Automation paused' using errcode='40001';end if;
 select * into s from public.grok_routine_settings where account_id=p_account and routine_id=p_routine for update;
 if not found or s.context_generation is distinct from p_generation then raise exception 'Verified runtime binding required' using errcode='40001';end if;
 select * into prior from public.grok_settings_outbox where id=p_change_id;
 if found then
  if prior.account_id is distinct from p_account or prior.routine_id is distinct from p_routine or
   prior.context_generation is distinct from p_generation or prior.revision<>p_expected_revision+1 or
   prior.change->'enabled' is distinct from to_jsonb(p_enabled) or prior.change#>>'{schedule,time}' is distinct from p_time or
   prior.change#>>'{schedule,timezone}' is distinct from p_timezone then raise exception 'Conflicting change ID' using errcode='23514';end if;
  return jsonb_build_object('change',prior.change,'revision',prior.revision,'duplicate',true,'superseded',s.revision<>prior.revision);
 end if;
 if s.revision<>p_expected_revision then raise exception 'Settings changed' using errcode='40001';end if;
 update public.grok_routine_settings set enabled=p_enabled,schedule_time=p_time::time,timezone=p_timezone,
  revision=revision+1,updated_at=clock_timestamp() where account_id=p_account and routine_id=p_routine returning * into s;
 change:=jsonb_build_object('changeId',p_change_id,'accountId',p_account,'routineId',p_routine,
  'contextGeneration',p_generation,'workerId',s.worker_id,'enabled',s.enabled,'stateUpdatedAt',s.updated_at,
  'schedule',jsonb_build_object('time',p_time,'timezone',p_timezone),'expiresAt',s.updated_at+interval '1 hour');
 insert into public.grok_settings_outbox(id,account_id,routine_id,context_generation,revision,change)
  values(p_change_id,p_account,p_routine,p_generation,s.revision,change);
 return jsonb_build_object('change',change,'revision',s.revision,'duplicate',false,'superseded',false);
end $$;
revoke all on function public.guard_grok_binding(),public.guard_grok_scheduler_owner(),
 public.set_grok_agent_settings(uuid,uuid,bigint,text,boolean,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.guard_grok_binding(),public.guard_grok_scheduler_owner(),
 public.set_grok_agent_settings(uuid,uuid,bigint,text,boolean,text,text,bigint,uuid) to service_role;

-- Control records now validate against Grok desired settings when bound; retain
-- the existing fixture/legacy path for unbound routines. No live bindings added.
create or replace function public.guard_grok_control_record() returns trigger
language plpgsql security invoker set search_path='' as $$
declare current_generation bigint;paused boolean;change jsonb;ack jsonb;state_enabled boolean;state_updated timestamptz;
 request public.grok_control_records%rowtype;binding public.grok_routine_settings%rowtype;
begin
 select context_generation,automation_paused into current_generation,paused from public.accounts where id=new.account_id for share;
 if not found or current_generation is distinct from new.context_generation then raise exception 'Control context changed' using errcode='40001';end if;
 if new.platform='grok_control_request' then
  change:=new.payload->'change';
  if change->>'changeId' is distinct from new.id::text then raise exception 'Change identity mismatch' using errcode='23514';end if;
 else
  select * into request from public.grok_control_records where id=(new.payload->>'requestId')::uuid and account_id=new.account_id and context_generation=new.context_generation and platform='grok_control_request';
  if not found then raise exception 'Control request unavailable' using errcode='23514';end if;
  change:=request.payload->'change';ack:=new.payload->'ack';
  if ack->>'changeId' is distinct from request.id::text or ack->>'workerId' is distinct from change->>'workerId' then
   raise exception 'Acknowledgement identity mismatch' using errcode='23514';end if;
  if ack->>'status' not in ('applied','blocked','failed') or ack->>'status' is null then raise exception 'Invalid acknowledgement' using errcode='23514';end if;
  if ack->>'status'='applied' and ((ack->'enabled') is distinct from change->'enabled' or ack->'schedule' is distinct from change->'schedule' or ack->'blocker' is distinct from 'null'::jsonb) then
   raise exception 'Applied state mismatch' using errcode='23514';end if;
 end if;
 if change->>'accountId' is distinct from new.account_id::text or (change->>'contextGeneration')::bigint is distinct from new.context_generation
  or jsonb_typeof(change->'enabled') is distinct from 'boolean' then raise exception 'Control scope mismatch' using errcode='23514';end if;
 if (change->>'expiresAt')::timestamptz<=now() or change->>'expiresAt' is null then raise exception 'Control expired' using errcode='40001';end if;
 select * into binding from public.grok_routine_settings where account_id=new.account_id and routine_id=change->>'routineId' for share;
 if found then
  state_enabled:=binding.enabled;state_updated:=binding.updated_at;
  if binding.context_generation is distinct from new.context_generation or binding.worker_id is distinct from change->>'workerId' or
   to_char(binding.schedule_time,'HH24:MI') is distinct from change#>>'{schedule,time}' or binding.timezone is distinct from change#>>'{schedule,timezone}' then
   raise exception 'Control binding changed' using errcode='40001';end if;
 else
  select enabled,updated_at into state_enabled,state_updated from public.routine_states
   where account_id=new.account_id and routine_id=change->>'routineId' for share;
 end if;
 if state_enabled is distinct from (change->>'enabled')::boolean or state_updated is distinct from (change->>'stateUpdatedAt')::timestamptz then
  raise exception 'Control settings superseded' using errcode='40001';end if;
 if paused and (change->>'enabled')::boolean then raise exception 'Cannot enable paused account' using errcode='55000';end if;
 return new;
end $$;
