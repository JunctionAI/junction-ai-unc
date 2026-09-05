-- Same atomic projection for normal keyword success and interrupted-run recovery.
-- No provider, model, channel or mutation executor is reachable from this RPC.
create table public.n8n_shadow_completions (
  permit_id uuid primary key references public.n8n_shadow_permits(id) on delete cascade,
  account_id uuid not null,
  context_generation bigint not null,
  run_id uuid not null unique,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.n8n_shadow_completions enable row level security;
revoke all on public.n8n_shadow_completions from public,anon,authenticated,service_role;
grant select,insert on public.n8n_shadow_completions to service_role;
create function unc_private.guard_keyword_shadow_completion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Keyword completion is immutable' using errcode='23514'; end if;
  if not exists(select 1 from public.n8n_shadow_permits p join public.routine_runs r on r.id=p.run_id
    where p.id=new.permit_id and p.status='verified' and r.status='done'
      and p.account_id=new.account_id and p.context_generation=new.context_generation and p.run_id=new.run_id
      and r.account_id=new.account_id and r.context_generation=new.context_generation
      and new.result->>'runId'=r.id::text and new.result->>'status'='done' and new.result->>'mode'='dry_run'
      and exists(select 1 from public.artifacts a where a.id=(new.result #>> '{artifact,id}')::uuid and a.run_id=r.id and a.account_id=r.account_id)) then
    raise exception 'Completed keyword projection required' using errcode='23514'; end if;
  new.created_at:=clock_timestamp(); return new;
end $$;
revoke all on function unc_private.guard_keyword_shadow_completion() from public,anon,authenticated,service_role;
create trigger keyword_shadow_completion before insert or update on public.n8n_shadow_completions
  for each row execute function unc_private.guard_keyword_shadow_completion();

create function public.commit_keyword_shadow_completion(acct uuid,generation bigint,requested_run uuid,packet jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.n8n_shadow_permits%rowtype; r public.routine_runs%rowtype; prior public.n8n_shadow_completions%rowtype;
  active_generation bigint; paused boolean; owner_role text; bundle jsonb; art jsonb; external_receipt jsonb;
  snap jsonb; spec jsonb; ctx jsonb; producer jsonb; next_index integer; tail_count integer; item jsonb; pos integer;
  completed_at timestamptz; expected_node text; receipt_ids uuid[]:='{}';
begin
  select context_generation,automation_paused into active_generation,paused from public.accounts where id=acct for share;
  if not found or active_generation is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  if paused then raise exception 'Automation paused' using errcode='55000'; end if;
  select * into p from public.n8n_shadow_permits where run_id=requested_run and account_id=acct and context_generation=generation for update;
  if not found then raise exception 'Original keyword permit unavailable' using errcode='P0002'; end if;
  select role into owner_role from public.account_members where account_id=acct and user_id=p.authorized_by for share;
  if owner_role is distinct from 'owner' then raise exception 'Original owner authority changed' using errcode='42501'; end if;
  select * into r from public.routine_runs where id=requested_run and account_id=acct and context_generation=generation for update;
  if not found then raise exception 'Original keyword run unavailable' using errcode='P0002'; end if;
  select * into prior from public.n8n_shadow_completions where permit_id=p.id;
  if found then
    if r.status<>'done' or not exists(select 1 from public.artifacts a where a.id=(prior.result #>> '{artifact,id}')::uuid and a.run_id=r.id and a.account_id=acct)
      or exists(select 1 from jsonb_array_elements(prior.result->'receipts') e where not exists(
        select 1 from public.receipts x where x.id=(e->>'id')::uuid and x.run_id=r.id and x.account_id=acct and x.context_generation=generation)) then
      raise exception 'Prior keyword completion records are unavailable; do not recreate them' using errcode='P0002'; end if;
    return prior.result;
  end if;
  if packet is null then return null; end if;
  snap:=packet->'snapshot'; spec:=snap->'spec'; ctx:=snap->'ctx'; bundle:=packet->'result'; art:=bundle->'artifact';
  external_receipt:=p.result #> '{artifact,meta,executionReceipt}';
  if p.status<>'verified' or p.result->>'kind' is distinct from 'artifact' or r.status not in ('running','failed')
    or r.mode<>'dry_run' or r.routine_id<>'D03-W01' or r.spec_hash is distinct from p.spec_hash
    or snap is distinct from r.snapshot or snap->>'awaiting' is distinct from 'keyword_shadow' or spec is distinct from p.spec
    or spec->>'id' is distinct from r.routine_id or spec->>'version' is distinct from r.version::text
    or ctx->>'runId' is distinct from r.id::text or ctx->>'routineId' is distinct from r.routine_id
    or ctx->>'version' is distinct from r.version::text or ctx->>'mode' is distinct from 'dry_run'
    or (ctx->>'startedAt')::timestamptz is distinct from r.started_at
    or ctx #>> '{account,accountId}' is distinct from acct::text or ctx #>> '{account,contextGeneration}' is distinct from generation::text
    or ctx->'artifact' is not null or ctx->'execution' is not null or ctx->'approval' is not null
    or bundle->>'runId' is distinct from r.id::text or bundle->>'routineId' is distinct from r.routine_id
    or bundle->>'version' is distinct from r.version::text or bundle->>'status' is distinct from 'done'
    or bundle->>'mode' is distinct from 'dry_run' or bundle->'approval' is not null or bundle->'needs' is not null or bundle->'error' is not null
    or length(coalesce(bundle->>'summary','')) not between 1 and 4000 or octet_length(packet::text)>1000000
    or external_receipt->>'revisionEvidence' is distinct from 'verified_execution_record'
    or external_receipt->>'accountId' is distinct from acct::text or external_receipt->>'runId' is distinct from r.id::text
    or external_receipt->>'routineId' is distinct from 'D03-W01' or external_receipt->>'mode' is distinct from 'dry_run'
    or external_receipt->>'executedAction' is distinct from 'none' or external_receipt->>'executionId' is distinct from p.execution_id
    or external_receipt->>'workflowId' is distinct from p.contract->>'workflowId'
    or external_receipt->>'workflowVersion' is distinct from p.contract->>'workflowVersion'
    or external_receipt #>> '{revisionVerification,requestDigest}' is distinct from p.request_digest then
    raise exception 'Original verified keyword continuation required' using errcode='23514'; end if;
  next_index:=(snap->>'nextNodeIndex')::integer;
  if next_index is null or next_index<1 or jsonb_typeof(spec->'nodes') is distinct from 'array' then
    raise exception 'Invalid keyword continuation index' using errcode='23514'; end if;
  producer:=spec->'nodes'->(next_index-1); tail_count:=jsonb_array_length(spec->'nodes')-next_index;
  if producer->>'kind' is distinct from 'n8n' or producer->'shadowContract' is distinct from p.contract
    or tail_count not between 1 and 10 or spec->'nodes'->-1->>'kind' is distinct from 'receipt'
    or (select count(*) from jsonb_array_elements(spec->'nodes') n where n->>'kind' in ('produce','n8n'))<>1
    or exists(select 1 from jsonb_array_elements(spec->'nodes') n where n->>'kind'='execute')
    or exists(select 1 from jsonb_array_elements(spec->'nodes') with ordinality n(value,ord)
      where ord>next_index and ord<jsonb_array_length(spec->'nodes') and value->>'kind' is distinct from 'gate') then
    raise exception 'Only original draft review and receipt continuation is allowed' using errcode='23514'; end if;
  if art->>'accountId' is distinct from acct::text or art->>'runId' is distinct from r.id::text
    or art->>'routineId' is distinct from r.routine_id or art->>'status' is distinct from 'draft'
    or art #>> '{meta,via}' is distinct from 'n8n' or art #>> '{meta,node}' is distinct from producer->>'id'
    or art #>> '{meta,mode}' is distinct from 'dry_run'
    or ((art-array['id','accountId','runId','routineId','status','createdAt'])||jsonb_build_object('meta',(art->'meta')-array['via','node','mode']))
      is distinct from p.result->'artifact'
    or jsonb_typeof(bundle->'receipts') is distinct from 'array' or jsonb_array_length(bundle->'receipts')<>tail_count+1 then
    raise exception 'Keyword artifact differs from the verified result' using errcode='23514'; end if;
  completed_at:=(art->>'createdAt')::timestamptz;
  if completed_at is null or completed_at<clock_timestamp()-interval '10 minutes' or completed_at>clock_timestamp()+interval '30 seconds' then
    raise exception 'Keyword completion plan expired' using errcode='23514'; end if;
  for item,pos in select value,ordinality::integer from jsonb_array_elements(bundle->'receipts') with ordinality loop
    expected_node:=case when pos=1 then producer->>'id' else spec->'nodes'->(next_index+pos-2)->>'id' end;
    if item->>'accountId' is distinct from acct::text or item->>'runId' is distinct from r.id::text or item->>'kind' is distinct from 'draft'
      or item->'spend' is not null or item->'approvalId' is not null or item->'platform' is not null
      or (item->>'createdAt')::timestamptz is distinct from completed_at or length(coalesce(item->>'description','')) not between 1 and 8000
      or item #>> '{payload,node}' is distinct from expected_node
      or (pos=1 and (item #>> '{payload,artifactId}' is distinct from art->>'id' or item #> '{payload,externalExecution}' is distinct from external_receipt))
      or (pos=tail_count+1 and (item #>> '{payload,artifactId}' is distinct from art->>'id' or item #>> '{payload,executed}' is distinct from 'false')) then
      raise exception 'Invalid keyword completion receipt' using errcode='23514'; end if;
    receipt_ids:=array_append(receipt_ids,(item->>'id')::uuid);
  end loop;
  if exists(select 1 from public.artifacts a where a.run_id=r.id) then
    raise exception 'Original run already has an artifact; reconcile it without duplication' using errcode='23514'; end if;
  insert into public.artifacts(id,account_id,run_id,routine_id,kind,title,body,items,meta,evidence,status,created_at)
    values((art->>'id')::uuid,acct,r.id,r.routine_id,art->>'kind',art->>'title',art->>'body',art->'items',art->'meta',art->'evidence','draft',completed_at);
  for item in select value from jsonb_array_elements(bundle->'receipts') loop
    insert into public.receipts(id,account_id,context_generation,run_id,kind,description,payload,created_at)
      values((item->>'id')::uuid,acct,generation,r.id,'draft',item->>'description',item->'payload',completed_at);
  end loop;
  update public.routine_runs set status='done',summary=bundle->>'summary',finished_at=completed_at,snapshot=null where id=r.id;
  insert into public.n8n_shadow_completions(permit_id,account_id,context_generation,run_id,result) values(p.id,acct,generation,r.id,bundle);
  return bundle;
end $$;
revoke all on function public.commit_keyword_shadow_completion(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_keyword_shadow_completion(uuid,bigint,uuid,jsonb) to service_role;
