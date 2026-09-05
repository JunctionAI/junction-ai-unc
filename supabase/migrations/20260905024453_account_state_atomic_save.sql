-- Additive preparation. Applied database migration version: 20260905024453.
-- Legacy grants are revoked only after the new app is deployed.
begin;

alter table account_state_meta
  add column revision bigint not null default 0 check (revision >= 0),
  add column last_save_id uuid,
  add column last_save_hash text;

-- One statement / one MVCC snapshot: a new revision cannot be paired with old sections.
-- Service-only; the API verifies the current session/membership and supplies the account.
create function public.load_account_state_snapshot(p_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'account', jsonb_build_object('id',a.id,'name',a.name,'currency',a.currency),
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
revoke all on function public.load_account_state_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.load_account_state_snapshot(uuid) to service_role;

-- No dynamic SQL, no client-chosen account/row IDs, no runtime/credential/approval writes.
-- An owner check inside the transaction complements the session-bound API check.
create function public.save_account_state_atomic(
  p_account_id uuid, p_user_id uuid, p_expected_revision bigint, p_save_id uuid, p_rows jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_revision bigint; v_last_id uuid; v_last_hash text; v_hash text;
  v_plan_id uuid; v_rp public.resource_profiles; v_bp public.business_profiles;
  v_item jsonb; v_g public.goals; v_t public.team_members; v_m public.chat_messages;
  v_now timestamptz := clock_timestamp(); v_count integer; v_section text;
begin
  if p_account_id is null or p_user_id is null or p_save_id is null or p_expected_revision is null or p_expected_revision < 0 then
    return jsonb_build_object('ok',false,'code','invalid_state');
  end if;
  -- Serialize first saves too (there may not be an account_state_meta row yet).
  perform 1 from public.accounts where id=p_account_id for update;
  if not found then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
  perform 1 from public.account_members where account_id=p_account_id and user_id=p_user_id and role='owner' for share;
  if not found then return jsonb_build_object('ok',false,'code','owner_only'); end if;

  if jsonb_typeof(p_rows) is distinct from 'object' or octet_length(p_rows::text)>1000000
    or (p_rows->'account'->>'id') is distinct from p_account_id::text
    or (p_rows->'account'->>'currency') not in ('NZD','AUD','USD','GBP','EUR')
    or (p_rows->'stateMeta'->>'schema_version') is distinct from '1'
    or jsonb_typeof(p_rows->'stateMeta'->'client_state') is distinct from 'object'
    or jsonb_typeof(p_rows->'resourceProfile') is distinct from 'object'
    or jsonb_typeof(p_rows->'businessProfile') is distinct from 'object'
    or jsonb_typeof(p_rows->'plan') is distinct from 'object' then
    return jsonb_build_object('ok',false,'code','invalid_state');
  end if;
  foreach v_section in array array['goals','teamMembers','chatMessages'] loop
    if jsonb_typeof(p_rows->v_section) is distinct from 'array' then
      return jsonb_build_object('ok',false,'code','invalid_state');
    end if;
  end loop;
  if jsonb_array_length(p_rows->'goals')>20 or jsonb_array_length(p_rows->'teamMembers')>100
    or jsonb_array_length(p_rows->'chatMessages')>2000 then
    return jsonb_build_object('ok',false,'code','invalid_state');
  end if;

  -- Canonical jsonb text has stable key order. md5 is a duplicate-content checksum,
  -- never an authentication primitive. The caller cannot supply the stored checksum.
  v_hash := md5(p_rows::text);
  select revision,last_save_id,last_save_hash into v_revision,v_last_id,v_last_hash
    from public.account_state_meta where account_id=p_account_id for update;
  v_revision := coalesce(v_revision,0);
  if v_last_id=p_save_id then
    if v_last_hash=v_hash then return jsonb_build_object('ok',true,'revision',v_revision,'replayed',true); end if;
    return jsonb_build_object('ok',false,'code','save_id_conflict');
  end if;
  if v_revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'code','state_conflict');
  end if;

  update public.accounts set currency=p_rows->'account'->>'currency' where id=p_account_id;

  for v_item in select value from jsonb_array_elements(p_rows->'goals') loop
    v_g := jsonb_populate_record(null::public.goals,v_item);
    insert into public.goals(account_id,category,tier,title,baseline,deadline,updated_at)
      values(p_account_id,v_g.category,v_g.tier,v_g.title,v_g.baseline,v_g.deadline,v_now)
      on conflict(account_id,category) do update set tier=excluded.tier,title=excluded.title,
        baseline=excluded.baseline,deadline=excluded.deadline,updated_at=excluded.updated_at;
  end loop;
  delete from public.goals where account_id=p_account_id and category not in
    (select value->>'category' from jsonb_array_elements(p_rows->'goals'));

  v_rp := jsonb_populate_record(null::public.resource_profiles,p_rows->'resourceProfile');
  if v_rp.budget_monthly<0 or v_rp.hours_weekly<0 or v_rp.hours_weekly>168
    or v_rp.gross_margin_pct<0 or v_rp.gross_margin_pct>100 then
    raise exception 'invalid account resource values' using errcode='22023';
  end if;
  insert into public.resource_profiles(account_id,budget_monthly,hours_weekly,reinvestment,gross_margin_pct,website,socials,skills,known_platforms,postures,breadth,updated_at)
    values(p_account_id,v_rp.budget_monthly,v_rp.hours_weekly,v_rp.reinvestment,v_rp.gross_margin_pct,v_rp.website,v_rp.socials,v_rp.skills,v_rp.known_platforms,v_rp.postures,v_rp.breadth,v_now)
    on conflict(account_id) do update set budget_monthly=excluded.budget_monthly,hours_weekly=excluded.hours_weekly,
      reinvestment=excluded.reinvestment,gross_margin_pct=excluded.gross_margin_pct,website=excluded.website,socials=excluded.socials,
      skills=excluded.skills,known_platforms=excluded.known_platforms,postures=excluded.postures,breadth=excluded.breadth,updated_at=excluded.updated_at;

  v_count:=0;
  for v_item in select value from jsonb_array_elements(p_rows->'teamMembers') loop
    v_t:=jsonb_populate_record(null::public.team_members,v_item);
    if v_t.position is distinct from v_count then raise exception 'invalid team order' using errcode='22023'; end if;
    insert into public.team_members(account_id,position,name,role,approves)
      values(p_account_id,v_count,v_t.name,v_t.role,v_t.approves)
      on conflict(account_id,position) do update set name=excluded.name,role=excluded.role,approves=excluded.approves;
    v_count:=v_count+1;
  end loop;
  delete from public.team_members where account_id=p_account_id and position>=v_count;

  select id into v_plan_id from public.plans where account_id=p_account_id order by created_at desc,id desc limit 1;
  if v_plan_id is null then
    insert into public.plans(account_id,title,phases,narrative)
      values(p_account_id,p_rows->'plan'->>'title',p_rows->'plan'->'phases',p_rows->'plan'->>'narrative');
  else
    update public.plans set title=p_rows->'plan'->>'title',phases=p_rows->'plan'->'phases',narrative=p_rows->'plan'->>'narrative'
      where id=v_plan_id and account_id=p_account_id;
  end if;
  -- agreed_at, certified goal observations and historical plan IDs are never client-controlled.
  v_bp:=jsonb_populate_record(null::public.business_profiles,p_rows->'businessProfile');
  insert into public.business_profiles(account_id,scan_status,profile,scanned_at,updated_at)
    values(p_account_id,v_bp.scan_status,v_bp.profile,v_bp.scanned_at,v_now)
    on conflict(account_id) do update set scan_status=excluded.scan_status,profile=excluded.profile,
      scanned_at=excluded.scanned_at,updated_at=excluded.updated_at;

  for v_item in select value from jsonb_array_elements(p_rows->'chatMessages') loop
    v_m:=jsonb_populate_record(null::public.chat_messages,v_item);
    if v_m.position<0 or v_m.position>=1000000 then raise exception 'invalid chat position' using errcode='22023'; end if;
    -- Never overwrite a channel message if a malformed app position collides with it.
    if exists(select 1 from public.chat_messages where account_id=p_account_id and thread=v_m.thread and position=v_m.position and channel<>'app') then
      raise exception 'channel collision' using errcode='22023';
    end if;
    insert into public.chat_messages(account_id,thread,position,lane,sender,body,meta,channel)
      values(p_account_id,v_m.thread,v_m.position,v_m.lane,v_m.sender,v_m.body,v_m.meta,'app')
      on conflict(account_id,thread,position) do update set lane=excluded.lane,sender=excluded.sender,body=excluded.body,meta=excluded.meta;
  end loop;
  -- App autosave does not delete chat history or touch channel rows.

  insert into public.account_state_meta(account_id,schema_version,client_state,saved_at,revision,last_save_id,last_save_hash)
    values(p_account_id,1,p_rows->'stateMeta'->'client_state',v_now,v_revision+1,p_save_id,v_hash)
    on conflict(account_id) do update set schema_version=excluded.schema_version,client_state=excluded.client_state,
      saved_at=excluded.saved_at,revision=excluded.revision,last_save_id=excluded.last_save_id,last_save_hash=excluded.last_save_hash;
  return jsonb_build_object('ok',true,'revision',v_revision+1,'replayed',false);
end;
$$;
revoke all on function public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb) to service_role;

commit;
