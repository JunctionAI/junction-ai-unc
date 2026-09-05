-- One current install attempt per owner/client. Reuse oauth_states for nonce
-- consumption; this private pin survives consumption until commit or expiry.
create table unc_slack_private.install_attempts (
  account_id uuid not null references public.accounts(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  state_digest text not null,
  context jsonb not null,
  expires_at timestamptz not null,
  primary key(account_id,actor_id)
);
alter table unc_slack_private.install_attempts enable row level security;
revoke all on unc_slack_private.install_attempts from public,anon,authenticated,service_role;
grant select,insert,update,delete on unc_slack_private.install_attempts to service_role;

create function public.begin_slack_install(input jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; actor uuid; ctx jsonb; issued timestamptz:=clock_timestamp(); bindings jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object' or input-array['accountId','actorId','state','redirectTo']<>'{}'::jsonb
    or coalesce(input->>'state','') !~ '^[A-Za-z0-9_-]{20,200}$'
    or coalesce(input->>'redirectTo','') not like '/app%' then raise exception 'Invalid install request' using errcode='22023'; end if;
  actor:=(input->>'actorId')::uuid;
  select * into a from public.accounts where id=(input->>'accountId')::uuid for share;
  perform 1 from public.account_members where account_id=a.id and user_id=actor and role='owner' for share;
  if a.id is null or actor is null or not found then raise exception 'Current owner required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'version',l.binding_version) order by l.id),'[]'::jsonb) into bindings
    from public.channel_links l where l.channel='slack' and l.slack_route_id is null and l.user_id=actor;
  ctx:=jsonb_build_object('protocol','slack_install_v1','accountId',a.id,'actorId',actor,'contextGeneration',a.context_generation,
    'issuedAt',issued,'expiresAt',issued+interval '10 minutes','bindings',bindings);
  insert into unc_slack_private.install_attempts(account_id,actor_id,state_digest,context,expires_at)
    values(a.id,actor,encode(sha256(convert_to(input->>'state','UTF8')),'hex'),ctx,issued+interval '10 minutes')
    on conflict(account_id,actor_id) do update set state_digest=excluded.state_digest,context=excluded.context,expires_at=excluded.expires_at;
  insert into public.oauth_states(state,account_id,platform,redirect_to,created_at,expires_at,auth_context)
    values(input->>'state',a.id,'slack_channel',input->>'redirectTo',issued,issued+interval '10 minutes',ctx);
end $$;
revoke all on function public.begin_slack_install(jsonb) from public,anon,authenticated;
grant execute on function public.begin_slack_install(jsonb) to service_role;

create function public.check_slack_install(state_value text,context_value jsonb,actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; pin unc_slack_private.install_attempts%rowtype;
begin
  if context_value->>'protocol' is distinct from 'slack_install_v1' or actor is null
    or context_value->>'actorId' is distinct from actor::text then return false; end if;
  select * into a from public.accounts where id=(context_value->>'accountId')::uuid for share;
  perform 1 from public.account_members where account_id=a.id and user_id=actor and role='owner' for share;
  if a.id is null or not found or a.context_generation::text is distinct from context_value->>'contextGeneration' then return false; end if;
  select * into pin from unc_slack_private.install_attempts where account_id=a.id and actor_id=actor for update;
  return pin.account_id is not null and pin.context=context_value and pin.expires_at>clock_timestamp()
    and pin.state_digest=encode(sha256(convert_to(state_value,'UTF8')),'hex');
end $$;
revoke all on function public.check_slack_install(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.check_slack_install(text,jsonb,uuid) to service_role;

create function public.finish_slack_install(state_value text,context_value jsonb,actor uuid,installation jsonb,sealed jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.channel_links%rowtype; s public.channel_secrets%rowtype; acct uuid; expected jsonb; verified timestamptz;
begin
  if not public.check_slack_install(state_value,context_value,actor) then raise exception 'Install authority changed' using errcode='PT409'; end if;
  acct:=(context_value->>'accountId')::uuid;
  if jsonb_typeof(installation) is distinct from 'object'
    or installation-array['teamId','teamName','userId','botUserId']<>'{}'::jsonb
    or coalesce(installation->>'teamId','') !~ '^T[A-Z0-9]{1,63}$'
    or coalesce(installation->>'userId','') !~ '^[UW][A-Z0-9]{1,63}$'
    or coalesce(installation->>'botUserId','') !~ '^U[A-Z0-9]{1,63}$'
    or jsonb_typeof(sealed) is distinct from 'object' or sealed-array['ciphertext','iv','tag','keyVersion']<>'{}'::jsonb
    or coalesce(sealed->>'ciphertext','')='' or coalesce(sealed->>'iv','')='' or coalesce(sealed->>'tag','')=''
    or coalesce((sealed->>'keyVersion')::integer,0)<1 then raise exception 'Verified installation and sealed credential required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('slack-install:'||(installation->>'teamId'),0));
  select * into l from public.channel_links where channel='slack' and slack_route_id is null and external_id=installation->>'userId' for update;
  if l.id is not null then
    select b into expected from jsonb_array_elements(context_value->'bindings') b where b->>'id'=l.id::text;
    if l.user_id is distinct from actor or l.meta->>'team_id' is distinct from installation->>'teamId'
      or expected->>'version' is distinct from l.binding_version::text then
      raise exception 'Slack identity changed; no transfer performed' using errcode='PT409'; end if;
    perform 1 from public.account_members where account_id=l.account_id and user_id=actor for share;
    if not found then raise exception 'Original identity membership required' using errcode='42501'; end if;
  end if;
  select * into s from public.channel_secrets where channel='slack' and scope_id=installation->>'teamId' for update;
  if s.id is not null and s.updated_at>(context_value->>'issuedAt')::timestamptz then
    raise exception 'Workspace credential changed during consent' using errcode='PT409'; end if;
  -- A different bot is a cutover, not an ordinary reinstall.
  if exists(select 1 from public.channel_links x where x.channel='slack' and x.slack_route_id is null
    and x.verified_at is not null and x.meta->>'team_id'=installation->>'teamId'
    and x.meta->>'bot_user_id' is distinct from installation->>'botUserId') then
    raise exception 'Workspace bot changed; explicit cutover required' using errcode='PT409'; end if;
  -- Timestamp the write after lock waits, not at function entry: a consent
  -- begun while this transaction was waiting must observe this as a newer grant.
  verified:=clock_timestamp();
  insert into public.channel_secrets(account_id,channel,scope_id,ciphertext,iv,tag,key_version,updated_at)
    values(coalesce(s.account_id,acct),'slack',installation->>'teamId',sealed->>'ciphertext',sealed->>'iv',sealed->>'tag',(sealed->>'keyVersion')::integer,verified)
    on conflict(channel,scope_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,key_version=excluded.key_version,updated_at=excluded.updated_at;
  if l.id is null then
    insert into public.channel_links(account_id,user_id,channel,external_id,handle,display_name,verified_at,meta)
      values(acct,actor,'slack',installation->>'userId',left(installation->>'teamName',200),left(installation->>'teamName',200),verified,
        jsonb_build_object('team_id',installation->>'teamId','team_name',left(installation->>'teamName',200),'bot_user_id',installation->>'botUserId')) returning * into l;
  else
    update public.channel_links set handle=left(installation->>'teamName',200),display_name=left(installation->>'teamName',200),verified_at=verified,
      meta=(meta-'dm_channel')||jsonb_build_object('team_id',installation->>'teamId','team_name',left(installation->>'teamName',200),'bot_user_id',installation->>'botUserId')
      where id=l.id returning * into l;
  end if;
  delete from unc_slack_private.install_attempts where account_id=acct and actor_id=actor;
  return to_jsonb(l);
end $$;
revoke all on function public.finish_slack_install(text,jsonb,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_slack_install(text,jsonb,uuid,jsonb,jsonb) to service_role;

create function public.unlink_slack_identity(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; l public.channel_links%rowtype; actor uuid;
begin
  if jsonb_typeof(input) is distinct from 'object' or input-array['accountId','actorId','contextGeneration','linkId','bindingVersion']<>'{}'::jsonb then
    raise exception 'Invalid unlink request' using errcode='22023'; end if;
  actor:=(input->>'actorId')::uuid;
  select * into a from public.accounts where id=(input->>'accountId')::uuid for share;
  perform 1 from public.account_members where account_id=a.id and user_id=actor and role='owner' for share;
  if a.id is null or actor is null or not found then raise exception 'Current owner required' using errcode='42501'; end if;
  if a.context_generation::text is distinct from input->>'contextGeneration' then raise exception 'Context changed' using errcode='PT409'; end if;
  select * into l from public.channel_links where id=(input->>'linkId')::uuid;
  if l.id is null or l.account_id<>a.id or l.channel<>'slack' or l.slack_route_id is not null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('slack-install:'||(l.meta->>'team_id'),0));
  select * into l from public.channel_links where id=(input->>'linkId')::uuid for update;
  if l.id is null or l.account_id<>a.id or l.binding_version::text is distinct from input->>'bindingVersion' then
    raise exception 'Identity changed' using errcode='PT409'; end if;
  -- Preserve history/FKs and invalidate grants instead of deleting the identity.
  update public.channel_links set verified_at=null,meta=meta-'dm_channel' where id=l.id;
  if not exists(select 1 from public.channel_links x where x.channel='slack' and x.slack_route_id is null
    and x.verified_at is not null and x.meta->>'team_id'=l.meta->>'team_id') then
    delete from public.channel_secrets where channel='slack' and scope_id=l.meta->>'team_id'; end if;
  return true;
end $$;
revoke all on function public.unlink_slack_identity(jsonb) from public,anon,authenticated;
grant execute on function public.unlink_slack_identity(jsonb) to service_role;
