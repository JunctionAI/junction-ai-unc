-- Staged after channel identity/control/chat/outbox migrations. No live activation.
alter table public.routine_commands
  add column channel_binding jsonb,
  add column notification_revision bigint not null default 0 check (notification_revision >= 0),
  add column notification_checked_at timestamptz;

-- Retain the full original command identity separately from the nullable live-link FK.
-- A deleted connection may clear only that FK, even on archived/paused commands.
drop trigger account_automation_pause on public.routine_commands;
create trigger account_automation_pause_delete before delete on public.routine_commands
  for each row execute function unc_private.guard_automation_pause();
create or replace function unc_private.guard_command_context() returns trigger
language plpgsql security invoker set search_path='' as $$
declare generation bigint; paused boolean; parent public.routine_runs%rowtype;
begin
  if coalesce(current_setting('role',true),'none') in ('anon','authenticated') then
    raise exception 'Commands require server authority' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.link_id is not null and new.link_id is null and old.channel_binding is not null
    and to_jsonb(new)-'link_id'=to_jsonb(old)-'link_id' then return new; end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id or new.account_id is distinct from old.account_id or
    new.context_generation is distinct from old.context_generation or new.user_id is distinct from old.user_id or
    new.channel is distinct from old.channel or new.link_id is distinct from old.link_id or
    new.request_id is distinct from old.request_id or new.request_hash is distinct from old.request_hash or
    new.request is distinct from old.request or new.routine_id is distinct from old.routine_id or
    new.version is distinct from old.version or new.spec_hash is distinct from old.spec_hash or
    new.workflow_hash is distinct from old.workflow_hash or new.created_at is distinct from old.created_at or
    (old.run_id is not null and new.run_id is distinct from old.run_id)
  ) then raise exception 'Captured command identity is immutable' using errcode='23514'; end if;
  if new.run_id is not null and new.run_id<>new.id then
    raise exception 'Command run identity must match its claim' using errcode='23514'; end if;
  select a.context_generation,a.automation_paused into generation,paused from public.accounts a where a.id=new.account_id for share;
  if not found then raise exception 'Command account unavailable' using errcode='23503'; end if;
  if new.context_generation is distinct from generation then raise exception 'Captured command context is stale' using errcode='40001'; end if;
  if paused then raise exception 'Account automation is paused for verified setup' using errcode='55000'; end if;
  select * into parent from public.routine_runs r where r.id=new.id;
  if found and (parent.account_id<>new.account_id or parent.context_generation<>new.context_generation or
    parent.routine_id<>new.routine_id or parent.version<>new.version or parent.mode<>'dry_run') then
    raise exception 'Command and run context mismatch' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function unc_private.guard_command_context() from public,anon,authenticated,service_role;

create function unc_private.guard_command_delivery_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare b jsonb:=new.channel_binding; owner_role text;
begin
  if tg_op='UPDATE' then
    if new.channel_binding is distinct from old.channel_binding or new.notification_revision is distinct from old.notification_revision then
      raise exception 'Command delivery identity/revision is server owned' using errcode='23514'; end if;
    if row(new.status,new.reply) is distinct from row(old.status,old.reply) then
      new.notification_revision:=old.notification_revision+1;
      new.notification_checked_at:=null;
      new.notification_status:='pending';
    end if;
  elsif new.notification_revision<>0 then
    raise exception 'Initial notification revision must be zero' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    if new.channel='app' then
      if b is not null or new.link_id is not null then raise exception 'App command cannot carry channel identity' using errcode='23514'; end if;
    else
      if jsonb_typeof(b) is distinct from 'object' or b->>'kind' is distinct from 'linked'
        or b->>'accountId' is distinct from new.account_id::text or b->>'contextGeneration' is distinct from new.context_generation::text
        or b->>'userId' is distinct from new.user_id::text or b->>'linkId' is distinct from new.link_id::text
        or b->>'channel' is distinct from new.channel then
        raise exception 'Captured command destination required' using errcode='23514'; end if;
      select role into owner_role from public.account_members where account_id=new.account_id and user_id=new.user_id for share;
      if owner_role is distinct from 'owner' then raise exception 'Command owner required' using errcode='42501'; end if;
      perform public.verify_channel_inbound_binding(b,jsonb_build_object('channel',new.channel,'externalId',b->>'externalId','scopeId',b->>'scopeId'),false);
    end if;
  end if;
  return new;
