-- Read-only, server-owned history paging. No grants on underlying tables change.
-- One global timestamp/kind/id cursor retains ties across all four feeds.
create function public.read_workspace_history(p_account uuid,p_actor uuid,p_generation bigint,p_as_of timestamptz,
  p_before_time timestamptz default null,p_before_kind text default null,p_before_id uuid default null)
returns table(kind text,id uuid,occurred_at timestamptz,record jsonb)
language plpgsql security invoker set search_path='' as $$
begin
  if p_as_of is null or p_as_of>clock_timestamp()+interval '30 seconds' or p_generation is null or p_generation<0 or
    num_nonnulls(p_before_time,p_before_kind,p_before_id) not in (0,3) or
    (p_before_time is not null and (p_before_time>p_as_of or p_before_kind not in ('artifact','approval','receipt','run'))) then
    raise exception 'Invalid history boundary' using errcode='22023'; end if;
  if not exists(select 1 from public.accounts a join public.account_members m on m.account_id=a.id
    where a.id=p_account and a.context_generation=p_generation and m.user_id=p_actor and m.role in ('owner','member')) then
    raise exception 'Current account membership required' using errcode='42501'; end if;
  return query
  with entries as (
    select 'artifact'::text kind,a.id,a.created_at occurred_at,to_jsonb(a)||jsonb_build_object('context_generation',r.context_generation) record
      from public.artifacts a join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
      where a.account_id=p_account and r.context_generation=p_generation
    union all
    select 'approval',a.id,a.created_at,to_jsonb(a) from public.approvals a
      where a.account_id=p_account and a.context_generation=p_generation and a.run_id is not null
    union all
    select 'receipt',r.id,r.created_at,to_jsonb(r)-'payload' from public.receipts r
      where r.account_id=p_account and r.context_generation=p_generation
    union all
    select 'run',r.id,r.started_at,to_jsonb(r)-array['snapshot','spec_hash','dedup_key'] from public.routine_runs r
      where r.account_id=p_account and r.context_generation=p_generation
  )
  select e.kind,e.id,e.occurred_at,e.record from entries e where e.occurred_at<=p_as_of and
    (p_before_time is null or (e.occurred_at,e.kind collate "C",e.id)<(p_before_time,p_before_kind collate "C",p_before_id))
    order by e.occurred_at desc,e.kind collate "C" desc,e.id desc limit 51;
end $$;
revoke all on function public.read_workspace_history(uuid,uuid,bigint,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.read_workspace_history(uuid,uuid,bigint,timestamptz,timestamptz,text,uuid) to service_role;
