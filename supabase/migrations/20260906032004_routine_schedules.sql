-- Saved schedule authority is distinct from a user message. A slot claims one
-- existing routine command atomically; the existing worker/admission executes it.
begin;
create table public.routine_schedules (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
  context_generation bigint not null check(context_generation>=0), user_id uuid not null references auth.users(id),
  routine_id text not null, version integer not null check(version>0), spec_hash text not null check(spec_hash~'^[a-f0-9]{64}$'),
  workflow_hash text not null check(workflow_hash~'^[a-f0-9]{64}$'), revision bigint not null default 0 check(revision>=0),
  enabled boolean not null default false, timezone text not null, hour integer not null check(hour between 0 and 23),
  minute integer not null check(minute between 0 and 59), weekday integer check(weekday between 0 and 6), on_date date,
  channel text not null check(channel in ('app','slack')), channel_binding jsonb,
  starts_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(account_id,context_generation,routine_id),
  check((channel='app' and channel_binding is null) or (channel='slack' and jsonb_typeof(channel_binding)='object'))
);
create table public.routine_schedule_claims (
  schedule_id uuid not null references public.routine_schedules(id), revision bigint not null,
  local_date date not null, slot_at timestamptz not null, command_id uuid not null unique,
  primary key(schedule_id,revision,local_date)
);
alter table public.routine_schedules enable row level security;
alter table public.routine_schedule_claims enable row level security;
revoke all on public.routine_schedules,public.routine_schedule_claims from public,anon,authenticated,service_role;
grant select,insert,update on public.routine_schedules to service_role;
grant select,insert on public.routine_schedule_claims to service_role;

create function public.guard_routine_schedule() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.id,new.account_id,new.context_generation,new.routine_id,new.user_id) is distinct from
       row(old.id,old.account_id,old.context_generation,old.routine_id,old.user_id) then
      raise exception 'Schedule identity is immutable' using errcode='23514'; end if;
    new.revision:=old.revision+1;
    new.starts_at:=clock_timestamp();
  else new.revision:=0; new.starts_at:=clock_timestamp(); end if;
  new.updated_at:=clock_timestamp();
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'Valid IANA timezone required' using errcode='23514'; end if;
  if not exists(select 1 from public.accounts a join public.account_members m on m.account_id=a.id
    where a.id=new.account_id and a.context_generation=new.context_generation and m.user_id=new.user_id and m.role='owner') then
    raise exception 'Current owner context required' using errcode='42501'; end if;
  if new.enabled and not exists(select 1 from public.accounts a join public.routine_states s on s.account_id=a.id
    where a.id=new.account_id and not a.automation_paused and s.routine_id=new.routine_id and s.enabled and s.version=new.version) then
    raise exception 'Enabled current routine required' using errcode='40001'; end if;
  if new.channel='slack' and (new.channel_binding->>'accountId' is distinct from new.account_id::text
    or new.channel_binding->>'userId' is distinct from new.user_id::text
    or new.channel_binding->>'contextGeneration' is distinct from new.context_generation::text
    or public.verify_channel_inbound_binding(new.channel_binding,new.channel_binding,false) is null) then
    raise exception 'Verified delivery destination required' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function public.guard_routine_schedule() from public,anon,authenticated,service_role;
create trigger routine_schedule_guard before insert or update on public.routine_schedules for each row execute function public.guard_routine_schedule();

create function public.routine_scheduled_command_current(p_request_id text,p_account_id uuid,p_user_id uuid) returns boolean
language sql security invoker set search_path='' as $$
  select exists(select 1 from public.routine_commands c
    join public.routine_schedule_claims cl on cl.command_id=c.id
    join public.routine_schedules s on s.id=cl.schedule_id and s.revision=cl.revision
    join public.accounts a on a.id=s.account_id
    join public.account_members m on m.account_id=s.account_id and m.user_id=s.user_id
    join public.routine_states r on r.account_id=s.account_id and r.routine_id=s.routine_id
    where c.request_id=p_request_id and c.account_id=p_account_id and c.user_id=p_user_id
      and c.request_id='schedule:'||s.id::text||':'||s.revision::text||':'||cl.local_date::text
      and s.enabled and not a.automation_paused and a.context_generation=s.context_generation
      and c.account_id=s.account_id and c.context_generation=s.context_generation and c.user_id=s.user_id and m.role='owner'
      and r.enabled and r.version=s.version and c.version=s.version and c.routine_id=s.routine_id
      and c.spec_hash=s.spec_hash and c.workflow_hash=s.workflow_hash and c.channel=s.channel
      and c.channel_binding is not distinct from s.channel_binding);
