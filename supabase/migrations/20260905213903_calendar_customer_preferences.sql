-- Owner-selected calendar clock, not the provider's reporting timezone or the
-- brain's learned brief cadence. No default is seeded and no run is authorized.
create table unc_calendar_private.customer_preferences (
  account_id uuid not null references public.accounts(id) on delete restrict,
  context_generation bigint not null check(context_generation>=0),
  timezone text not null check(length(timezone) between 1 and 100),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(account_id,context_generation)
);
alter table unc_calendar_private.customer_preferences enable row level security;
revoke all on unc_calendar_private.customer_preferences from public,anon,authenticated,service_role;
grant select,insert,update on unc_calendar_private.customer_preferences to service_role;

create function public.calendar_customer_preferences(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  acct uuid:=(input->>'accountId')::uuid; actor uuid:=(input->>'actorId')::uuid;
  generation bigint:=(input->>'contextGeneration')::bigint;
  a public.accounts%rowtype; p unc_calendar_private.customer_preferences%rowtype;
  owner_role text; locked boolean; bound boolean; requested text:=input->>'timezone';
begin
  if jsonb_typeof(input) is distinct from 'object' or acct is null or actor is null or generation is null or generation<0
    or input->>'operation' is null or input->>'operation' not in ('read','save')
    or input-array['accountId','actorId','contextGeneration','operation','timezone','expectedUpdatedAt']<>'{}'::jsonb then
    raise exception 'Invalid calendar settings request' using errcode='22023'; end if;
  select * into a from public.accounts where id=acct for update;
  select role into owner_role from public.account_members where account_id=acct and user_id=actor for share;
  if a.id is null or owner_role is distinct from 'owner' then
    raise exception 'Account owner required' using errcode='42501'; end if;
  if a.context_generation is distinct from generation then
    raise exception 'Account context changed' using errcode='PT409'; end if;
  select * into p from unc_calendar_private.customer_preferences where account_id=acct and context_generation=generation for update;
  select exists(select 1 from public.n8n_calendar_bindings where account_id=acct and context_generation=generation and revoked_at is null) into bound;
  locked:=bound
    or exists(select 1 from public.routine_states where account_id=acct and routine_id='D05-W07' and (enabled or draft_spec is not null))
    or exists(select 1 from public.n8n_calendar_runs where account_id=acct and context_generation=generation and state not in ('completed','refused'))
    or exists(select 1 from public.routine_commands where account_id=acct and context_generation=generation and routine_id='D05-W07' and status in ('queued','running','waiting','uncertain'));
  if input->>'operation'='save' then
    if not input ? 'expectedUpdatedAt' or requested is null or length(requested)>100
      or requested<>btrim(requested) or not exists(select 1 from pg_catalog.pg_timezone_names where name=requested) then
      raise exception 'Choose a valid timezone and include the saved version' using errcode='22023'; end if;
    if locked or (input->>'expectedUpdatedAt')::timestamptz is distinct from p.updated_at then
      raise exception 'Settings changed or calendar work is bound or outstanding' using errcode='PT409'; end if;
    insert into unc_calendar_private.customer_preferences(account_id,context_generation,timezone,updated_by,updated_at)
      values(acct,generation,requested,actor,clock_timestamp())
      on conflict(account_id,context_generation) do update set timezone=excluded.timezone,updated_by=excluded.updated_by,
        updated_at=greatest(clock_timestamp(),customer_preferences.updated_at+interval '1 microsecond')
      returning * into p;
  elsif input ?| array['timezone','expectedUpdatedAt'] then
    raise exception 'Unexpected read parameters' using errcode='22023';
  end if;
  return jsonb_build_object('accountId',acct,'actorId',actor,'contextGeneration',generation,'routineId','D05-W07',
    'timezone',p.timezone,'updatedAt',p.updated_at,'canEdit',not locked,'bound',bound,
    'paused',a.automation_paused,'executedAction','none');
end $$;
revoke all on function public.calendar_customer_preferences(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.calendar_customer_preferences(jsonb) to service_role;

-- New accepted bindings must use the explicit customer preference. Existing
-- historical bindings are not rewritten or relabelled by this migration.
create function unc_calendar_private.guard_calendar_preference_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
declare selected_timezone text;
begin
  perform 1 from public.accounts where id=new.account_id for share;
  select timezone into selected_timezone from unc_calendar_private.customer_preferences
    where account_id=new.account_id and context_generation=new.context_generation for share;
  if selected_timezone is null or new.spec_template #>> '{nodes,1,shadowContract,client,timezone}' is distinct from selected_timezone then
    raise exception 'Calendar binding requires the selected customer timezone' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function unc_calendar_private.guard_calendar_preference_binding() from public,anon,authenticated;
create trigger calendar_preference_binding_guard before insert on public.n8n_calendar_bindings
  for each row execute function unc_calendar_private.guard_calendar_preference_binding();
