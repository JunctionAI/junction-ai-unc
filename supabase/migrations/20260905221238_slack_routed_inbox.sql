-- Private, staged registry -> captured account-bound destination. No routes enabled.
-- Preserve the original OAuth identity; room destinations are a distinct key space.
alter table public.channel_links add column slack_route_id uuid references unc_slack_private.conversation_routes(id) on delete restrict;
alter table public.channel_links add constraint channel_link_slack_route_kind check(slack_route_id is null or (channel='slack' and link_code is null));
alter table public.channel_links drop constraint channel_links_channel_external_id_key;
create unique index channel_links_direct_identity on public.channel_links (channel,external_id) where slack_route_id is null;
create unique index channel_links_routed_identity on public.channel_links (slack_route_id,external_id) where slack_route_id is not null;

create function unc_slack_private.guard_route_link_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.slack_route_id is distinct from old.slack_route_id or
    (old.slack_route_id is not null and row(new.account_id,new.channel,new.external_id) is distinct from row(old.account_id,old.channel,old.external_id)) then
    raise exception 'Routed channel identity cannot be transferred' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function unc_slack_private.guard_route_link_identity() from public,anon,authenticated;
create trigger slack_route_link_identity before update on public.channel_links
for each row execute function unc_slack_private.guard_route_link_identity();

create or replace function public.slack_route_preflight(input jsonb) returns jsonb
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
  if l.id is null or l.slack_route_id is not null or l.channel<>'slack' or l.verified_at is null or l.user_id is distinct from actor
    or l.binding_version is distinct from (input->>'identityLinkVersion')::bigint
    or l.meta->>'team_id' is distinct from input->>'workspaceId'
    or coalesce(l.external_id,'') !~ '^[UW][A-Z0-9]{1,63}$'
    or coalesce(l.meta->>'bot_user_id','') !~ '^[UW][A-Z0-9]{1,63}$' then
    raise exception 'Verified Slack identity required' using errcode='42501'; end if;
  perform 1 from public.account_members where account_id=l.account_id and user_id=actor for share;
  if not found then raise exception 'Slack identity owner is no longer a member' using errcode='42501'; end if;
  return input || jsonb_build_object('externalId',l.external_id,'botUserId',l.meta->>'bot_user_id');
end $$;

create or replace function public.resolve_slack_conversation_route(input jsonb) returns jsonb
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
  if setup_link.id is null or setup_link.slack_route_id is not null or setup_link.channel<>'slack' or setup_link.verified_at is null
    or setup_link.binding_version<>r.identity_link_version or setup_link.user_id is distinct from r.owner_id
    or setup_link.meta->>'team_id' is distinct from r.workspace_id
    or setup_link.meta->>'bot_user_id' is distinct from r.bot_user_id then return null; end if;
  perform 1 from public.account_members where account_id=r.account_id and user_id=r.owner_id and role='owner' for share;
  if not found then return null; end if;
  perform 1 from public.account_members where account_id=setup_link.account_id and user_id=r.owner_id for share;
  if not found then return null; end if;
  select * into l from public.channel_links where channel='slack' and slack_route_id is null and verified_at is not null
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

