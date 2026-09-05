-- Staged after command delivery. No messaging activation.
alter table public.artifacts add column revision bigint not null default 0 check (revision >= 0);
create function unc_private.guard_artifact_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.revision<>0 then raise exception 'Initial artifact revision must be zero' using errcode='23514'; end if;
  else
    if new.revision<>old.revision then raise exception 'Artifact revision is database owned' using errcode='23514'; end if;
    if to_jsonb(new)-'revision' is distinct from to_jsonb(old)-'revision' then new.revision:=old.revision+1; end if;
  end if;
  return new;
end $$;
revoke all on function unc_private.guard_artifact_revision() from public,anon,authenticated,service_role;
create trigger artifact_revision before insert or update on public.artifacts for each row execute function unc_private.guard_artifact_revision();
-- Decisions go through owner/context/revision checks plus an atomic receipt.
revoke update(status,edited_body),update(revision) on public.artifacts from public,anon,authenticated;

create function public.list_context_artifacts(acct uuid,generation bigint,requested_run uuid default null,
  requested_routine text default null,requested_status text default null,max_rows integer default 12)
returns setof public.artifacts language sql stable security invoker set search_path='' as $$
  select f.* from public.artifacts f join public.routine_runs r on r.id=f.run_id and r.account_id=f.account_id
    join public.accounts a on a.id=f.account_id and a.context_generation=r.context_generation
  where f.account_id=acct and r.context_generation=generation
    and (requested_run is null or f.run_id=requested_run)
    and (requested_routine is null or f.routine_id=requested_routine)
    and (requested_status is null or f.status=requested_status)
  order by f.created_at desc,f.id desc limit least(greatest(coalesce(max_rows,12),0),100);
