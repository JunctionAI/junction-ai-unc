-- Modern Agents switch: one explicit preference change, never a run or schedule.
create function public.set_agent_switch(p_account uuid, p_actor uuid, p_generation bigint,
  p_routine text, p_enabled boolean, p_expected_updated_at timestamptz, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.accounts%rowtype; s public.routine_states%rowtype; owner_role text;
begin
  select * into a from public.accounts where id=p_account for share;
  select role into owner_role from public.account_members where account_id=p_account and user_id=p_actor for share;
  if a.id is null or owner_role is distinct from 'owner' then raise exception 'owner_required' using errcode='42501'; end if;
  if a.context_generation is distinct from p_generation then raise exception 'context_changed' using errcode='40001'; end if;
  if p_enabled is null or p_routine !~ '^D0[1-5]-W0[1-9]$' or p_expected_version is null or p_expected_version<1 then
    raise exception 'invalid_switch' using errcode='22023';
  end if;
  if p_enabled and a.automation_paused then raise exception 'automation_paused' using errcode='40001'; end if;
  -- Serialize new-path absent-row creation; existing writers still meet the row CAS below.
  perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||p_routine,0));
  select * into s from public.routine_states where account_id=p_account and routine_id=p_routine for update;
  if s.account_id is null then
    if p_expected_updated_at is not null or p_expected_version<>1 then raise exception 'switch_changed' using errcode='40001'; end if;
    insert into public.routine_states(account_id,routine_id,enabled,version,updated_at)
      values(p_account,p_routine,p_enabled,1,clock_timestamp()) on conflict do nothing returning * into s;
    if s.account_id is null then raise exception 'switch_changed' using errcode='40001'; end if;
  else
    if s.updated_at is distinct from p_expected_updated_at or s.version<>p_expected_version then
      raise exception 'switch_changed' using errcode='40001';
    end if;
    update public.routine_states set enabled=p_enabled,updated_at=clock_timestamp()
      where account_id=p_account and routine_id=p_routine returning * into s;
  end if;
  return jsonb_build_object('accountId',p_account,'contextGeneration',p_generation,'routineId',s.routine_id,
    'enabled',s.enabled,'version',s.version,'stateUpdatedAt',s.updated_at);
end;
$$;
revoke all on function public.set_agent_switch(uuid,uuid,bigint,text,boolean,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.set_agent_switch(uuid,uuid,bigint,text,boolean,timestamptz,integer) to service_role;
