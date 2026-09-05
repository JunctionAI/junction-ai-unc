begin;
set local lock_timeout='5s';

-- Legacy commands stay at generation zero. Never infer their generation from the
-- current account or relabel them during rollout.
alter table public.routine_commands add column context_generation bigint not null default 0 check (context_generation >= 0);

-- All queue writers already require service_role. No definer/RLS bypass is needed.
create function unc_private.guard_command_context() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  generation bigint;
  paused boolean;
  parent public.routine_runs%rowtype;
begin
  if coalesce(current_setting('role',true),'none') in ('anon','authenticated') then
    raise exception 'Commands require server authority' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id or new.account_id is distinct from old.account_id or
    new.context_generation is distinct from old.context_generation or
    new.user_id is distinct from old.user_id or new.channel is distinct from old.channel or
    new.link_id is distinct from old.link_id or new.request_id is distinct from old.request_id or
    new.request_hash is distinct from old.request_hash or new.request is distinct from old.request or
    new.routine_id is distinct from old.routine_id or new.version is distinct from old.version or
    new.spec_hash is distinct from old.spec_hash or new.workflow_hash is distinct from old.workflow_hash or
    new.created_at is distinct from old.created_at or (old.run_id is not null and new.run_id is distinct from old.run_id)
  ) then raise exception 'Captured command identity is immutable' using errcode='23514'; end if;
  if new.run_id is not null and new.run_id<>new.id then
    raise exception 'Command run identity must match its claim' using errcode='23514';
  end if;
  select a.context_generation,a.automation_paused into generation,paused
    from public.accounts a where a.id=new.account_id for share;
  if not found then raise exception 'Command account unavailable' using errcode='23503'; end if;
  if new.context_generation is distinct from generation then
    raise exception 'Captured command context is stale' using errcode='40001';
  end if;
  if paused then raise exception 'Account automation is paused for verified setup' using errcode='55000'; end if;
  select * into parent from public.routine_runs r where r.id=new.id;
  if found and (parent.account_id<>new.account_id or parent.context_generation<>new.context_generation or
    parent.routine_id<>new.routine_id or parent.version<>new.version or parent.mode<>'dry_run') then
    raise exception 'Command and run context mismatch' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function unc_private.guard_command_context() from public,anon,authenticated,service_role;
create trigger command_context before insert or update on public.routine_commands for each row execute function unc_private.guard_command_context();

-- Stops a legacy worker from loading today's context and attaching an old claim
-- to it. Deterministic command/run IDs are checked in both insertion orders.
create function unc_private.guard_run_command_context() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  command public.routine_commands%rowtype;
begin
  select * into command from public.routine_commands c where c.id=new.id;
  if found and (command.account_id<>new.account_id or command.context_generation<>new.context_generation or
    command.routine_id<>new.routine_id or command.version<>new.version or new.mode<>'dry_run' or
    command.run_id is distinct from new.id or command.status not in ('running','waiting','uncertain')) then
    raise exception 'Run does not match its captured command claim' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function unc_private.guard_run_command_context() from public,anon,authenticated,service_role;
create trigger command_context before insert on public.routine_runs for each row execute function unc_private.guard_run_command_context();

-- Filter BEFORE limiting, otherwise stale/paused history can starve active tenants.
-- Service-only, invoker rights; this is not a customer-readable queue endpoint.
create function public.list_current_routine_commands(command_status text, max_rows integer, pending_notifications boolean default false)
returns setof public.routine_commands language sql stable security invoker set search_path='' as $$
  select c.* from public.routine_commands c join public.accounts a on a.id=c.account_id
    where not a.automation_paused and a.context_generation=c.context_generation
      and ((not pending_notifications and c.status=command_status) or
        (pending_notifications and c.notification_status='pending' and c.channel in ('slack','sms','telegram','whatsapp','email','apple')
          and c.status in ('done','blocked','failed','uncertain','waiting')))
    order by case when command_status='queued' and not pending_notifications then c.created_at else c.updated_at end,c.id
    limit least(greatest(coalesce(max_rows,0),0),100);
$$;
revoke all on function public.list_current_routine_commands(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.list_current_routine_commands(text,integer,boolean) to service_role;
revoke insert(context_generation),update(context_generation) on public.routine_commands from public,anon,authenticated;
commit;
