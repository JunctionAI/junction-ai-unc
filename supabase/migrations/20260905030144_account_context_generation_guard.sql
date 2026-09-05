-- Additive preparation only. No account generation is changed by this migration.
begin;
alter table accounts add column context_generation bigint not null default 0 check (context_generation >= 0);
alter table memories add column context_generation bigint not null default 0 check (context_generation >= 0);

-- Lock the same account row used by context repair. A stale writer either finishes before
-- repair (and is archived by it), or is rejected after it. Reading a generation in JS alone
-- is insufficient. An old binary omitting the column defaults to 0 and fails after repair.
create function public.guard_memory_context_generation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare generation bigint;
begin
  select context_generation into generation from public.accounts where id=new.account_id for share;
  if not found or new.context_generation is distinct from generation then
    raise exception 'business context changed' using errcode='40001';
  end if;
  if tg_op='UPDATE' and (old.account_id<>new.account_id or old.context_generation<>new.context_generation) then
    raise exception 'memory context cannot be reassigned' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_memory_context_generation() from public,anon,authenticated;
grant execute on function public.guard_memory_context_generation() to service_role;
-- Install the memory trigger only AFTER the generation-aware app replaces the old
-- session-role memory writer. See the separate memory-enforcement migration.

-- Incrementing the business identity also invalidates every previously loaded autosave.
create function public.invalidate_context_generation_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.context_generation<old.context_generation then
    raise exception 'context generation cannot go backwards' using errcode='22023';
  end if;
  if new.context_generation<>old.context_generation then
    insert into public.account_state_meta(account_id,schema_version,client_state,revision,last_save_id,last_save_hash)
      values(new.id,1,'{}',1,null,null)
      on conflict(account_id) do update set revision=public.account_state_meta.revision+1,last_save_id=null,last_save_hash=null;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_context_generation_revision() from public,anon,authenticated;
grant execute on function public.invalidate_context_generation_revision() to service_role;
create trigger context_generation_revision after update of context_generation on public.accounts
for each row execute function public.invalidate_context_generation_revision();

create or replace function public.load_account_state_snapshot(p_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'account', jsonb_build_object('id',a.id,'name',a.name,'currency',a.currency,'context_generation',a.context_generation),
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