$$;
revoke all on function public.routine_scheduled_command_current(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.routine_scheduled_command_current(text,uuid,uuid) to service_role;

create function public.claim_routine_schedule(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare s public.routine_schedules%rowtype; c public.routine_commands%rowtype;
  slot timestamptz:=(input->>'slotAt')::timestamptz; local_slot timestamp; acct uuid;
begin
  select account_id into acct from public.routine_schedules where id=(input->>'scheduleId')::uuid;
  perform 1 from public.accounts where id=acct for update;
  select * into s from public.routine_schedules where id=(input->>'scheduleId')::uuid for update;
  if not found or not s.enabled or s.revision is distinct from (input->>'revision')::bigint then return false; end if;
  local_slot:=slot at time zone s.timezone;
  if slot>clock_timestamp() or slot<=clock_timestamp()-interval '15 minutes' or slot<s.starts_at
    or date_trunc('minute',slot)<>slot or local_slot::date::text is distinct from input->>'localDate'
    or extract(hour from local_slot)<>s.hour or extract(minute from local_slot)<>s.minute
    or (s.on_date is not null and local_slot::date<>s.on_date)
    or (s.weekday is not null and extract(dow from local_slot)<>s.weekday) then
    raise exception 'Not a current saved schedule slot' using errcode='23514'; end if;
  c:=jsonb_populate_record(null::public.routine_commands,input->'command');
  if c.account_id is distinct from s.account_id or c.context_generation is distinct from s.context_generation
    or c.user_id is distinct from s.user_id or c.routine_id is distinct from s.routine_id or c.version is distinct from s.version
    or c.spec_hash is distinct from s.spec_hash or c.workflow_hash is distinct from s.workflow_hash
    or c.channel is distinct from s.channel or c.channel_binding is distinct from s.channel_binding
    or c.request_id is distinct from 'schedule:'||s.id::text||':'||s.revision::text||':'||local_slot::date::text
    or c.status is distinct from 'queued' or c.run_id is not null
    or c.created_at>clock_timestamp() or c.created_at<clock_timestamp()-interval '1 minute'
    or c.created_at is null or c.updated_at is distinct from c.created_at then
    raise exception 'Schedule command differs from saved authority' using errcode='23514'; end if;
  if not exists(select 1 from public.accounts a join public.account_members m on m.account_id=a.id
    join public.routine_states r on r.account_id=a.id where a.id=s.account_id and not a.automation_paused
    and a.context_generation=s.context_generation and m.user_id=s.user_id and m.role='owner'
    and r.routine_id=s.routine_id and r.enabled and r.version=s.version) then return false; end if;
  insert into public.routine_schedule_claims values(s.id,s.revision,local_slot::date,slot,c.id) on conflict do nothing;
  if not found then return false; end if;
  insert into public.routine_commands(id,account_id,context_generation,user_id,channel,request_id,link_id,channel_binding,
    request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply,created_at,updated_at)
    values(c.id,c.account_id,c.context_generation,c.user_id,c.channel,c.request_id,c.link_id,c.channel_binding,
      c.request_hash,c.routine_id,c.spec_hash,c.workflow_hash,c.version,c.request,c.status,c.reply,c.created_at,c.updated_at);
  return true;
end $$;
revoke all on function public.claim_routine_schedule(jsonb) from public,anon,authenticated;
grant execute on function public.claim_routine_schedule(jsonb) to service_role;

-- Schedule cancellation must also close keyword dispatch/provider admission,
-- not only stop the next worker poll. Preserve all existing origin checks.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.keyword_command_origin_valid(public.routine_commands)'::regprocedure) into definition;
  if strpos(definition,'if c.channel=''app'' then')=0 then raise exception 'Keyword origin helper changed'; end if;
  execute replace(definition,'if c.channel=''app'' then',
    'if c.request_id like ''schedule:%'' and not public.routine_scheduled_command_current(c.request_id,c.account_id,c.user_id) then return false; end if; if c.channel=''app'' then');
end $$;
commit;
