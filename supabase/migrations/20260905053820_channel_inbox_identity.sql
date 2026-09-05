-- Arrival identity is captured in one short transaction, before provider acknowledgement.
-- Additive preparation: do not enable channels until the consumers/outbox are fenced too.
alter table public.channel_links
  add column binding_version bigint not null default 0 check (binding_version >= 0),
  add column link_code_generation bigint check (link_code_generation >= 0);

-- Existing codes are deliberately not grandfathered: their issue generation is unknown.
-- Existing verified links survive a context reset; each NEW message captures the new context.
create or replace function unc_private.version_channel_link()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare actual_generation bigint;
begin
  if tg_op = 'INSERT' then
    new.binding_version := 0;
  else
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'Channel link identity is immutable' using errcode = '23514';
    end if;
    if new.binding_version is distinct from old.binding_version then
      raise exception 'Channel binding revision is database managed' using errcode = '23514';
    end if;
    -- Metadata includes workspace/destination routing and human-handoff controls.
    -- last_inbound_at, names and preference edits do not represent a new identity.
    if row(new.account_id,new.user_id,new.channel,new.external_id,new.verified_at,
           new.link_code,new.link_code_expires_at,new.link_code_generation,new.meta)
       is distinct from
       row(old.account_id,old.user_id,old.channel,old.external_id,old.verified_at,
           old.link_code,old.link_code_expires_at,old.link_code_generation,old.meta) then
      new.binding_version := old.binding_version + 1;
    end if;
  end if;
  if new.link_code is null then
    new.link_code_generation := null;
  else
    select context_generation into actual_generation from public.accounts
      where id = new.account_id for share;
    if actual_generation is null or new.link_code_generation is distinct from actual_generation then
      raise exception 'Link code belongs to an unavailable account context' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function unc_private.version_channel_link() from public, anon, authenticated;
create trigger channel_link_binding_version before insert or update on public.channel_links
  for each row execute function unc_private.version_channel_link();

alter table public.channel_inbox add column binding jsonb;
-- NULL is legacy/unbound, never an instruction to look up an account at processing time.
create or replace function unc_private.guard_channel_inbox_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.id,new.channel,new.event,new.binding,new.created_at)
     is distinct from row(old.id,old.channel,old.event,old.binding,old.created_at) then
    raise exception 'Accepted channel event and binding are immutable' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not
    ((old.status='queued' and new.status in ('running','uncertain')) or
     (old.status='running' and new.status in ('done','uncertain'))) then
    raise exception 'Accepted message cannot be replayed from a terminal state' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function unc_private.guard_channel_inbox_identity() from public, anon, authenticated;
create trigger channel_inbox_immutable before update on public.channel_inbox
  for each row execute function unc_private.guard_channel_inbox_identity();

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

  raw_text := btrim(inbound_event->>'text');
  code_text := regexp_replace(regexp_replace(upper(raw_text),'^/START[[:space:]]+',''),'[[:space:]]','','g');
  code_text := regexp_replace(code_text,'^UNC-?','');
  is_code := coalesce(inbound_event->>'lifecycle' is null and code_text ~ '^[A-Z2-9]{6}$'
    and (raw_text ~* '^(/start[[:space:]]+|unc[-[:space:]]?)' or raw_text ~ '[2-9]'),false);
  if is_code then
    select * into destination from public.channel_links where link_code='UNC-'||code_text for share;
  else
    select * into destination from public.channel_links
      where channel=inbound_event->>'channel' and external_id=inbound_event->>'externalId'
        and verified_at is not null for share;
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
revoke all on function public.accept_channel_inbound(text,jsonb) from public, anon, authenticated;
grant execute on function public.accept_channel_inbound(text,jsonb) to service_role;

-- Invoker, service-only. Atomic dequeue; a crash cannot automatically replay claimed work.
-- Consumers validate the captured binding before touching account data. Unbound historical
-- rows are quarantined, not silently relabelled. Claim one at a time (no stranded batch).
create or replace function public.claim_channel_inbound()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.channel_inbox%rowtype;
begin
  update public.channel_inbox set status='uncertain',updated_at=clock_timestamp()
    where (status='queued' and binding is null)
       or (status='running' and updated_at<clock_timestamp()-interval '10 minutes');
  select * into saved from public.channel_inbox where status='queued' and binding is not null
    order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.channel_inbox set status='running',updated_at=clock_timestamp()
    where id=saved.id returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.claim_channel_inbound() from public, anon, authenticated;
grant execute on function public.claim_channel_inbound() to service_role;
