begin;
set local lock_timeout = '5s';

-- Legacy outputs remain generation zero, not the account's current generation.
alter table public.daily_briefs add column context_generation bigint not null default 0 check (context_generation >= 0);
alter table public.kpi_snapshots add column context_generation bigint not null default 0 check (context_generation >= 0);
alter table public.receipts add column context_generation bigint not null default 0 check (context_generation >= 0);
alter table public.approvals add column context_generation bigint not null default 0 check (context_generation >= 0);

-- Add the new keys while retaining legacy keys until both app and worker are
-- replaced. Repaired accounts stay paused during this compatibility window.
alter table public.daily_briefs add constraint daily_briefs_context_day_key unique (account_id, context_generation, day);
alter table public.kpi_snapshots add constraint kpi_snapshots_context_window_key unique (account_id, context_generation, metric_key, window_end);

-- Existing children inherit only their actual parent identity. Abort if this
-- would touch a paused/stale parent: reconcile, never rebase to clear an error.
update public.receipts c set context_generation=r.context_generation from public.routine_runs r
  where c.run_id=r.id and c.account_id=r.account_id and c.context_generation<>r.context_generation;
update public.approvals c set context_generation=r.context_generation from public.routine_runs r
  where c.run_id=r.id and c.account_id=r.account_id and c.context_generation<>r.context_generation;

create or replace function unc_private.guard_runtime_run_context() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  generation bigint;
  paused boolean;
  parent_generation bigint;
  parent_account uuid;
  parent_routine text;
