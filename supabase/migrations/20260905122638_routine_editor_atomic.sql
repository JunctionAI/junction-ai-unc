-- One consistent editor read; no row is created by opening settings.
create function public.read_routine_editor(p_account uuid,p_actor uuid,p_generation bigint,p_routine text,p_domain text)
returns jsonb language sql stable security invoker set search_path='' as $$
  with snapshot as (
    select jsonb_build_object(
      'accountId',a.id,'contextGeneration',a.context_generation,'role',m.role,'paused',a.automation_paused,
      'state',(select to_jsonb(s) from public.routine_states s where s.account_id=a.id and s.routine_id=p_routine),
      'own',(select to_jsonb(p) from public.routine_params p where p.account_id=a.id and p.routine_id=p_routine),
      'accountPreset',(select to_jsonb(p) from public.account_presets p where p.account_id=a.id and p.domain=p_domain),
      'input',jsonb_build_object('currency',a.currency,
        'profile',(select p.profile from public.business_profiles p where p.account_id=a.id),
        'resources',(select jsonb_build_object('budget_monthly',r.budget_monthly,'gross_margin_pct',r.gross_margin_pct) from public.resource_profiles r where r.account_id=a.id),
        'aov',(select k.value from public.kpi_snapshots k where k.account_id=a.id and k.context_generation=p_generation and k.metric_key='aov_28d' order by k.window_end desc,k.id desc limit 1),
        'memories',coalesce((select jsonb_agg(x.data order by x.created_at desc,x.id) from (
          select m.id,m.created_at,jsonb_build_object('text',m.text,'tags',m.tags) as data from public.memories m
          where m.account_id=a.id and m.context_generation=p_generation and m.kind='fact' and m.valid_to is null
            and m.tags @> array['niche','niche_band']::text[] order by m.created_at desc,m.id limit 200
        ) x),'[]'::jsonb))) as data
    from public.accounts a join public.account_members m on m.account_id=a.id and m.user_id=p_actor
    where a.id=p_account and a.context_generation=p_generation
  ) select data||jsonb_build_object('configurationRevision',encode(sha256(convert_to(data::text,'UTF8')),'hex')) from snapshot;
$$;
revoke all on function public.read_routine_editor(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.read_routine_editor(uuid,uuid,bigint,text,text) to service_role;

-- The application validates ranges/spec shape before passing complete candidate values.
-- The transaction rechecks actor, generation, pause and the entire original read snapshot.
create function public.commit_routine_editor(p_account uuid,p_actor uuid,p_generation bigint,p_routine text,p_domain text,
  p_expected_revision text,p_action text,p_params jsonb default null,p_disabled_steps text[] default null,
  p_draft jsonb default null,p_validation_run uuid default null,p_spec_hash text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; s public.routine_states%rowtype; owner_role text; current_snapshot jsonb; r public.routine_runs%rowtype;
begin
  select * into a from public.accounts where id=p_account for update;
  select role into owner_role from public.account_members where account_id=p_account and user_id=p_actor for share;
  if a.id is null or owner_role is distinct from 'owner' then raise exception 'owner_required' using errcode='42501'; end if;
  if a.context_generation is distinct from p_generation or a.automation_paused then raise exception 'context_changed_or_paused' using errcode='40001'; end if;
  if p_routine is null or p_routine !~ '^D0[1-5]-W0[1-8]$' or p_domain is distinct from
    (case substring(p_routine,1,3) when 'D01' then 'content' when 'D02' then 'paid' when 'D03' then 'seo' when 'D04' then 'sales' when 'D05' then 'email' end)
    or p_action is null or p_action not in ('save','discard','promote') then raise exception 'invalid_editor_operation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||p_routine,0));
  select * into s from public.routine_states where account_id=p_account and routine_id=p_routine for update;
  perform 1 from public.routine_params where account_id=p_account and routine_id=p_routine for update;
  current_snapshot:=public.read_routine_editor(p_account,p_actor,p_generation,p_routine,p_domain);
  if p_expected_revision is null or current_snapshot->>'configurationRevision' is distinct from p_expected_revision then
    raise exception 'editor_changed' using errcode='40001'; end if;
  if p_action='save' then
    if jsonb_typeof(p_params) is distinct from 'object' or p_disabled_steps is null or array_position(p_disabled_steps,null) is not null
      or (p_draft is not null and (jsonb_typeof(p_draft) is distinct from 'object' or p_draft->>'id' is distinct from p_routine
        or p_draft->>'version' is distinct from (coalesce(s.version,1)+1)::text or jsonb_typeof(p_draft->'nodes') is distinct from 'array')) then
      raise exception 'invalid_editor_candidate' using errcode='22023'; end if;
    -- Both writes roll back if either fails. Saved editor values are not live spec authority.
    insert into public.routine_params(account_id,routine_id,domain,params,disabled_steps,source,updated_at)
      values(p_account,p_routine,p_domain,p_params,p_disabled_steps,'founder',clock_timestamp())
      on conflict(account_id,routine_id) do update set params=excluded.params,disabled_steps=excluded.disabled_steps,source=excluded.source,updated_at=excluded.updated_at;
    insert into public.routine_states(account_id,routine_id,enabled,version,draft_spec,live_spec,updated_at)
      values(p_account,p_routine,false,1,p_draft,null,clock_timestamp())
      on conflict(account_id,routine_id) do update set draft_spec=excluded.draft_spec,updated_at=excluded.updated_at;
  elsif p_action='discard' then
    update public.routine_states set draft_spec=null,updated_at=clock_timestamp() where account_id=p_account and routine_id=p_routine;
  else
    if p_routine='D03-W01' then raise exception 'keyword_pilot_operator_required' using errcode='40001'; end if;
    if s.draft_spec is null or s.draft_spec is distinct from p_draft or p_draft->>'version' is distinct from (s.version+1)::text
      or p_validation_run is null or p_spec_hash is null then raise exception 'draft_validation_required' using errcode='40001'; end if;
    select * into r from public.routine_runs where account_id=p_account and context_generation=p_generation
      and routine_id=p_routine and version=s.version+1 and mode='dry_run' and spec_hash=p_spec_hash
      order by started_at desc,id desc limit 1 for share;
    if r.id is distinct from p_validation_run or r.status not in ('done','skipped') or r.finished_at is null then
      raise exception 'draft_validation_changed' using errcode='40001'; end if;
    update public.routine_states set version=s.version+1,live_spec=s.draft_spec,draft_spec=null,updated_at=clock_timestamp()
      where account_id=p_account and routine_id=p_routine;
  end if;
  return public.read_routine_editor(p_account,p_actor,p_generation,p_routine,p_domain);
end;
$$;
revoke all on function public.commit_routine_editor(uuid,uuid,bigint,text,text,text,text,jsonb,text[],jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.commit_routine_editor(uuid,uuid,bigint,text,text,text,text,jsonb,text[],jsonb,uuid,text) to service_role;
