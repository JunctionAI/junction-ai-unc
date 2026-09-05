-- Service-only captured credential boundary. Uses the existing native binding's
-- ciphertext fingerprint; no plaintext token or customer-visible fingerprint API.
create function public.capture_connector_token(p_connector uuid,p_account uuid,p_platform text,p_generation bigint default null,p_actor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; c public.connectors%rowtype; s public.connector_secrets%rowtype;
begin
  select * into a from public.accounts where id=p_account for share;
  if a.id is null or (p_generation is not null and (a.context_generation<>p_generation or a.automation_paused)) then return null; end if;
  if p_actor is not null then
    perform 1 from public.account_members where account_id=a.id and user_id=p_actor and role='owner' for share;
    if not found then return null; end if;
  end if;
  select * into c from public.connectors where id=p_connector for update;
  if c.id is null or c.account_id<>a.id or c.platform<>p_platform or c.status<>'connected' then return null; end if;
  select * into s from public.connector_secrets where connector_id=c.id for share;
  return jsonb_build_object('context',jsonb_build_object('accountId',a.id,'contextGeneration',a.context_generation,'enforcePause',p_generation is not null,'actor',p_actor,
    'binding',public.native_oauth_binding(c.id)), 'row',to_jsonb(c)-'pending_oauth_digest',
    'sealed',case when s.connector_id is null then null else jsonb_build_object('ciphertext',s.ciphertext,'iv',s.iv,'tag',s.tag,'keyVersion',s.key_version) end);
end $$;
revoke all on function public.capture_connector_token(uuid,uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.capture_connector_token(uuid,uuid,text,bigint,uuid) to service_role;

create function public.check_connector_token_context(captured jsonb,grant_only boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; c public.connectors%rowtype; b jsonb:=captured->'binding';
begin
  select * into a from public.accounts where id=(captured->>'accountId')::uuid for share;
  if a.id is null or a.context_generation::text is distinct from captured->>'contextGeneration' then return false; end if;
  if coalesce((captured->>'enforcePause')::boolean,false) and a.automation_paused then return false; end if;
  if captured->>'actor' is not null then
    perform 1 from public.account_members where account_id=a.id and user_id=(captured->>'actor')::uuid and role='owner' for share;
    if not found then return false; end if;
  end if;
  select * into c from public.connectors where id=(b->>'id')::uuid for update;
  if c.id is null or c.account_id<>a.id then return false; end if;
  perform 1 from public.connector_secrets where connector_id=c.id for share;
  -- Refresh owns the grant, not the currently selected ad account/property. A
  -- selection change may keep the same grant; readers still require exact identity.
  if grant_only then return (public.native_oauth_binding(c.id)-'externalRef')=(b-'externalRef'); end if;
  return public.native_oauth_binding(c.id)=b;
end $$;
revoke all on function public.check_connector_token_context(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.check_connector_token_context(jsonb,boolean) to service_role;

-- A process dying after a refresh POST may leave a rotated grant behind. Expiring
-- the short lease must not silently authorize another POST with that old grant.
create table public.connector_refresh_attempts (
  connector_id uuid not null references public.connectors(id) on delete cascade,
  context_generation bigint not null,
  secret_digest text not null check(length(secret_digest)=64),
  holder uuid not null,
  status text not null check(status in ('pending','succeeded','rejected','retryable','uncertain')),
  attempts integer not null default 1 check(attempts between 1 and 3),
  retry_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(connector_id,context_generation,secret_digest)
);
alter table public.connector_refresh_attempts enable row level security;
revoke all on public.connector_refresh_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.connector_refresh_attempts to service_role;

create function public.begin_connector_refresh(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare captured jsonb:=input->'context'; c uuid:=(captured->'binding'->>'id')::uuid;
  lease_holder uuid:=(input->>'holder')::uuid; n integer;
begin
  perform 1 from public.backend_leases where lease_key='connector:'||c::text and holder=lease_holder and expires_at>clock_timestamp() for update;
  if not found or not public.check_connector_token_context(captured) then return false; end if;
  insert into public.connector_refresh_attempts(connector_id,context_generation,secret_digest,holder,status)
    values(c,(captured->>'contextGeneration')::bigint,captured->'binding'->>'secretDigest',lease_holder,'pending')
    on conflict(connector_id,context_generation,secret_digest) do update set holder=excluded.holder,status='pending',
      attempts=public.connector_refresh_attempts.attempts+1,retry_at=null,updated_at=clock_timestamp()
    where public.connector_refresh_attempts.status='retryable' and public.connector_refresh_attempts.attempts<3
      and public.connector_refresh_attempts.retry_at<=clock_timestamp();
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.begin_connector_refresh(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_connector_refresh(jsonb) to service_role;

create function public.settle_connector_token(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare captured jsonb:=input->'context'; c uuid:=(captured->'binding'->>'id')::uuid;
  lease_holder uuid:=(input->>'holder')::uuid; sealed jsonb:=input->'sealed'; kind text:=input->>'kind'; code text:=input->>'code';
  refresh_attempt boolean:=coalesce((input->>'refreshAttempt')::boolean,false);
begin
  if coalesce(kind,'') not in ('success','reconnect','temporary','configuration') then raise exception 'Invalid token outcome' using errcode='23514'; end if;
  if lease_holder is not null then
    perform 1 from public.backend_leases where lease_key='connector:'||c::text and holder=lease_holder
      and expires_at>clock_timestamp() for update;
    if not found then return null; end if;
  end if;
  if not public.check_connector_token_context(captured,true) then return null; end if;
  if refresh_attempt then
    perform 1 from public.connector_refresh_attempts where connector_id=c and context_generation=(captured->>'contextGeneration')::bigint
      and secret_digest=captured->'binding'->>'secretDigest' and holder=lease_holder and status='pending' for update;
    if not found then return null; end if;
    if kind='success' and (sealed is null or sealed='null'::jsonb) then raise exception 'Refreshed token must be saved' using errcode='23514'; end if;
  end if;
  if sealed is not null and sealed<>'null'::jsonb then
    if kind<>'success' or lease_holder is null or coalesce(sealed->>'ciphertext','')='' or coalesce(sealed->>'iv','')='' or
      coalesce(sealed->>'tag','')='' or coalesce((sealed->>'keyVersion')::integer,0)<1 then
      raise exception 'Leased sealed replacement required' using errcode='23514'; end if;
    update public.connector_secrets set ciphertext=sealed->>'ciphertext',iv=sealed->>'iv',tag=sealed->>'tag',
      key_version=(sealed->>'keyVersion')::integer,updated_at=clock_timestamp() where connector_id=c;
    if not found then raise exception 'Original sealed token missing' using errcode='23514'; end if;
  end if;
  if kind='success' then
    update public.connectors set last_sync_result=null where id=c and last_sync_result like 'error:auth_%';
  elsif kind='reconnect' then
    if coalesce(code,'')!~'^[a-z0-9_]{1,80}$' then raise exception 'Invalid token error code' using errcode='23514'; end if;
    update public.connectors set status='needs_reconnect',last_sync_result='error:'||code where id=c;
  else
    update public.connectors set last_sync_result=case when kind='temporary' then 'error:auth_temporarily_unavailable' else 'error:auth_configuration_error' end where id=c;
  end if;
  if refresh_attempt then
    update public.connector_refresh_attempts set status=case when kind='success' then 'succeeded'
      when kind='reconnect' then 'rejected'
      when kind='configuration' then 'retryable'
      when coalesce((input->>'retryable')::boolean,false) then 'retryable' else 'uncertain' end,
      retry_at=case when kind='configuration' or (kind='temporary' and coalesce((input->>'retryable')::boolean,false)) then clock_timestamp()+interval '30 seconds' else null end,
      updated_at=clock_timestamp()
      where connector_id=c and context_generation=(captured->>'contextGeneration')::bigint and secret_digest=captured->'binding'->>'secretDigest';
  end if;
  return captured||jsonb_build_object('binding',public.native_oauth_binding(c));
end $$;
revoke all on function public.settle_connector_token(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.settle_connector_token(jsonb) to service_role;

-- Redacted health for an authenticated account member. No grant fingerprints,
-- sealed values, lease holders or provider responses cross this boundary.
create function public.connector_recovery_state(p_account uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform 1 from public.account_members where account_id=p_account and user_id=p_actor for share;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('connectorId',c.id,'status',
    case when r.status='retryable' and r.attempts>=3 then 'exhausted'
      when r.status='pending' and not exists(select 1 from public.backend_leases l where l.lease_key='connector:'||c.id::text and l.holder=r.holder and l.expires_at>clock_timestamp()) then 'uncertain'
      else r.status end,
    'attempts',r.attempts,'retryAt',r.retry_at)), '[]'::jsonb) into result
  from public.connectors c join public.accounts a on a.id=c.account_id
  join public.connector_refresh_attempts r on r.connector_id=c.id and r.context_generation=a.context_generation
    and r.secret_digest=public.native_oauth_binding(c.id)->>'secretDigest'
  where c.account_id=p_account and c.status='connected' and r.status in ('pending','retryable','uncertain');
  return result;
end $$;
revoke all on function public.connector_recovery_state(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.connector_recovery_state(uuid,uuid) to service_role;
