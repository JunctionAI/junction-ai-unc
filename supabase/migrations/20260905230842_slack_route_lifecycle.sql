-- Keep retired route IDs immutable for inbox/outbox/history. A new binding is
-- a new row, only after the previous owner's explicit revocation.
alter table unc_slack_private.conversation_routes
  drop constraint conversation_routes_workspace_id_conversation_id_key;
create unique index slack_live_conversation on unc_slack_private.conversation_routes(workspace_id,conversation_id)
  where state<>'revoked';

-- Preserve the current functions, changing only which reservation they select.
-- Refuse drift rather than replacing an unrecognised installed definition.
do $$
declare signature text; definition text; old_clause text;
begin
  foreach signature in array array['public.stage_slack_conversation_route(jsonb,jsonb)', 'public.resolve_slack_conversation_route(jsonb)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    old_clause:='where workspace_id=input->>''workspaceId'' and conversation_id=input->>''conversationId'' for ';
    if (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause)<>1 then
      raise exception 'Slack route definition drift: %',signature; end if;
    execute replace(definition,old_clause,'where workspace_id=input->>''workspaceId'' and conversation_id=input->>''conversationId'' and state<>''revoked'' for ');
  end loop;
end $$;

create table unc_slack_private.route_transitions (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references unc_slack_private.conversation_routes(id),
  actor_id uuid not null references auth.users(id),
  from_revision bigint not null,
  to_revision bigint not null,
  action text not null check(action in ('activate','pause','revoke')),
  approval_ref text,
  created_at timestamptz not null default clock_timestamp(),
  unique(route_id,to_revision)
);
alter table unc_slack_private.route_transitions enable row level security;
revoke all on unc_slack_private.route_transitions from public,anon,authenticated,service_role;
grant select,insert on unc_slack_private.route_transitions to service_role;

create function public.transition_slack_conversation_route(input jsonb, evidence jsonb, approval jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; r unc_slack_private.conversation_routes%rowtype;
  prior_revision bigint; actor uuid; requested text; observed timestamptz; checked jsonb;
  secret_updated timestamptz;
begin
  if jsonb_typeof(input) is distinct from 'object'
    or input-array['accountId','contextGeneration','actorId','routeId','revision','action']<>'{}'::jsonb
    or not input ?& array['accountId','contextGeneration','actorId','routeId','revision','action']
    or jsonb_typeof(input->'action') is distinct from 'string' or input->>'action' not in ('activate','pause','revoke')
    or jsonb_typeof(input->'revision') is distinct from 'number' or input->>'revision' !~ '^[0-9]+$'
    or jsonb_typeof(input->'contextGeneration') is distinct from 'number' or input->>'contextGeneration' !~ '^[0-9]+$' then
    raise exception 'Invalid Slack transition' using errcode='22023'; end if;
  actor:=(input->>'actorId')::uuid; requested:=input->>'action';
  select * into a from public.accounts where id=(input->>'accountId')::uuid for share;
  perform 1 from public.account_members where account_id=a.id and user_id=actor and role='owner' for share;
  if a.id is null or actor is null or not found then raise exception 'Account owner required' using errcode='42501'; end if;
  if a.context_generation is distinct from (input->>'contextGeneration')::bigint then
    raise exception 'Account context changed' using errcode='PT409'; end if;
  select * into r from unc_slack_private.conversation_routes where id=(input->>'routeId')::uuid;
  if r.id is null or r.account_id<>a.id then raise exception 'Account route required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('slack-route:'||r.workspace_id||':'||r.conversation_id,0));
  select * into r from unc_slack_private.conversation_routes where id=r.id for update;
  if r.revision<>(input->>'revision')::bigint then raise exception 'Route changed; read back before retry' using errcode='PT409'; end if;
  prior_revision:=r.revision;
  if requested='activate' then
    if r.state<>'staged' or r.context_generation<>a.context_generation or a.automation_paused or r.owner_id is distinct from actor then
      raise exception 'Current unpaused staged owner route required' using errcode='PT409'; end if;
    checked:=public.slack_route_preflight(jsonb_build_object('accountId',a.id,'contextGeneration',a.context_generation,
      'actorId',actor,'identityLinkId',r.identity_link_id,'identityLinkVersion',r.identity_link_version,
      'workspaceId',r.workspace_id,'conversationId',r.conversation_id));
    if checked->>'botUserId' is distinct from r.bot_user_id then raise exception 'Bot binding changed' using errcode='PT409'; end if;
    if jsonb_typeof(approval) is distinct from 'object'
      or approval-array['accountId','contextGeneration','actorId','routeId','revision','workspaceId','conversationId','botUserId','expiresAt','reference','previousResponderStopped']<>'{}'::jsonb
      or approval->>'accountId' is distinct from a.id::text or approval->>'contextGeneration' is distinct from a.context_generation::text
      or approval->>'actorId' is distinct from actor::text or approval->>'routeId' is distinct from r.id::text
      or approval->>'revision' is distinct from r.revision::text or approval->>'workspaceId' is distinct from r.workspace_id
      or approval->>'conversationId' is distinct from r.conversation_id or approval->>'botUserId' is distinct from r.bot_user_id
      or approval->'previousResponderStopped' is distinct from 'true'::jsonb
      or coalesce(length(approval->>'reference'),0) not between 1 and 200
      or (approval->>'expiresAt')::timestamptz is null
      or (approval->>'expiresAt')::timestamptz<=clock_timestamp()
      or (approval->>'expiresAt')::timestamptz>clock_timestamp()+interval '1 hour' then
      raise exception 'Exact unexpired operator cutover approval required' using errcode='42501'; end if;
    observed:=(evidence->>'verifiedAt')::timestamptz;
    select updated_at into secret_updated from public.channel_secrets
      where channel='slack' and scope_id=r.workspace_id for share;
    if jsonb_typeof(evidence) is distinct from 'object'
      or evidence-array['workspaceId','conversationId','botUserId','isMember','isArchived','isShared','verifiedAt','credentialUpdatedAt']<>'{}'::jsonb
      or evidence->>'workspaceId' is distinct from r.workspace_id or evidence->>'conversationId' is distinct from r.conversation_id
      or evidence->>'botUserId' is distinct from r.bot_user_id or evidence->'isMember' is distinct from 'true'::jsonb
      or evidence->'isArchived' is distinct from 'false'::jsonb or evidence->'isShared' is distinct from 'false'::jsonb
      or observed is null or observed<clock_timestamp()-interval '5 minutes' or observed>clock_timestamp()+interval '30 seconds'
      or secret_updated is null or secret_updated is distinct from (evidence->>'credentialUpdatedAt')::timestamptz then
      raise exception 'Fresh channel and unchanged credential required' using errcode='42501'; end if;
    update unc_slack_private.conversation_routes set state='active',verified_at=observed where id=r.id returning * into r;
  else
    -- Stopping must work after unlink, context repair or loss of provider access.
    -- Already paused/revoked with the exact current revision is an honest no-op.
    if (requested='pause' and r.state='staged') or (requested='revoke' and r.state='revoked') then return to_jsonb(r); end if;
    if r.state='revoked' then raise exception 'Revoked route is terminal' using errcode='PT409'; end if;
    update unc_slack_private.conversation_routes set state=case when requested='pause' then 'staged' else 'revoked' end
      where id=r.id returning * into r;
  end if;
  insert into unc_slack_private.route_transitions(route_id,actor_id,from_revision,to_revision,action,approval_ref)
    values(r.id,actor,prior_revision,r.revision,requested,case when requested='activate' then approval->>'reference' end);
  return to_jsonb(r);
end $$;
revoke all on function public.transition_slack_conversation_route(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.transition_slack_conversation_route(jsonb,jsonb,jsonb) to service_role;
