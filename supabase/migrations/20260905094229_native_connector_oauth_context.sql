-- Native OAuth only. Legacy/native states lacking a captured context refuse; Slack
-- and env-gated hosted-provider state handling is unchanged by this migration.
alter table public.oauth_states add column auth_context jsonb;
-- Connector rows are member-readable: store only a digest of the OAuth nonce.
alter table public.connectors add column pending_oauth_digest text;

create function public.native_oauth_binding(connector uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',c.id,'accountId',c.account_id,'platform',c.platform,
    'status',c.status,'externalRef',c.external_ref,'syncRef',c.sync_ref,
    'secretDigest',case when s.connector_id is null then null else
      encode(sha256(convert_to((to_jsonb(s)-'updated_at')::text,'UTF8')),'hex') end)
  from public.connectors c left join public.connector_secrets s on s.connector_id=c.id where c.id=connector;
$$;
revoke all on function public.native_oauth_binding(uuid) from public,anon,authenticated,service_role;
grant execute on function public.native_oauth_binding(uuid) to service_role;

create function public.begin_native_connector_oauth(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare acct uuid:=(input->>'account_id')::uuid; actor uuid:=(input->>'initiated_by')::uuid;
  a public.accounts%rowtype; role_name text; p text; c public.connectors%rowtype; context jsonb;
  targets text[]; bindings jsonb:='[]'; expiry timestamptz:=(input->>'expires_at')::timestamptz;
begin
  if coalesce(input->>'state','')!~'^[A-Za-z0-9_-]{20,200}$' or coalesce(input->>'platform','')='' or
      expiry is null or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '10 minutes 5 seconds' then
    raise exception 'Fresh native OAuth attempt required' using errcode='23514'; end if;
  select * into a from public.accounts where id=acct for share;
  select role into role_name from public.account_members where account_id=acct and user_id=actor for share;
  if a.id is null or role_name is distinct from 'owner' then
    raise exception 'Current initiating owner required' using errcode='42501'; end if;
  targets:=case when input->>'platform'='google' then array['ga4','google_ads','search_console'] else array[input->>'platform'] end;
  foreach p in array targets loop
    insert into public.connectors(account_id,platform,status) values(acct,p,'connecting')
      on conflict(account_id,platform) do nothing;
    select * into c from public.connectors where account_id=acct and platform=p for update;
    perform 1 from public.connector_secrets where connector_id=c.id for share;
    update public.connectors set pending_oauth_digest=encode(sha256(convert_to(input->>'state','UTF8')),'hex'),
      status=case when status='connected' then status else 'connecting' end where id=c.id;
    bindings:=bindings||jsonb_build_array(public.native_oauth_binding(c.id));
  end loop;
  context:=jsonb_build_object('protocol','native_oauth_v1','accountId',acct,'initiatedBy',actor,
    'contextGeneration',a.context_generation,'platform',input->>'platform','expiresAt',input->>'expires_at','targets',bindings);
  insert into public.oauth_states(state,account_id,platform,code_verifier,shop,redirect_to,created_at,expires_at,auth_context)
    values(input->>'state',acct,input->>'platform',input->>'code_verifier',input->>'shop','/app',clock_timestamp(),expiry,context);
  return context;
end $$;
revoke all on function public.begin_native_connector_oauth(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_native_connector_oauth(jsonb) to service_role;

-- Locks persist for the calling transaction, including when used by finish/fail.
create function public.check_native_connector_oauth(state_value text, context_value jsonb, actor uuid, allow_expired boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; b jsonb; c public.connectors%rowtype; role_name text; platforms text[]; expected text[];
begin
  if context_value->>'protocol' is distinct from 'native_oauth_v1' or
      context_value->>'initiatedBy' is distinct from actor::text or actor is null or
      jsonb_typeof(context_value->'targets') is distinct from 'array' then return false; end if;
  select * into a from public.accounts where id=(context_value->>'accountId')::uuid for share;
  select role into role_name from public.account_members where account_id=a.id and user_id=actor for share;
  if a.id is null or role_name is distinct from 'owner' or
      context_value->>'contextGeneration' is distinct from a.context_generation::text or
      (not allow_expired and coalesce((context_value->>'expiresAt')::timestamptz<=clock_timestamp(),true)) then return false; end if;
  select array_agg(t->>'platform' order by t->>'platform') into platforms from jsonb_array_elements(context_value->'targets') t;
  expected:=case when context_value->>'platform'='google' then array['ga4','google_ads','search_console'] else array[context_value->>'platform'] end;
  if platforms is distinct from expected then return false; end if;
  for b in select value from jsonb_array_elements(context_value->'targets') order by value->>'platform' loop
    select * into c from public.connectors where id=(b->>'id')::uuid for update;
    if c.id is null or c.account_id is distinct from a.id or c.pending_oauth_digest is distinct from encode(sha256(convert_to(state_value,'UTF8')),'hex') then return false; end if;
    perform 1 from public.connector_secrets where connector_id=c.id for share;
    if public.native_oauth_binding(c.id) is distinct from b then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.check_native_connector_oauth(text,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.check_native_connector_oauth(text,jsonb,uuid,boolean) to service_role;

create function public.finish_native_connector_oauth(state_value text, context_value jsonb, actor uuid, replacements jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b jsonb; replacement jsonb; sealed jsonb; ids text[]; expected text[];
begin
  if not public.check_native_connector_oauth(state_value,context_value,actor,false) then return false; end if;
  if jsonb_typeof(replacements) is distinct from 'array' then raise exception 'Credential replacements required' using errcode='23514'; end if;
  select array_agg(x->>'connectorId' order by x->>'connectorId') into ids from jsonb_array_elements(replacements) x;
  select array_agg(x->>'id' order by x->>'id') into expected from jsonb_array_elements(context_value->'targets') x;
  if ids is distinct from expected then raise exception 'Exact original targets required' using errcode='23514'; end if;
  for b in select value from jsonb_array_elements(context_value->'targets') order by value->>'platform' loop
    select x into replacement from jsonb_array_elements(replacements) x where x->>'connectorId'=b->>'id';
    sealed:=replacement->'sealed';
    if jsonb_typeof(sealed) is distinct from 'object' or coalesce(sealed->>'ciphertext','')='' or
        coalesce(sealed->>'iv','')='' or coalesce(sealed->>'tag','')='' or coalesce((sealed->>'keyVersion')::integer,0)<1 then
      raise exception 'Sealed credential required' using errcode='23514'; end if;
    insert into public.connector_secrets(connector_id,ciphertext,iv,tag,key_version,updated_at)
      values((b->>'id')::uuid,sealed->>'ciphertext',sealed->>'iv',sealed->>'tag',(sealed->>'keyVersion')::integer,clock_timestamp())
      on conflict(connector_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,
        key_version=excluded.key_version,updated_at=excluded.updated_at;
    update public.connectors set status='connected',external_ref=replacement->>'externalRef',
      last_sync_at=null,last_sync_result=null,last_read_metrics=null,pending_oauth_digest=null,
      sync_ref=coalesce(sync_ref,'{}'::jsonb)-array['auth_provider','provider_connection_id','provider_integration']
      where id=(b->>'id')::uuid;
  end loop;
  return true;
end $$;
revoke all on function public.finish_native_connector_oauth(text,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_native_connector_oauth(text,jsonb,uuid,jsonb) to service_role;

create function public.fail_native_connector_oauth(state_value text, context_value jsonb, actor uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b jsonb;
begin
  if not public.check_native_connector_oauth(state_value,context_value,actor,true) then return false; end if;
  for b in select value from jsonb_array_elements(context_value->'targets') loop
    update public.connectors set pending_oauth_digest=null,
      status=case when status='connecting' then 'error' else status end,
      last_sync_result=case when status='connecting' then 'error:oauth' else last_sync_result end
      where id=(b->>'id')::uuid;
  end loop;
  return true;
end $$;
revoke all on function public.fail_native_connector_oauth(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fail_native_connector_oauth(text,jsonb,uuid) to service_role;

-- First-read metrics, card status and receipt share one commit boundary. No
-- fallback account generation or asset selection is accepted at this boundary.
create function public.record_connector_first_read(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; c public.connectors%rowtype; b jsonb:=input->'binding';
  role_name text; m jsonb; metrics jsonb:=input->'metrics'; actor uuid:=(input->>'actor')::uuid;
  result text:=input->>'result'; received timestamptz:=clock_timestamp();
begin
  select * into a from public.accounts where id=(b->>'accountId')::uuid for share;
  if a.id is null or a.automation_paused or a.context_generation::text is distinct from input->>'contextGeneration' then return false; end if;
  if actor is not null then
    select role into role_name from public.account_members where account_id=a.id and user_id=actor for share;
    if role_name is distinct from 'owner' then return false; end if;
  end if;
  select * into c from public.connectors where id=(b->>'id')::uuid for update;
  if c.id is null or c.account_id is distinct from a.id or c.platform is distinct from b->>'platform' or
    c.status is distinct from 'connected' or c.external_ref is distinct from b->>'externalRef' or
    coalesce(c.sync_ref,'null'::jsonb) is distinct from b->'syncRef' then return false; end if;
  if jsonb_typeof(metrics) is distinct from 'array' or jsonb_array_length(metrics)>20 or
    coalesce(result,'starting') not in ('starting','ok','empty','error:first_read','error:no_reader') or
    coalesce(input->>'description','')='' then raise exception 'Invalid first-read result' using errcode='23514'; end if;
  for m in select value from jsonb_array_elements(metrics) loop
    if m->>'account_id' is distinct from a.id::text or m->>'context_generation' is distinct from a.context_generation::text or
      m->>'platform' is distinct from c.platform or result is distinct from 'ok' then
      raise exception 'First-read metric identity mismatch' using errcode='23514'; end if;
    insert into public.kpi_snapshots(account_id,context_generation,metric_key,value,currency,window_start,window_end,platform,provenance,captured_at)
      values(a.id,a.context_generation,m->>'metric_key',(m->>'value')::numeric,m->>'currency',
        (m->>'window_start')::date,(m->>'window_end')::date,c.platform,m->>'provenance',(m->>'captured_at')::timestamptz)
      on conflict(account_id,context_generation,metric_key,window_end) do update set
        value=excluded.value,currency=excluded.currency,window_start=excluded.window_start,platform=excluded.platform,
        provenance=excluded.provenance,captured_at=excluded.captured_at;
  end loop;
  if result is not null then
    update public.connectors set last_sync_at=received,last_sync_result=result,last_read_metrics=jsonb_array_length(metrics) where id=c.id;
  end if;
  insert into public.receipts(account_id,context_generation,run_id,approval_id,kind,platform,description,payload,created_at)
    values(a.id,a.context_generation,null,null,'notification',c.platform,input->>'description',input->'payload',received);
  return true;
end $$;
revoke all on function public.record_connector_first_read(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_connector_first_read(jsonb) to service_role;
