begin;
set local lock_timeout='5s';

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
    -- PL/pgSQL resolves record fields while compiling an expression. Boolean
    -- short-circuiting cannot protect NEW.run_id on the routine_runs row type.
    if tg_table_name<>'routine_runs' then
      if new.run_id is distinct from old.run_id then
        raise exception 'Runtime parent is immutable' using errcode = '23514';
      end if;
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

commit;
