-- Staged, coordinated channel release. Legacy rows have NULL identity and are never retried.
alter table public.outbound_messages
  add column context_generation bigint check (context_generation >= 0),
  add column captured_link_id uuid,
  add column binding_version bigint check (binding_version >= 0),
  add column binding jsonb,
  add column payload jsonb,
  add column reply_context jsonb,
  add column append_thread boolean not null default false,
  add column allow_template boolean not null default false,
  add column allow_paused boolean not null default false,
  add column attempt_id uuid,
  add column send_started_at timestamptz,
  add column projected_at timestamptz,
  add column projection_checked_at timestamptz,
  add column completed_at timestamptz;
alter table public.outbound_messages drop constraint outbound_messages_status_check;
alter table public.outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued','sending','sent','failed','uncertain','cancelled'));
create unique index channel_outbound_operation_key on public.outbound_messages (account_id,context_generation,captured_link_id,binding_version,kind,ref) where context_generation is not null;

-- Existing member SELECT/RLS remains. No browser may create/claim/finalize a send.
revoke insert,update,delete,truncate,references,trigger on public.outbound_messages from public,anon,authenticated;

-- The old blanket pause trigger would erase delivery evidence by refusing a receipt
-- after an in-flight send. Fence INSERT/claim below; preserve its DELETE hold separately.
drop trigger account_automation_pause on public.outbound_messages;
create trigger account_automation_pause_delete before delete on public.outbound_messages
  for each row execute function unc_private.guard_automation_pause();

create function unc_private.guard_channel_outbound() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.context_generation is null or new.captured_link_id is null or new.binding_version is null
      or jsonb_typeof(new.binding) is distinct from 'object' or jsonb_typeof(new.payload) is distinct from 'object'
      or coalesce(new.ref,'')='' or new.status<>'queued' or new.attempt_id is not null
      or new.send_started_at is not null or new.completed_at is not null or new.external_msg_id is not null then
      raise exception 'Captured outbound operation required' using errcode='23514';
    end if;
  else
    if row(new.id,new.account_id,new.context_generation,new.captured_link_id,new.binding_version,new.binding,
           new.channel,new.kind,new.ref,new.body,new.payload,new.reply_context,new.append_thread,new.allow_template,new.allow_paused,new.created_at)
      is distinct from
       row(old.id,old.account_id,old.context_generation,old.captured_link_id,old.binding_version,old.binding,
           old.channel,old.kind,old.ref,old.body,old.payload,old.reply_context,old.append_thread,old.allow_template,old.allow_paused,old.created_at) then
      raise exception 'Outbound identity and content are immutable' using errcode='23514';
    end if;
    if old.context_generation is null and row(new.status,new.attempt_id,new.external_msg_id,new.error) is distinct from row(old.status,old.attempt_id,old.external_msg_id,old.error) then
      raise exception 'Unbound legacy delivery cannot be replayed' using errcode='23514';
    end if;
    if old.attempt_id is not null and row(new.attempt_id,new.send_started_at) is distinct from row(old.attempt_id,old.send_started_at) then
      raise exception 'Send attempt cannot be reassigned' using errcode='23514';
    end if;
    if new.status is distinct from old.status and not
      ((old.status='queued' and new.status in ('sending','cancelled')) or
       (old.status='sending' and new.status in ('sent','failed','uncertain')) or
       (old.status='uncertain' and new.status in ('sent','failed'))) then
      raise exception 'Outbound terminal state cannot be replayed' using errcode='23514';
    end if;
    if old.status in ('sent','failed','cancelled') and
      row(new.external_msg_id,new.error,new.completed_at) is distinct from row(old.external_msg_id,old.error,old.completed_at) then
      raise exception 'Final delivery evidence is immutable' using errcode='23514';
    end if;
  end if;
  if tg_op='INSERT' or (old.status='queued' and new.status='sending') then
    if new.binding->>'accountId' is distinct from new.account_id::text
      or new.binding->>'contextGeneration' is distinct from new.context_generation::text
      or new.binding->>'linkId' is distinct from new.captured_link_id::text
      or new.link_id is distinct from new.captured_link_id
      or new.binding->>'bindingVersion' is distinct from new.binding_version::text
      or new.binding->>'channel' is distinct from new.channel
      or new.body is distinct from new.payload->>'text'
      or new.allow_paused and new.kind not in ('link','system') then
      raise exception 'Outbound columns must match captured binding' using errcode='23514';
    end if;
    perform public.verify_channel_inbound_binding(new.binding,jsonb_build_object('channel',new.channel,
      'externalId',new.binding->>'externalId','scopeId',new.binding->>'scopeId'),new.allow_paused);
    if new.status='sending' and (new.attempt_id is null or new.send_started_at is null) then
      raise exception 'Claimed attempt required' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function unc_private.guard_channel_outbound() from public,anon,authenticated;