$$;
revoke all on function public.list_context_artifacts(uuid,bigint,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.list_context_artifacts(uuid,bigint,uuid,text,text,integer) to service_role;

create function public.decide_context_artifact(acct uuid,generation bigint,actor uuid,artifact_id uuid,
  expected_revision bigint,decision text,reason text default null,edited_body text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.artifacts%rowtype; updated public.artifacts%rowtype; evidence public.receipts%rowtype;
  current_generation bigint; paused boolean; owner_role text; next_status text; taste text; description text;
begin
  select context_generation,automation_paused into current_generation,paused from public.accounts where id=acct for share;
  if not found or current_generation is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  if paused then raise exception 'Automation paused' using errcode='55000'; end if;
  select role into owner_role from public.account_members where account_id=acct and user_id=actor for share;
  if owner_role is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
  select af.* into f from public.artifacts af join public.routine_runs r on r.id=af.run_id and r.account_id=af.account_id
    where af.id=artifact_id and af.account_id=acct and r.context_generation=generation for update of af;
  if not found then raise exception 'Artifact not found in current context' using errcode='P0002'; end if;
  if f.revision is distinct from expected_revision then raise exception 'Artifact changed; reload before deciding' using errcode='40001'; end if;
  next_status:=case decision when 'approve' then 'approved' when 'hold' then 'held' when 'edit' then 'edited' when 'use' then 'used' when 'why' then f.status end;
  if next_status is null or decision='edit' and length(btrim(coalesce(edited_body,''))) not between 1 and 12000
    or length(coalesce(reason,''))>600 then raise exception 'Invalid artifact decision' using errcode='22023'; end if;
  updated:=f;
  if decision<>'why' then
    update public.artifacts set status=next_status,edited_body=case when decision='edit' then btrim(decide_context_artifact.edited_body) else f.edited_body end
      where id=f.id returning * into updated;
  end if;
  taste:=case decision when 'approve' then 'approved' when 'hold' then 'held' when 'edit' then 'edited' when 'why' then 'why_opened' end;
  if taste is not null then
    insert into public.taste_events(account_id,routine_id,action,context) values(acct,f.routine_id,taste,
      jsonb_build_object('artifactId',f.id,'runId',f.run_id,'contextGeneration',generation,'kind',f.kind,'title',f.title,'reason',reason,'decidedBy',actor));
  end if;
  description:=case decision when 'approve' then 'Approved draft: '||f.title||'.'
    when 'hold' then 'Held draft: '||f.title||' — nothing was sent or published.'
    when 'edit' then 'Edited draft: '||f.title||'; the original was retained.'
    when 'use' then 'Marked draft as used: '||f.title||'.' else 'Opened the evidence for draft: '||f.title||'.' end;
  insert into public.receipts(account_id,run_id,kind,description,payload) values(acct,f.run_id,'notification',description,
    jsonb_build_object('artifactDecision',true,'artifactId',f.id,'action',decision,'fromStatus',f.status,'toStatus',updated.status,
      'fromRevision',f.revision,'toRevision',updated.revision,'reason',reason,'decidedBy',actor)) returning * into evidence;
  return jsonb_build_object('artifact',to_jsonb(updated),'receipt',to_jsonb(evidence));
end $$;
revoke all on function public.decide_context_artifact(uuid,bigint,uuid,uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.decide_context_artifact(uuid,bigint,uuid,uuid,bigint,text,text,text) to service_role;

-- One founder-requested copy per artifact revision and channel. A retry looks up
-- this original destination set, even after a connection is replaced or removed.
create table public.artifact_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  context_generation bigint not null check (context_generation>=0),
  user_id uuid not null,
  artifact_id uuid not null,
  artifact_revision bigint not null check (artifact_revision>=0),
  channel text not null check (channel in ('telegram','whatsapp','slack','sms','email','apple')),
  payload jsonb not null,
  outbound_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique(account_id,context_generation,user_id,artifact_id,artifact_revision,channel)
);
alter table public.artifact_deliveries enable row level security;
revoke all on public.artifact_deliveries from public,anon,authenticated;
grant select,insert,delete on public.artifact_deliveries to service_role;
create function unc_private.guard_artifact_delivery_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Accepted artifact delivery is immutable' using errcode='23514'; end $$;
revoke all on function unc_private.guard_artifact_delivery_immutable() from public,anon,authenticated,service_role;
create trigger artifact_delivery_immutable before update on public.artifact_deliveries for each row execute function unc_private.guard_artifact_delivery_immutable();

create function public.prepare_artifact_delivery(acct uuid,generation bigint,actor uuid,artifact_id uuid,
  expected_revision bigint,requested_channel text,message_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_generation bigint; paused boolean; owner_role text; f public.artifacts%rowtype;
  saved public.artifact_deliveries%rowtype; lid public.channel_links%rowtype; b jsonb; outbound jsonb;
  request_id uuid:=gen_random_uuid(); ids uuid[]:='{}'; result jsonb;
begin
  select context_generation,automation_paused into current_generation,paused from public.accounts where id=acct for share;
  if not found or current_generation is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  select role into owner_role from public.account_members where account_id=acct and user_id=actor for share;
  if owner_role is distinct from 'owner' then raise exception 'Owner required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','artifact',acct,generation,actor,artifact_id,expected_revision,requested_channel),0));
  select d.* into saved from public.artifact_deliveries d where d.account_id=acct and d.context_generation=generation and d.user_id=actor
    and d.artifact_id=prepare_artifact_delivery.artifact_id and d.artifact_revision=expected_revision and d.channel=requested_channel;
  if not found then
    if paused then raise exception 'Automation paused' using errcode='55000'; end if;
    if expected_revision is null or length(coalesce(message_text,'')) not between 1 and 3800 then raise exception 'Invalid artifact delivery' using errcode='22023'; end if;
    select af.* into f from public.artifacts af join public.routine_runs r on r.id=af.run_id and r.account_id=af.account_id
      where af.id=artifact_id and af.account_id=acct and r.context_generation=generation for share of af;
    if not found then raise exception 'Artifact not found in current context' using errcode='P0002'; end if;
    if f.revision is distinct from expected_revision or f.status='held' then raise exception 'Artifact changed or held' using errcode='40001'; end if;
    for lid in select l.* from public.channel_links l where l.account_id=acct and l.user_id=actor and l.channel=requested_channel
      and l.external_id is not null and l.verified_at is not null order by l.id for share loop
      b:=jsonb_build_object('version',1,'kind','linked','accountId',acct,'contextGeneration',generation,'userId',actor,
        'linkId',lid.id,'bindingVersion',lid.binding_version,'channel',lid.channel,'externalId',lid.external_id);
      if lid.channel='slack' then b:=b||jsonb_build_object('scopeId',lid.meta->>'team_id'); end if;
      outbound:=public.enqueue_channel_outbound(jsonb_build_object('binding',b,'kind','draft_landed','ref','artifact:'||request_id::text,
        'payload',jsonb_build_object('text',message_text),'appendThread',true));
      ids:=array_append(ids,(outbound->>'id')::uuid);
    end loop;
    if cardinality(ids)=0 then raise exception 'No verified channel for this owner' using errcode='P0002'; end if;
    insert into public.artifact_deliveries(id,account_id,context_generation,user_id,artifact_id,artifact_revision,channel,payload,outbound_ids)
      values(request_id,acct,generation,actor,artifact_id,expected_revision,requested_channel,jsonb_build_object('text',message_text),ids) returning * into saved;
  end if;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into result from public.outbound_messages o where o.id=any(saved.outbound_ids);
  if jsonb_array_length(result)<>cardinality(saved.outbound_ids) then raise exception 'Original delivery evidence missing' using errcode='55000'; end if;
  return jsonb_build_object('id',saved.id,'operations',result);
end $$;
revoke all on function public.prepare_artifact_delivery(uuid,bigint,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.prepare_artifact_delivery(uuid,bigint,uuid,uuid,bigint,text,text) to service_role;

create function unc_private.guard_artifact_outbound_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.status<>'queued' or new.status<>'sending' or left(new.ref,9)<>'artifact:' then return new; end if;
  perform 1 from public.artifact_deliveries d join public.artifacts f on f.id=d.artifact_id and f.account_id=d.account_id
    join public.routine_runs r on r.id=f.run_id and r.account_id=f.account_id and r.context_generation=d.context_generation
    join public.account_members m on m.account_id=d.account_id and m.user_id=d.user_id and m.role='owner'
    where new.ref='artifact:'||d.id::text and new.id=any(d.outbound_ids) and new.payload=d.payload
      and new.account_id=d.account_id and new.context_generation=d.context_generation
      and new.binding->>'userId'=d.user_id::text and new.channel=d.channel and new.kind='draft_landed'
      and f.revision=d.artifact_revision and f.status<>'held' for share of f,m;
  if not found then
    new.status:='cancelled';new.attempt_id:=null;new.send_started_at:=null;
    new.error:='artifact_source_unavailable';new.completed_at:=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function unc_private.guard_artifact_outbound_source() from public,anon,authenticated,service_role;
create trigger channel_outbound_source_artifact before update on public.outbound_messages for each row execute function unc_private.guard_artifact_outbound_source();
