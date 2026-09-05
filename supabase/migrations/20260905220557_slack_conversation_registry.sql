-- Conversation-to-client mapping is separate from OAuth sender identity.
-- Staging never enables delivery. No seed accounts or memberships are inferred.
create schema unc_slack_private;
revoke all on schema unc_slack_private from public,anon,authenticated;
grant usage on schema unc_slack_private to service_role;

create table unc_slack_private.conversation_routes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  context_generation bigint not null check(context_generation>=0),
  workspace_id text not null check(workspace_id ~ '^T[A-Z0-9]{1,63}$'),
  conversation_id text not null check(conversation_id ~ '^[CG][A-Z0-9]{1,63}$'),
  owner_id uuid references auth.users(id) on delete set null,
  identity_link_id uuid references public.channel_links(id) on delete set null,
  identity_link_version bigint not null check(identity_link_version>=0),
  bot_user_id text not null check(bot_user_id ~ '^[UW][A-Z0-9]{1,63}$'),
  state text not null default 'staged' check(state in ('staged','active','revoked')),
  revision bigint not null default 0 check(revision>=0),
  verified_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,conversation_id)
);
alter table unc_slack_private.conversation_routes enable row level security;
revoke all on unc_slack_private.conversation_routes from public,anon,authenticated,service_role;
grant select,insert,update on unc_slack_private.conversation_routes to service_role;

create function unc_slack_private.version_route() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.account_id<>old.account_id or new.workspace_id<>old.workspace_id or new.conversation_id<>old.conversation_id
    or new.context_generation<>old.context_generation or new.created_at<>old.created_at or new.id<>old.id then
    raise exception 'Slack route identity is immutable' using errcode='23514'; end if;
  if old.state='revoked' and new.state<>'revoked' then
    raise exception 'Revoked Slack routes require a new cutover design' using errcode='23514'; end if;
  new.revision:=old.revision+1; new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function unc_slack_private.version_route() from public,anon,authenticated;
create trigger version_slack_route before update on unc_slack_private.conversation_routes
for each row execute function unc_slack_private.version_route();

