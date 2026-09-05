-- Owner setup readback only. No activation, credential material or listener changes.
create function public.slack_route_owner_view(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; actor uuid; identities jsonb; routes jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object'
    or input-array['accountId','contextGeneration','actorId']<>'{}'::jsonb
    or not input ?& array['accountId','contextGeneration','actorId']
    or jsonb_typeof(input->'contextGeneration') is distinct from 'number'
    or (input->>'contextGeneration') !~ '^[0-9]+$' then
    raise exception 'Invalid Slack setup context' using errcode='22023'; end if;
  actor:=(input->>'actorId')::uuid;
  select * into a from public.accounts where id=(input->>'accountId')::uuid for share;
  perform 1 from public.account_members where account_id=a.id and user_id=actor and role='owner' for share;
  if a.id is null or actor is null or not found then
    raise exception 'Account owner required' using errcode='42501'; end if;
  if a.context_generation is distinct from (input->>'contextGeneration')::bigint then
    raise exception 'Account context changed' using errcode='PT409'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'identityLinkId',l.id,'identityLinkVersion',l.binding_version,
    'workspaceId',l.meta->>'team_id','workspaceName',left(coalesce(l.meta->>'team_name',l.meta->>'team_id'),200),
    'botUserId',l.meta->>'bot_user_id',
    'credentialStored',exists(select 1 from public.channel_secrets s where s.channel='slack' and s.scope_id=l.meta->>'team_id')
  ) order by l.id),'[]'::jsonb) into identities
  from public.channel_links l
  where l.channel='slack' and l.slack_route_id is null and l.verified_at is not null and l.user_id=actor
    and l.external_id ~ '^[UW][A-Z0-9]{1,63}$' and l.meta->>'team_id' ~ '^T[A-Z0-9]{1,63}$'
    and l.meta->>'bot_user_id' ~ '^[UW][A-Z0-9]{1,63}$'
    and exists(select 1 from public.account_members m where m.account_id=l.account_id and m.user_id=actor);

  select coalesce(jsonb_agg(jsonb_build_object(
    'routeId',r.id,'revision',r.revision,'workspaceId',r.workspace_id,'conversationId',r.conversation_id,
    'identityLinkId',r.identity_link_id,'identityLinkVersion',r.identity_link_version,
    'state',r.state,'verifiedAt',r.verified_at,
    'bindingCurrent',r.context_generation=a.context_generation and exists(
      select 1 from public.channel_links l where l.id=r.identity_link_id and l.slack_route_id is null
        and l.channel='slack' and l.verified_at is not null and l.user_id=r.owner_id
        and l.binding_version=r.identity_link_version and l.meta->>'team_id'=r.workspace_id
        and l.meta->>'bot_user_id'=r.bot_user_id
        and exists(select 1 from public.account_members m where m.account_id=r.account_id and m.user_id=r.owner_id and m.role='owner')
        and exists(select 1 from public.account_members m where m.account_id=l.account_id and m.user_id=r.owner_id)
    )
  ) order by r.created_at,r.id),'[]'::jsonb) into routes
  from unc_slack_private.conversation_routes r where r.account_id=a.id;
  return jsonb_build_object('accountId',a.id,'actorId',actor,'contextGeneration',a.context_generation,
    'paused',a.automation_paused,'identities',identities,'routes',routes,'activationAvailable',false,'executedAction','none');
end $$;
revoke all on function public.slack_route_owner_view(jsonb) from public,anon,authenticated;
grant execute on function public.slack_route_owner_view(jsonb) to service_role;
