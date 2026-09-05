-- Depends on the staged channel_inbox_identity migration. Short DB-only operations;
-- no provider I/O. The original arrival binding is NEVER rewritten after verification.
alter table public.channel_inbox add column control_result jsonb;
create or replace function unc_private.guard_channel_control_receipt()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.control_result is not null and new.control_result is distinct from old.control_result then
    raise exception 'Channel control receipt is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function unc_private.guard_channel_control_receipt() from public,anon,authenticated;
create trigger channel_control_receipt before update of control_result on public.channel_inbox
  for each row execute function unc_private.guard_channel_control_receipt();

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

  stamp:=clock_timestamp(); -- after row-lock waits, not function entry time
  if saved.binding->>'kind'='link_code' then
    if destination.verified_at is not null or destination.link_code is null
       or destination.link_code_generation is distinct from generation
       or destination.link_code_expires_at is null or destination.link_code_expires_at<=stamp then
      raise exception 'Original verification code is no longer valid' using errcode='40001';
    end if;
    -- Only the device that sent the accepted code moves, in this same transaction.
    delete from public.channel_links where channel=saved.channel
      and external_id=saved.event->>'externalId' and id<>destination.id;
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
revoke all on function public.apply_channel_inbound_control(text) from public,anon,authenticated;
grant execute on function public.apply_channel_inbound_control(text) to service_role;

-- One round trip and one database snapshot for each preflight, rather than four serial
-- REST reads. Locks live only for this short read transaction, never across model/send I/O.
create or replace function public.verify_channel_inbound_binding(expected jsonb,inbound_event jsonb,allow_paused boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare destination public.channel_links%rowtype; paused boolean;
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
  if expected->>'kind'='link_code' and destination.link_code_expires_at<=clock_timestamp() then
    raise exception 'Original verification code expired during preflight' using errcode='40001';
  end if;
  select automation_paused into paused from public.accounts where id=destination.account_id;
  if paused and not coalesce(allow_paused,false) then raise exception 'automation_paused' using errcode='P0001'; end if;
  return to_jsonb(destination);
end;
$$;
revoke all on function public.verify_channel_inbound_binding(jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.verify_channel_inbound_binding(jsonb,jsonb,boolean) to service_role;