-- Invoked before provider access and again in the staging transaction. The
-- actor is supplied by the trusted authenticated server, never Slack prose.
create function public.slack_route_preflight(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  a public.accounts%rowtype; l public.channel_links%rowtype; actor uuid; role_name text;
begin
  if jsonb_typeof(input) is distinct from 'object'
    or input-array['accountId','contextGeneration','actorId','identityLinkId','identityLinkVersion','workspaceId','conversationId']<>'{}'::jsonb
    or not input ?& array['accountId','contextGeneration','actorId','identityLinkId','identityLinkVersion','workspaceId','conversationId']
    or coalesce(input->>'workspaceId','') !~ '^T[A-Z0-9]{1,63}$'
    or coalesce(input->>'conversationId','') !~ '^[CG][A-Z0-9]{1,63}$' then
    raise exception 'Invalid Slack route request' using errcode='22023'; end if;
  actor:=(input->>'actorId')::uuid;
  select * into a from public.accounts where id=(input->>'accountId')::uuid for share;
  select role into role_name from public.account_members where account_id=a.id and user_id=actor for share;
  if a.id is null or actor is null or role_name is distinct from 'owner' then
    raise exception 'Account owner required' using errcode='42501'; end if;
  if a.context_generation is distinct from (input->>'contextGeneration')::bigint then
    raise exception 'Account context changed' using errcode='PT409'; end if;
  select * into l from public.channel_links where id=(input->>'identityLinkId')::uuid for share;
  if l.id is null or l.channel<>'slack' or l.verified_at is null or l.user_id is distinct from actor
    or l.binding_version is distinct from (input->>'identityLinkVersion')::bigint
    or l.meta->>'team_id' is distinct from input->>'workspaceId'
    or coalesce(l.external_id,'') !~ '^[UW][A-Z0-9]{1,63}$'
    or coalesce(l.meta->>'bot_user_id','') !~ '^[UW][A-Z0-9]{1,63}$' then
    raise exception 'Verified Slack identity required' using errcode='42501'; end if;
  perform 1 from public.account_members where account_id=l.account_id and user_id=actor for share;
  if not found then raise exception 'Slack identity owner is no longer a member' using errcode='42501'; end if;
  return input || jsonb_build_object('externalId',l.external_id,'botUserId',l.meta->>'bot_user_id');
end $$;
revoke all on function public.slack_route_preflight(jsonb) from public,anon,authenticated;
grant execute on function public.slack_route_preflight(jsonb) to service_role;

create function public.stage_slack_conversation_route(input jsonb, evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare checked jsonb; r unc_slack_private.conversation_routes%rowtype; observed timestamptz;
begin
  checked:=public.slack_route_preflight(input);
  observed:=(evidence->>'verifiedAt')::timestamptz;
  if jsonb_typeof(evidence) is distinct from 'object'
    or evidence-array['workspaceId','conversationId','botUserId','isMember','isArchived','isShared','verifiedAt']<>'{}'::jsonb
    or evidence->>'workspaceId' is distinct from checked->>'workspaceId'
    or evidence->>'conversationId' is distinct from checked->>'conversationId'
    or evidence->>'botUserId' is distinct from checked->>'botUserId'
    or evidence->'isMember' is distinct from 'true'::jsonb
    or evidence->'isArchived' is distinct from 'false'::jsonb
    or evidence->'isShared' is distinct from 'false'::jsonb
    or observed is null or observed<clock_timestamp()-interval '5 minutes' or observed>clock_timestamp()+interval '30 seconds' then
    raise exception 'Fresh matching Slack resource verification required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('slack-route:'||(input->>'workspaceId')||':'||(input->>'conversationId'),0));
  select * into r from unc_slack_private.conversation_routes
    where workspace_id=input->>'workspaceId' and conversation_id=input->>'conversationId' for update;
  if r.id is not null then
    if r.account_id is distinct from (input->>'accountId')::uuid
      or r.context_generation is distinct from (input->>'contextGeneration')::bigint
      or r.identity_link_id is distinct from (input->>'identityLinkId')::uuid
      or r.identity_link_version is distinct from (input->>'identityLinkVersion')::bigint
      or r.owner_id is distinct from (input->>'actorId')::uuid or r.state<>'staged' then
      raise exception 'Channel already bound; explicit cutover required' using errcode='PT409'; end if;
  else
    insert into unc_slack_private.conversation_routes(account_id,context_generation,workspace_id,conversation_id,
      owner_id,identity_link_id,identity_link_version,bot_user_id,verified_at)
    values((input->>'accountId')::uuid,(input->>'contextGeneration')::bigint,input->>'workspaceId',input->>'conversationId',
      (input->>'actorId')::uuid,(input->>'identityLinkId')::uuid,(input->>'identityLinkVersion')::bigint,checked->>'botUserId',observed)
    returning * into r;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.stage_slack_conversation_route(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stage_slack_conversation_route(jsonb,jsonb) to service_role;

-- Returns a candidate identity, not authority to execute a command or send a
-- message. Inbox/outbox must capture and recheck this revision atomically.
create function public.resolve_slack_conversation_route(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r unc_slack_private.conversation_routes%rowtype; a public.accounts%rowtype;
  l public.channel_links%rowtype; setup_link public.channel_links%rowtype; member_role text;
begin
  if jsonb_typeof(input) is distinct from 'object' or input-array['workspaceId','conversationId','externalId']<>'{}'::jsonb
    or coalesce(input->>'workspaceId','') !~ '^T[A-Z0-9]{1,63}$'
    or coalesce(input->>'conversationId','') !~ '^[CG][A-Z0-9]{1,63}$'
    or coalesce(input->>'externalId','') !~ '^[UW][A-Z0-9]{1,63}$' then
    raise exception 'Invalid Slack origin' using errcode='22023'; end if;
  select * into r from unc_slack_private.conversation_routes
    where workspace_id=input->>'workspaceId' and conversation_id=input->>'conversationId' for share;
  if r.id is null or r.state<>'active' then return null; end if;
  select * into a from public.accounts where id=r.account_id for share;
  if a.id is null or a.context_generation<>r.context_generation or a.automation_paused then return null; end if;
  select * into setup_link from public.channel_links where id=r.identity_link_id for share;
  if setup_link.id is null or setup_link.channel<>'slack' or setup_link.verified_at is null
    or setup_link.binding_version<>r.identity_link_version or setup_link.user_id is distinct from r.owner_id
    or setup_link.meta->>'team_id' is distinct from r.workspace_id
    or setup_link.meta->>'bot_user_id' is distinct from r.bot_user_id then return null; end if;
  perform 1 from public.account_members where account_id=r.account_id and user_id=r.owner_id and role='owner' for share;
  if not found then return null; end if;
  perform 1 from public.account_members where account_id=setup_link.account_id and user_id=r.owner_id for share;
  if not found then return null; end if;
  select * into l from public.channel_links where channel='slack' and verified_at is not null
    and external_id=input->>'externalId' and meta->>'team_id'=r.workspace_id for share;
  if l.id is null or l.user_id is null or l.meta->>'bot_user_id' is distinct from r.bot_user_id then return null; end if;
  select role into member_role from public.account_members where account_id=r.account_id and user_id=l.user_id for share;
  if member_role is null then return null; end if;
  perform 1 from public.account_members where account_id=l.account_id and user_id=l.user_id for share;
  if not found then return null; end if;
  return jsonb_build_object('routeId',r.id,'routeRevision',r.revision,'accountId',r.account_id,
    'contextGeneration',r.context_generation,'workspaceId',r.workspace_id,'conversationId',r.conversation_id,
    'userId',l.user_id,'externalId',l.external_id,'identityLinkId',l.id,'identityLinkVersion',l.binding_version,
    'memberRole',member_role,'botUserId',r.bot_user_id);
end $$;
revoke all on function public.resolve_slack_conversation_route(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_slack_conversation_route(jsonb) to service_role;