begin
  if coalesce(current_setting('role', true), 'none') = 'anon' then
    raise exception 'Runtime writes require an authorized account' using errcode = '42501';
  end if;
  if coalesce(current_setting('role', true), 'none') = 'authenticated' and
     (auth.uid() is null or not exists(select 1 from public.account_members m where m.account_id=new.account_id and m.user_id=auth.uid())) then
    raise exception 'Runtime account membership required' using errcode = '42501';
  end if;
  if tg_op='UPDATE' then
    if new.account_id is distinct from old.account_id or new.id is distinct from old.id then
      raise exception 'Runtime identity is immutable' using errcode = '23514';
    end if;
    if tg_table_name in ('routine_runs','receipts','approvals') then
      if new.context_generation is distinct from old.context_generation then
        raise exception 'Captured runtime generation is immutable' using errcode = '23514';
      end if;
    end if;
    if tg_table_name<>'routine_runs' and new.run_id is distinct from old.run_id then
      raise exception 'Runtime parent is immutable' using errcode = '23514';
    end if;
  end if;

  -- Serializes this short persistence operation with account pause/reset. Never
  -- held over model, provider or webhook I/O. No new client UPDATE grant is added.
  select a.context_generation,a.automation_paused into generation,paused
    from public.accounts a where a.id=new.account_id for share;
  if not found then raise exception 'Runtime account unavailable' using errcode = '23503'; end if;
  if paused then raise exception 'Account automation is paused for verified setup' using errcode = '55000'; end if;

  if tg_table_name='routine_runs' then
    if new.context_generation is distinct from generation then
      raise exception 'Captured runtime context is stale' using errcode = '40001';
    end if;
    if new.snapshot is not null and (
      (new.snapshot #>> '{ctx,account,accountId}') is distinct from new.account_id::text or
      coalesce(new.snapshot #>> '{ctx,account,contextGeneration}','0') <> new.context_generation::text
    ) then raise exception 'Runtime snapshot context mismatch' using errcode = '23514'; end if;
  else
    -- Legacy run-less app records have no captured identity. They cannot enter a
    -- repaired generation by omitting run_id. Their own generation-aware writers
    -- must be completed separately before such records are supported there.
    if new.run_id is null then
      if tg_table_name='receipts' then
        if new.context_generation is distinct from generation then raise exception 'Captured receipt context is stale' using errcode = '40001'; end if;
      elsif generation<>0 then raise exception 'A captured parent run is required for this context' using errcode = '40001';
      elsif tg_table_name='approvals' then
        if new.context_generation<>0 then raise exception 'A captured parent run is required for this context' using errcode = '40001'; end if;
      end if;
      return new;
    end if;
    select r.account_id,r.context_generation,r.routine_id into parent_account,parent_generation,parent_routine
      from public.routine_runs r where r.id=new.run_id;
    if not found or parent_account is distinct from new.account_id then
      raise exception 'Runtime parent account mismatch' using errcode = '23514';
    end if;
    if parent_generation is distinct from generation then
      raise exception 'Captured runtime parent context is stale' using errcode = '40001';
    end if;
    if tg_table_name in ('receipts','approvals') then
      -- Derive ONLY from the immutable parent run, never today's account. Old
      -- callers may omit this new column; the parent already captures identity.
      if tg_op='INSERT' then new.context_generation := parent_generation;
      elsif new.context_generation is distinct from parent_generation then
        raise exception 'Runtime parent generation mismatch' using errcode = '23514';
      end if;
    end if;
    if tg_table_name in ('approvals','artifacts') then
      if new.routine_id is distinct from parent_routine then
        raise exception 'Runtime parent routine mismatch' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create function unc_private.guard_brief_kpi_context() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  generation bigint;
  paused boolean;
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.context_generation is distinct from old.context_generation) then
    raise exception 'Captured output identity is immutable' using errcode = '23514';
  end if;
  select a.context_generation,a.automation_paused into generation,paused
    from public.accounts a where a.id=new.account_id for share;
  if not found then raise exception 'Output account unavailable' using errcode = '23503'; end if;
  if generation is distinct from new.context_generation then
    raise exception 'Captured output context is stale' using errcode = '40001';
  end if;
  if paused then raise exception 'Account automation is paused for verified setup' using errcode = '55000'; end if;
  return new;
end;
$$;
revoke all on function unc_private.guard_brief_kpi_context() from public,anon,authenticated,service_role;
create trigger brief_kpi_context before insert or update on public.daily_briefs for each row execute function unc_private.guard_brief_kpi_context();
create trigger brief_kpi_context before insert or update on public.kpi_snapshots for each row execute function unc_private.guard_brief_kpi_context();

-- These generated outputs already have member SELECT policies only. Preserve
-- reads; no browser/service-role bypass or new client write privilege is added.
revoke insert,update,delete,truncate,references,trigger on public.daily_briefs,public.kpi_snapshots from public,anon,authenticated;
revoke insert(context_generation),update(context_generation) on public.receipts,public.approvals from public,anon,authenticated;
-- The brief job's derived style is merged under the same short account lock.
-- This does not fence unrelated founder-note/intake/profile writers.
create function public.write_decision_style_context(p_account uuid,p_generation bigint,p_style jsonb,p_now timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare generation bigint; paused boolean;
begin
  if p_generation is null or p_generation<0 or jsonb_typeof(p_style) is distinct from 'object' or p_now is null then
    raise exception 'Invalid decision style context' using errcode = '22023';
  end if;
  select a.context_generation,a.automation_paused into generation,paused
    from public.accounts a where a.id=p_account for share;
  if not found then raise exception 'Output account unavailable' using errcode = '23503'; end if;
  if generation is distinct from p_generation then raise exception 'Captured style context is stale' using errcode = '40001'; end if;
  if paused then raise exception 'Account automation is paused for verified setup' using errcode = '55000'; end if;
  insert into public.account_profiles(account_id,decision_style,updated_at) values(p_account,p_style,p_now)
    on conflict(account_id) do update
    set decision_style=public.account_profiles.decision_style || excluded.decision_style, updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.write_decision_style_context(uuid,bigint,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.write_decision_style_context(uuid,bigint,jsonb,timestamptz) to service_role;
commit;