create trigger channel_outbound_immutable before insert or update on public.outbound_messages
  for each row execute function unc_private.guard_channel_outbound();

create function public.enqueue_channel_outbound(operation jsonb) returns jsonb
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
    or r - 'live' - 'inReplyTo' <> '{}'::jsonb) then
    raise exception 'Invalid reply context' using errcode='22023';
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
revoke all on function public.enqueue_channel_outbound(jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_channel_outbound(jsonb) to service_role;

create function public.claim_channel_outbound(outbound_id uuid,send_attempt uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.outbound_messages%rowtype; destination jsonb; stamp timestamptz; zone text; hhmm text; quiet jsonb; template boolean:=false;
begin
  if send_attempt is null then raise exception 'Send attempt required' using errcode='22023'; end if;
  select * into saved from public.outbound_messages where id=outbound_id;
  if not found or saved.binding is null then raise exception 'Captured outbound missing' using errcode='22023'; end if;
  -- Keep account/member/link lock order consistent with intake, then lock the outbox row.
  begin
    destination:=public.verify_channel_inbound_binding(saved.binding,jsonb_build_object('channel',saved.channel,
      'externalId',saved.binding->>'externalId','scopeId',saved.binding->>'scopeId'),saved.allow_paused);
  exception when serialization_failure or raise_exception then
    update public.outbound_messages set status='cancelled',error='original_binding_unavailable',completed_at=clock_timestamp()
      where id=outbound_id and status='queued';
    select * into saved from public.outbound_messages where id=outbound_id;
    return jsonb_build_object('claimed',false,'row',to_jsonb(saved));
  end;
  select * into saved from public.outbound_messages where id=outbound_id for update;
  stamp:=clock_timestamp();
  if saved.status='sending' and saved.send_started_at<stamp-interval '2 minutes' then
    update public.outbound_messages set status='uncertain',error='attempt_interrupted' where id=outbound_id returning * into saved;
  end if;
  if saved.status<>'queued' then return jsonb_build_object('claimed',false,'row',to_jsonb(saved)); end if;
  if saved.created_at<stamp-interval '48 hours' then
    update public.outbound_messages set status='cancelled',error='delivery_expired',completed_at=stamp where id=outbound_id returning * into saved;
    return jsonb_build_object('claimed',false,'row',to_jsonb(saved));
  end if;
  if (saved.channel='apple' and (saved.kind not in ('reply','link','system') or
      destination->'meta'->>'human_support_requested'='true' and saved.kind<>'system')) or
    (saved.kind='brief' and destination->'prefs'->>'brief'='false') or
    (saved.kind in ('approval','reminder') and destination->'prefs'->>'approvals'='false') or
    (saved.kind='draft_landed' and destination->'prefs'->>'drafts'='false') then
    update public.outbound_messages set status='cancelled',error='delivery_preference_disabled',completed_at=stamp where id=outbound_id returning * into saved;
    return jsonb_build_object('claimed',false,'row',to_jsonb(saved));
  end if;
  if saved.kind not in ('reply','link','system') then
    quiet:=destination->'prefs'->'quiet_hours';
    if quiet is not null and quiet<>'null'::jsonb then
      select coalesce(cadence->>'timezone','UTC') into zone from public.account_profiles where account_id=saved.account_id;
      hhmm:=to_char(stamp at time zone coalesce(zone,'UTC'),'HH24:MI');
      if (quiet->>'start'<quiet->>'end' and hhmm>=quiet->>'start' and hhmm<quiet->>'end') or
        (quiet->>'start'>quiet->>'end' and (hhmm>=quiet->>'start' or hhmm<quiet->>'end')) then
        return jsonb_build_object('claimed',false,'row',to_jsonb(saved));
      end if;
    end if;
  end if;
  if saved.channel='whatsapp' and (destination->>'last_inbound_at' is null or (destination->>'last_inbound_at')::timestamptz<=stamp-interval '24 hours') then
    if not saved.allow_template then return jsonb_build_object('claimed',false,'row',to_jsonb(saved)); end if;
    template:=true;
  end if;
  update public.outbound_messages set status='sending',attempt_id=send_attempt,send_started_at=stamp where id=outbound_id returning * into saved;
  -- A later source-validity trigger may cancel a superseded queued operation.
  return jsonb_build_object('claimed',saved.status='sending','row',to_jsonb(saved),'link',destination,'template',template);
end $$;
revoke all on function public.claim_channel_outbound(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_channel_outbound(uuid,uuid) to service_role;

create function public.finish_channel_outbound(outbound_id uuid,send_attempt uuid,delivery_status text,provider_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.outbound_messages%rowtype;
begin
  if delivery_status is null or delivery_status not in ('sent','uncertain') or length(coalesce(provider_id,''))>500 then
    raise exception 'Invalid provider evidence' using errcode='22023'; end if;
  select * into saved from public.outbound_messages where id=outbound_id for update;
  if not found or saved.attempt_id is distinct from send_attempt or send_attempt is null then
    raise exception 'Original send attempt required' using errcode='40001'; end if;
  if saved.status='sent' then
    if delivery_status<>'sent' or saved.external_msg_id is distinct from provider_id then raise exception 'Conflicting provider evidence' using errcode='23514'; end if;
    return to_jsonb(saved);
  end if;
  if saved.status not in ('sending','uncertain') then raise exception 'Outbound cannot be finalized' using errcode='23514'; end if;
  -- Delivery evidence belongs to the ORIGINAL context even if it was reset during I/O.
  -- Never suppress a real provider receipt because today's account/link has changed.
  update public.outbound_messages set status=delivery_status,external_msg_id=provider_id,
    error=case when delivery_status='uncertain' then 'provider_outcome_unknown' else null end,
    completed_at=case when delivery_status='sent' then clock_timestamp() else null end
    where id=outbound_id returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.finish_channel_outbound(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_channel_outbound(uuid,uuid,text,text) to service_role;

-- Project a confirmed send into the conversation only while its ORIGINAL binding is current.
-- Provider evidence remains in the outbox if a reset/reassignment makes this projection stale.
create function public.project_channel_outbound(outbound_id uuid) returns uuid
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
            || case when saved.reply_context is null then '{}'::jsonb else jsonb_build_object('live',saved.reply_context->'live','in_reply_to',saved.reply_context->>'inReplyTo') end,stamp)
        returning id into chat_id;
      update public.outbound_messages set projected_at=stamp,projection_checked_at=stamp where id=outbound_id;
      return chat_id;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'No chat position available' using errcode='23505';
end $$;
revoke all on function public.project_channel_outbound(uuid) from public,anon,authenticated;
grant execute on function public.project_channel_outbound(uuid) to service_role;

-- Bounded housekeeping never starts a provider request. Recovery facts are independent
-- of current link existence, account pause or the messaging release switch.
create function public.maintain_channel_outbound(batch_limit integer default 50) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n integer; expired integer; projected integer:=0; item record; chat_id uuid;
begin
  if batch_limit is null or batch_limit not between 1 and 100 then
    raise exception 'Invalid maintenance limit' using errcode='22023'; end if;
  with candidates as (
    select id from public.outbound_messages where context_generation is not null and status='sending'
      and send_started_at<clock_timestamp()-interval '2 minutes'
    order by send_started_at,id limit batch_limit for update skip locked
  )
  update public.outbound_messages o set status='uncertain',error='attempt_interrupted'
    from candidates c where o.id=c.id;
  get diagnostics n=row_count;
  with candidates as (
    select id from public.outbound_messages where context_generation is not null and status='queued'
      and created_at<clock_timestamp()-interval '48 hours'
    order by created_at,id limit batch_limit for update skip locked
  )
  update public.outbound_messages o set status='cancelled',error='delivery_expired',completed_at=clock_timestamp()
    from candidates c where o.id=c.id;
  get diagnostics expired=row_count;
  for item in select id from public.outbound_messages where context_generation is not null
    and status='sent' and append_thread and projected_at is null
    order by coalesce(projection_checked_at,created_at),id limit batch_limit
  loop
    chat_id:=public.project_channel_outbound(item.id);
    if chat_id is not null then projected:=projected+1; end if;
  end loop;
  return jsonb_build_object('uncertain',n,'expired',expired,'projected',projected);
end $$;
revoke all on function public.maintain_channel_outbound(integer) from public,anon,authenticated;
grant execute on function public.maintain_channel_outbound(integer) to service_role;