end $$;
revoke all on function unc_private.guard_command_delivery_identity() from public,anon,authenticated,service_role;
create trigger command_delivery_identity before insert or update on public.routine_commands
  for each row execute function unc_private.guard_command_delivery_identity();

-- Source validity is checked at the atomic send claim, not just when enqueueing a
-- notification. Superseded replies/ownership cannot drain later from WhatsApp's queue.
create function unc_private.guard_command_outbound_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source_id uuid; source_revision bigint; source_row public.routine_commands%rowtype;
begin
  if old.status<>'queued' or new.status<>'sending' or left(new.ref,8)<>'command:' then return new; end if;
  begin
    source_id:=split_part(new.ref,':',2)::uuid;
    source_revision:=split_part(new.ref,':',3)::bigint;
  exception when invalid_text_representation then source_id:=null; end;
  select c.* into source_row from public.routine_commands c
    join public.account_members m on m.account_id=c.account_id and m.user_id=c.user_id and m.role='owner'
    where c.id=source_id and c.notification_revision=source_revision
      and c.account_id=new.account_id and c.context_generation=new.context_generation and c.channel_binding=new.binding
      and c.status in ('waiting','done','blocked','failed','uncertain')
      and new.ref='command:'||c.id::text||':'||c.notification_revision::text
      and new.body=c.reply||' Request '||left(c.id::text,8)||'.'
    for share of c,m;
  if not found then
    new.status:='cancelled'; new.attempt_id:=null; new.send_started_at:=null;
    new.error:='command_result_superseded'; new.completed_at:=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function unc_private.guard_command_outbound_source() from public,anon,authenticated,service_role;
create trigger channel_outbound_source before update on public.outbound_messages
  for each row execute function unc_private.guard_command_outbound_source();

create function public.prepare_command_notification(command_id uuid,expected_revision bigint) returns jsonb
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
    'payload',jsonb_build_object('text',c.reply||' Request '||left(c.id::text,8)||'.'),'appendThread',true));
  return jsonb_build_object('operation',outbound,'link',destination);
end $$;
revoke all on function public.prepare_command_notification(uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_command_notification(uuid,bigint) to service_role;

-- The outbox, not notification_status, owns delivery truth for captured commands.
-- A queued attempt is eligible for resumption; sending/sent/uncertain/terminal are not.
create or replace function public.list_current_routine_commands(command_status text,max_rows integer,pending_notifications boolean default false)
returns setof public.routine_commands language sql stable security invoker set search_path='' as $$
  select c.* from public.routine_commands c join public.accounts a on a.id=c.account_id
  where not a.automation_paused and a.context_generation=c.context_generation
    and ((not pending_notifications and c.status=command_status) or
      (pending_notifications and c.channel_binding is not null and c.status in ('done','blocked','failed','uncertain','waiting')
        and exists(select 1 from public.channel_links l join public.account_members m on m.account_id=l.account_id and m.user_id=l.user_id
          where l.id::text=c.channel_binding->>'linkId' and l.account_id=c.account_id and l.user_id=c.user_id and m.role='owner'
            and l.binding_version::text=c.channel_binding->>'bindingVersion' and l.external_id=c.channel_binding->>'externalId'
            and l.channel=c.channel and l.verified_at is not null
            and (l.channel<>'slack' or l.meta->>'team_id'=c.channel_binding->>'scopeId'))
        and not exists(select 1 from public.outbound_messages o where o.account_id=c.account_id and o.context_generation=c.context_generation
          and o.ref='command:'||c.id::text||':'||c.notification_revision::text and o.status<>'queued')))
  order by case when pending_notifications then coalesce(c.notification_checked_at,c.updated_at)
    when command_status='queued' then c.created_at else c.updated_at end,c.id
  limit least(greatest(coalesce(max_rows,0),0),100);
$$;
revoke all on function public.list_current_routine_commands(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.list_current_routine_commands(text,integer,boolean) to service_role;