create or replace function public.accept_channel_inbound(inbox_id text, inbound_event jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.channel_inbox%rowtype;
  destination public.channel_links%rowtype;
  generation bigint;
  captured jsonb := jsonb_build_object('version',1,'kind','unlinked');
  code_text text;
  raw_text text;
  is_code boolean := false;
  route_identity jsonb; routed_meta jsonb;
  routed boolean := false;
begin
  if inbox_id is null or inbox_id !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(inbound_event) is distinct from 'object'
     or octet_length(inbound_event::text)>32000
     or inbound_event->>'channel' is null
     or inbound_event->>'channel' not in ('telegram','whatsapp','slack','sms','email','apple')
     or coalesce(inbound_event->>'externalId','') = ''
     or coalesce(inbound_event->>'externalMsgId','') = '' then
    raise exception 'Invalid verified channel event' using errcode = '22023';
  end if;
  -- Serialize duplicate first acceptances, including across different account/link states.
  -- A hash collision only serializes unrelated ingress; it cannot alias their primary keys.
  perform pg_advisory_xact_lock(hashtextextended(inbox_id,0));
  select * into saved from public.channel_inbox where id=inbox_id;
  if found then
    if saved.event is distinct from inbound_event then
      raise exception 'Provider event identity was reused with different content' using errcode = '23514';
    end if;
    return to_jsonb(saved);
  end if;

  if inbound_event->>'channel'='slack' and coalesce(inbound_event->>'conversationId','') !~ '^D[A-Z0-9]{1,63}$' then
    -- A room cannot fall through to the sender's unrelated direct-message account.
    routed:=true;
    if coalesce(inbound_event->>'conversationId','') ~ '^[CG][A-Z0-9]{1,63}$'
      and coalesce(inbound_event->>'threadId','') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      route_identity:=public.resolve_slack_conversation_route(jsonb_build_object(
        'workspaceId',inbound_event->>'scopeId','conversationId',inbound_event->>'conversationId','externalId',inbound_event->>'externalId'));
    end if;
    if route_identity is not null and (inbound_event->>'accountScope' is null or
       inbound_event->>'accountScope'=route_identity->>'accountId') then
      routed_meta:=jsonb_build_object('team_id',route_identity->>'workspaceId','bot_user_id',route_identity->>'botUserId',
        'slack_conversation_id',route_identity->>'conversationId','slack_route_id',route_identity->>'routeId',
        'slack_route_revision',route_identity->'routeRevision','slack_identity_link_id',route_identity->>'identityLinkId',
        'slack_identity_link_version',route_identity->'identityLinkVersion');
      insert into public.channel_links(account_id,user_id,channel,external_id,verified_at,slack_route_id,meta)
        values((route_identity->>'accountId')::uuid,(route_identity->>'userId')::uuid,'slack',inbound_event->>'externalId',
          clock_timestamp(),(route_identity->>'routeId')::uuid,routed_meta)
        on conflict (slack_route_id,external_id) where slack_route_id is not null do update
          set user_id=excluded.user_id,meta=excluded.meta
          where channel_links.meta is distinct from excluded.meta or channel_links.user_id is distinct from excluded.user_id
        returning * into destination;
      if destination.id is null then
        select * into destination from public.channel_links where slack_route_id=(route_identity->>'routeId')::uuid
          and external_id=inbound_event->>'externalId' for share;
      end if;
    end if;
  end if;
  raw_text := btrim(inbound_event->>'text');
  code_text := regexp_replace(regexp_replace(upper(raw_text),'^/START[[:space:]]+',''),'[[:space:]]','','g');
  code_text := regexp_replace(code_text,'^UNC-?','');
  is_code := coalesce(inbound_event->>'lifecycle' is null and code_text ~ '^[A-Z2-9]{6}$'
    and (raw_text ~* '^(/start[[:space:]]+|unc[-[:space:]]?)' or raw_text ~ '[2-9]'),false);
  if routed then
    is_code:=false; -- No device transfers from a code pasted in a room.
  elsif is_code then
    select * into destination from public.channel_links where link_code='UNC-'||code_text for share;
  else
    select * into destination from public.channel_links
      where channel=inbound_event->>'channel' and external_id=inbound_event->>'externalId'
        and verified_at is not null and slack_route_id is null for share;
  end if;
  if destination.id is not null then
    select context_generation into generation from public.accounts where id=destination.account_id for share;
    if generation is not null
      and destination.channel=inbound_event->>'channel'
      and (inbound_event->>'accountScope' is null or inbound_event->>'accountScope'=destination.account_id::text)
      and (destination.channel<>'slack' or
           (inbound_event->>'scopeId' is not null and destination.meta->>'team_id'=inbound_event->>'scopeId'))
      and exists(select 1 from public.account_members where account_id=destination.account_id and user_id=destination.user_id)
      and (not is_code or (destination.verified_at is null and destination.link_code_expires_at>clock_timestamp()
                           and destination.link_code_generation=generation)) then
      captured := jsonb_build_object('version',1,'kind',case when is_code then 'link_code' else 'linked' end,
        'accountId',destination.account_id,'contextGeneration',generation,
        'linkId',destination.id,'bindingVersion',destination.binding_version,'userId',destination.user_id);
    end if;
  end if;
  insert into public.channel_inbox(id,channel,event,binding,status)
    values(inbox_id,inbound_event->>'channel',inbound_event,captured,'queued') returning * into saved;
  return to_jsonb(saved);
end;
$$;

create or replace function public.verify_channel_inbound_binding(expected jsonb,inbound_event jsonb,allow_paused boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare destination public.channel_links%rowtype; paused boolean; route_identity jsonb; conversation text;
begin
  select l.* into destination from public.channel_links l
    join public.accounts a on a.id=l.account_id
    join public.account_members m on m.account_id=l.account_id and m.user_id=l.user_id
    where expected->>'version'='1'
      and l.id::text=expected->>'linkId' and l.account_id::text=expected->>'accountId'
      and l.user_id::text=expected->>'userId' and l.binding_version::text=expected->>'bindingVersion'
      and a.context_generation::text=expected->>'contextGeneration'
      and l.channel=inbound_event->>'channel'
      and (inbound_event->>'accountScope' is null or inbound_event->>'accountScope'=l.account_id::text)
      and (l.channel<>'slack' or (inbound_event->>'scopeId' is not null and l.meta->>'team_id'=inbound_event->>'scopeId'))
      and ((expected->>'kind'='linked' and l.verified_at is not null and l.external_id=inbound_event->>'externalId')
        or (expected->>'kind'='link_code' and l.verified_at is null and l.link_code is not null
          and l.link_code_generation=a.context_generation and l.link_code_expires_at>clock_timestamp()))
    for share of a,l,m;
  if not found then raise exception 'Original channel context changed' using errcode='40001'; end if;
  if destination.slack_route_id is not null then
    conversation:=coalesce(inbound_event->>'conversationId',expected->>'conversationId');
    if expected->>'kind'<>'linked' or destination.channel<>'slack'
      or conversation is distinct from destination.meta->>'slack_conversation_id'
      or (inbound_event->>'conversationId' is not null and expected->>'conversationId' is not null
        and inbound_event->>'conversationId'<>expected->>'conversationId')
      or (inbound_event->>'threadId' is not null and expected->>'threadId' is not null
        and inbound_event->>'threadId'<>expected->>'threadId')
      or coalesce(inbound_event->>'threadId',expected->>'threadId','') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      raise exception 'Original Slack conversation unavailable' using errcode='40001'; end if;
    route_identity:=public.resolve_slack_conversation_route(jsonb_build_object('workspaceId',destination.meta->>'team_id',
      'conversationId',conversation,'externalId',destination.external_id));
    if route_identity is null or route_identity->>'routeId' is distinct from destination.slack_route_id::text
      or route_identity->>'routeRevision' is distinct from destination.meta->>'slack_route_revision'
      or route_identity->>'identityLinkId' is distinct from destination.meta->>'slack_identity_link_id'
      or route_identity->>'identityLinkVersion' is distinct from destination.meta->>'slack_identity_link_version'
      or route_identity->>'accountId' is distinct from destination.account_id::text
      or route_identity->>'userId' is distinct from destination.user_id::text then
      raise exception 'Original Slack route or sender changed' using errcode='40001'; end if;
  elsif destination.channel='slack' and coalesce(inbound_event->>'conversationId',expected->>'conversationId','') ~ '^[CG]' then
    raise exception 'A client room cannot use a DM binding' using errcode='40001';
  end if;
  if expected->>'kind'='link_code' and destination.link_code_expires_at<=clock_timestamp() then
    raise exception 'Original verification code expired during preflight' using errcode='40001';
  end if;
  select automation_paused into paused from public.accounts where id=destination.account_id;
  if paused and not coalesce(allow_paused,false) then raise exception 'automation_paused' using errcode='P0001'; end if;
  return to_jsonb(destination);
end;
$$;

create or replace function public.apply_channel_inbound_control(inbox_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  saved public.channel_inbox%rowtype;
  destination public.channel_links%rowtype;
  generation bigint;
  outcome jsonb;
  stamp timestamptz;
  source text;
begin
  select * into saved from public.channel_inbox where id=inbox_id for update;
  if not found or saved.status<>'running' or saved.binding->>'version' is distinct from '1' then
    raise exception 'A claimed, captured message is required' using errcode='40001';
  end if;
  if saved.control_result is not null then return saved.control_result; end if;
  if saved.binding->>'kind'='unlinked' then return jsonb_build_object('kind','unlinked'); end if;
  if saved.binding->>'kind' not in ('linked','link_code') then
    raise exception 'Invalid captured channel kind' using errcode='23514';
  end if;
  -- Serialize two code handshakes targeting the same device before locking their pending
  -- rows. A competing OAuth writer still hits the unique destination key and fails closed.
  if saved.binding->>'kind'='link_code' then
    perform pg_advisory_xact_lock(hashtextextended(saved.channel||':'||(saved.event->>'externalId'),1));
  end if;
  select * into destination from public.channel_links where id=(saved.binding->>'linkId')::uuid for update;
  if not found or destination.account_id::text is distinct from saved.binding->>'accountId'
     or destination.user_id::text is distinct from saved.binding->>'userId'
     or destination.binding_version::text is distinct from saved.binding->>'bindingVersion'
     or destination.channel is distinct from saved.channel then
    raise exception 'Original channel connection changed' using errcode='40001';
  end if;
  select context_generation into generation from public.accounts where id=destination.account_id for share;
  if generation is null or generation::text is distinct from saved.binding->>'contextGeneration' then
    raise exception 'Original channel business context changed' using errcode='40001';
  end if;
  perform 1 from public.account_members where account_id=destination.account_id and user_id=destination.user_id for share;
  if not found then raise exception 'Original sender no longer has account access' using errcode='40001'; end if;
  if (saved.event->>'accountScope' is not null and saved.event->>'accountScope'<>destination.account_id::text)
     or (saved.channel='slack' and (saved.event->>'scopeId' is null or destination.meta->>'team_id' is distinct from saved.event->>'scopeId')) then
    raise exception 'Captured channel scope does not match' using errcode='40001';
  end if;

  if destination.slack_route_id is not null then
    perform public.verify_channel_inbound_binding(saved.binding,saved.event,false);
  end if;
  stamp:=clock_timestamp(); -- after row-lock waits, not function entry time
  if saved.binding->>'kind'='link_code' then
    if destination.verified_at is not null or destination.link_code is null
       or destination.link_code_generation is distinct from generation
       or destination.link_code_expires_at is null or destination.link_code_expires_at<=stamp then
      raise exception 'Original verification code is no longer valid' using errcode='40001';
    end if;
    -- Only the device that sent the accepted code moves, in this same transaction.
    delete from public.channel_links where channel=saved.channel
      and external_id=saved.event->>'externalId' and id<>destination.id and slack_route_id is null;
    -- A prior destination's delete can itself wait. Expiry here rolls back that transfer.
    stamp:=clock_timestamp();
    if destination.link_code_expires_at<=stamp then
      raise exception 'Original verification code expired during transfer' using errcode='40001';
    end if;
    update public.channel_links set external_id=saved.event->>'externalId',
      handle=saved.event->>'handle',display_name=saved.event->>'displayName',verified_at=stamp,
      link_code=null,link_code_generation=null,link_code_expires_at=null,last_inbound_at=stamp
      where id=destination.id returning * into destination;
    outcome:=jsonb_build_object('kind','linked','link',to_jsonb(destination),'contextGeneration',generation);
  else
    if destination.verified_at is null or destination.external_id is distinct from saved.event->>'externalId' then
      raise exception 'Original sender is no longer verified' using errcode='40001';
    end if;
    source:=lower(btrim(coalesce(saved.event->>'text','')));
    if (saved.channel='apple' and saved.event->>'lifecycle'='conversation_closed')
       or (saved.channel in ('sms','apple') and source in ('stop','unsubscribe','cancel','end','quit')) then
      delete from public.channel_links where id=destination.id;
      outcome:=jsonb_build_object('kind','unsubscribed','accountId',destination.account_id,'contextGeneration',generation);
    elsif saved.channel='apple' and source in ('help','human','support','talk to a human') then
      update public.channel_links set meta=meta||'{"human_support_requested":true}'::jsonb where id=destination.id returning * into destination;
      outcome:=jsonb_build_object('kind','handoff','link',to_jsonb(destination),'contextGeneration',generation);
    else
      update public.channel_links set last_inbound_at=stamp where id=destination.id returning * into destination;
      outcome:=jsonb_build_object('kind','opened','link',to_jsonb(destination),'contextGeneration',generation);
    end if;
  end if;
  update public.channel_inbox set control_result=outcome where id=saved.id;
  return outcome;
end;
$$;

create or replace function public.enqueue_channel_outbound(operation jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b jsonb:=operation->'binding'; p jsonb:=operation->'payload'; r jsonb:=nullif(operation->'replyContext','null'::jsonb); saved public.outbound_messages%rowtype;
  destination jsonb; permitted_pause boolean:=coalesce((operation->>'allowPaused')::boolean,false);
begin
  if jsonb_typeof(operation) is distinct from 'object' or octet_length(operation::text)>24000
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'text') is distinct from 'string'
    or length(p->>'text') not between 1 and 4000 or length(coalesce(operation->>'ref','')) not between 1 and 300
    or operation->>'kind' is null or operation->>'kind' not in ('reply','brief','approval','draft_landed','reminder','link','system')
    or b->>'kind' is distinct from 'linked' or permitted_pause and operation->>'kind' not in ('link','system') then
    raise exception 'Invalid outbound operation' using errcode='22023';
  end if;
  if r is not null and (jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'live') is distinct from 'boolean'
    or jsonb_typeof(r->'inReplyTo') is distinct from 'string' or length(r->>'inReplyTo') not between 1 and 500
    or r - 'live' - 'inReplyTo' - 'conversationId' - 'threadId' <> '{}'::jsonb) then
    raise exception 'Invalid reply context' using errcode='22023';
  end if;
  if r ?| array['conversationId','threadId'] then
    if b->>'channel'<>'slack' or coalesce(r->>'conversationId','') !~ '^[CDG][A-Z0-9]{1,63}$'
      or coalesce(r->>'threadId','') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
      or b->>'conversationId' is distinct from r->>'conversationId' or b->>'threadId' is distinct from r->>'threadId' then
      raise exception 'Original Slack reply context required' using errcode='22023'; end if;
  elsif b ?| array['conversationId','threadId'] then
    raise exception 'Slack binding requires matching reply context' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',b->>'accountId',b->>'contextGeneration',b->>'linkId',b->>'bindingVersion',operation->>'kind',operation->>'ref'),0));
  destination:=public.verify_channel_inbound_binding(b,jsonb_build_object('channel',b->>'channel','externalId',b->>'externalId','scopeId',b->>'scopeId'),permitted_pause);
  select * into saved from public.outbound_messages where account_id=(b->>'accountId')::uuid
    and context_generation=(b->>'contextGeneration')::bigint and captured_link_id=(b->>'linkId')::uuid
    and binding_version=(b->>'bindingVersion')::bigint and kind=operation->>'kind' and ref=operation->>'ref';
  if found then
    if saved.payload is distinct from p or saved.binding is distinct from b or saved.reply_context is distinct from r
      or saved.append_thread is distinct from coalesce((operation->>'appendThread')::boolean,true)
      or saved.allow_template is distinct from coalesce((operation->>'allowTemplate')::boolean,false)
      or saved.allow_paused is distinct from permitted_pause then
      raise exception 'Outbound operation reused with different content' using errcode='23514';
    end if;
    return to_jsonb(saved);
  end if;
  insert into public.outbound_messages(account_id,context_generation,link_id,captured_link_id,binding_version,binding,channel,kind,ref,body,payload,reply_context,status,append_thread,allow_template,allow_paused)
    values((b->>'accountId')::uuid,(b->>'contextGeneration')::bigint,(b->>'linkId')::uuid,(b->>'linkId')::uuid,
      (b->>'bindingVersion')::bigint,b,b->>'channel',operation->>'kind',operation->>'ref',p->>'text',p,r,'queued',
      coalesce((operation->>'appendThread')::boolean,true),coalesce((operation->>'allowTemplate')::boolean,false),permitted_pause)
    returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.prepare_command_notification(command_id uuid,expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.routine_commands%rowtype; destination jsonb; outbound jsonb; owner_role text;
begin
  select * into c from public.routine_commands where id=command_id;
  if not found or c.channel_binding is null or c.notification_revision is distinct from expected_revision then return null; end if;
  destination:=public.verify_channel_inbound_binding(c.channel_binding,jsonb_build_object('channel',c.channel,
    'externalId',c.channel_binding->>'externalId','scopeId',c.channel_binding->>'scopeId'),false);
  select role into owner_role from public.account_members where account_id=c.account_id and user_id=c.user_id for share;
  if owner_role is distinct from 'owner' then return null; end if;
  select * into c from public.routine_commands where id=command_id for update;
  if c.notification_revision is distinct from expected_revision or c.status not in ('waiting','done','blocked','failed','uncertain') then return null; end if;
  update public.routine_commands set notification_checked_at=clock_timestamp() where id=c.id;
  outbound:=public.enqueue_channel_outbound(jsonb_build_object('binding',c.channel_binding,'kind','reply',
    'ref','command:'||c.id::text||':'||c.notification_revision::text,
    'payload',jsonb_build_object('text',c.reply||' Request '||left(c.id::text,8)||'.'),'appendThread',true,
    'replyContext',case when c.channel_binding->>'conversationId' is null then null else
      jsonb_build_object('live',true,'inReplyTo',c.request_id,'conversationId',c.channel_binding->>'conversationId',
        'threadId',c.channel_binding->>'threadId') end));
  return jsonb_build_object('operation',outbound,'link',destination);
end $$;

create or replace function public.project_channel_outbound(outbound_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare saved public.outbound_messages%rowtype; chat_id uuid; stamp timestamptz; pos integer; i integer;
begin
  select * into saved from public.outbound_messages where id=outbound_id;
  if not found or saved.status<>'sent' or not saved.append_thread or saved.binding is null then return null; end if;
  begin
    perform public.verify_channel_inbound_binding(saved.binding,jsonb_build_object('channel',saved.channel,
      'externalId',saved.binding->>'externalId','scopeId',saved.binding->>'scopeId'),saved.allow_paused);
  exception when serialization_failure or raise_exception then
    update public.outbound_messages set projection_checked_at=clock_timestamp() where id=outbound_id;
    return null;
  end;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',saved.account_id,saved.context_generation,saved.kind,saved.ref),1));
  select id into chat_id from public.chat_messages where account_id=saved.account_id and context_generation=saved.context_generation
    and external_scope='outbound' and external_msg_id=saved.kind||':'||saved.ref limit 1;
  if found then
    update public.outbound_messages set projected_at=clock_timestamp(),projection_checked_at=clock_timestamp() where id=outbound_id;
    return chat_id;
  end if;
  stamp:=clock_timestamp();
  pos:=100000000+greatest(0,floor(extract(epoch from stamp-timestamptz '2026-01-01 00:00:00+00')))::integer;
  for i in 0..24 loop
    begin
      insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel,external_scope,external_msg_id,delivery,created_at)
        values(saved.account_id,saved.context_generation,'corner',pos+i,'ai','unc',saved.body,saved.channel,'outbound',saved.kind||':'||saved.ref,
          jsonb_build_object('status','sent','outbound_id',saved.id,'provider_message_id',saved.external_msg_id,'ref',saved.ref,'kind',saved.kind)
            || case when saved.reply_context is null then '{}'::jsonb else jsonb_build_object('live',saved.reply_context->'live','in_reply_to',saved.reply_context->>'inReplyTo') end
            || case when saved.binding->>'conversationId' is null then '{}'::jsonb else
              jsonb_build_object('slack_origin',jsonb_build_object('workspaceId',saved.binding->>'scopeId',
                'conversationId',saved.binding->>'conversationId','threadId',saved.binding->>'threadId')) end,stamp)
        returning id into chat_id;
      update public.outbound_messages set projected_at=stamp,projection_checked_at=stamp where id=outbound_id;
      return chat_id;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'No chat position available' using errcode='23505';
end $$;
