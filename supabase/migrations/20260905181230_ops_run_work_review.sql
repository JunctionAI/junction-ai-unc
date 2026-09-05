-- Work bodies require a separate, explicit grant. Existing metadata grants stay unchanged.
alter table public.ops_account_access
  add column work_read_granted_at timestamptz,
  add column work_read_granted_by uuid references auth.users(id),
  add column work_read_reason text,
  add constraint ops_work_grant_complete check (
    (work_read_granted_at is null and work_read_granted_by is null and work_read_reason is null)
    or (work_read_granted_at is not null and work_read_granted_by is not null
      and work_read_reason is not null and length(work_read_reason) between 10 and 500));
create index ops_work_granter_idx on public.ops_account_access(work_read_granted_by);

-- Internal access audit: identities only, never copies of the work or raw payloads.
create table public.ops_work_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.accounts(id),
  run_id uuid not null,
  context_generation bigint not null,
  read_at timestamptz not null default clock_timestamp(),
  artifact_ids uuid[] not null,
  receipt_ids uuid[] not null
);
create index ops_work_reads_actor_idx on public.ops_work_reads(user_id,read_at desc);
create index ops_work_reads_account_idx on public.ops_work_reads(account_id,read_at desc);
alter table public.ops_work_reads enable row level security;
revoke all on public.ops_work_reads from public, anon, authenticated, service_role;
grant select, insert on public.ops_work_reads to service_role;

-- A deliberately narrow projection, shared by artifacts and receipt rows.
create function public.ops_execution_summary(p jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(p)='object' then jsonb_build_object(
    'workflowId',p->>'workflowId','workflowVersion',p->>'workflowVersion',
    'executionId',p->>'executionId','revisionEvidence',p->>'revisionEvidence',
    'status',p->>'status','executedAction',p->>'executedAction',
    'verifiedAt',p->'revisionVerification'->>'verifiedAt') else null end;
$$;
revoke all on function public.ops_execution_summary(jsonb) from public, anon, authenticated;
grant execute on function public.ops_execution_summary(jsonb) to service_role;

create function public.read_ops_run_work(p_user_id uuid,p_account_id uuid,p_run_id uuid,
  p_artifact_after uuid default null,p_receipt_after uuid default null,p_generation bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  g public.ops_account_access%rowtype; a public.accounts%rowtype;
  r public.routine_runs%rowtype; result jsonb; audit_id uuid;
  artifact_time timestamptz; receipt_time timestamptz;
begin
  -- Locks serialize context/grant changes with the read. Check expiry after waiting.
  select * into g from public.ops_account_access where user_id=p_user_id and account_id=p_account_id for share;
  if not found then raise exception 'ops_work_access_denied' using errcode='42501'; end if;
  select * into a from public.accounts where id=p_account_id for share;
  if not found or g.revoked_at is not null or g.work_read_granted_at is null
    or (g.expires_at is not null and g.expires_at<=clock_timestamp()) then
    raise exception 'ops_work_access_denied' using errcode='42501';
  end if;
  if p_generation is not null and p_generation<>a.context_generation then
    raise exception 'ops_work_context_changed' using errcode='22023';
  end if;
  select * into r from public.routine_runs where id=p_run_id and account_id=a.id and context_generation=a.context_generation;
  if not found then return null; end if;
  if p_artifact_after is not null then
    select created_at into artifact_time from public.artifacts where id=p_artifact_after
      and account_id=a.id and run_id=r.id and routine_id=r.routine_id;
    if not found then raise exception 'invalid_work_cursor' using errcode='22023'; end if;
  end if;
  if p_receipt_after is not null then
    select created_at into receipt_time from public.receipts where id=p_receipt_after
      and account_id=a.id and run_id=r.id and context_generation=a.context_generation;
    if not found then raise exception 'invalid_work_cursor' using errcode='22023'; end if;
  end if;
  if (p_artifact_after is not null or p_receipt_after is not null) and p_generation is null then
    raise exception 'work_cursor_requires_context' using errcode='22023';
  end if;
  with af as materialized (
    select * from public.artifacts where account_id=a.id and run_id=r.id and routine_id=r.routine_id
      and (p_artifact_after is null or (created_at,id)>(artifact_time,p_artifact_after)) order by created_at,id limit 21
  ), ap as (select * from af order by created_at,id limit 20),
  rf as materialized (
    select * from public.receipts where account_id=a.id and run_id=r.id and context_generation=a.context_generation
      and (p_receipt_after is null or (created_at,id)>(receipt_time,p_receipt_after)) order by created_at,id limit 51
  ), rp as (select * from rf order by created_at,id limit 50)
  select jsonb_build_object('checkedAt',clock_timestamp(),'accountId',a.id,'contextGeneration',a.context_generation,
    'run',jsonb_build_object('id',r.id,'accountId',r.account_id,'routineId',r.routine_id,'version',r.version,
      'mode',r.mode,'status',r.status,'startedAt',r.started_at,'finishedAt',r.finished_at),
    'artifacts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'runId',f.run_id,
      'kind',f.kind,'title',f.title,'body',f.body,'editedBody',f.edited_body,'status',f.status,'revision',f.revision,'createdAt',f.created_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('title',v->>'title','body',v->>'body') order by ord)
        from jsonb_array_elements(case when jsonb_typeof(f.items)='array' then f.items else '[]' end) with ordinality as item(v,ord)
        where jsonb_typeof(v)='object'),'[]'),
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('source',v->>'source','ref',v->>'ref') order by ord)
        from jsonb_array_elements(case when jsonb_typeof(f.evidence)='array' then f.evidence else '[]' end) with ordinality as ev(v,ord)
        where jsonb_typeof(v)='object'),'[]'),
      'execution',case when f.meta->'executionReceipt'->>'accountId'=a.id::text
        and f.meta->'executionReceipt'->>'runId'=r.id::text and f.meta->'executionReceipt'->>'routineId'=r.routine_id
        then public.ops_execution_summary(f.meta->'executionReceipt') else null end
      ) order by f.created_at,f.id) from ap f),'[]'),
    'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'runId',rc.run_id,'kind',rc.kind,
      'platform',rc.platform,'description',rc.description,'createdAt',rc.created_at,
      'execution',case when rc.payload->'externalExecution'->>'accountId'=a.id::text
        and rc.payload->'externalExecution'->>'runId'=r.id::text and rc.payload->'externalExecution'->>'routineId'=r.routine_id
        then public.ops_execution_summary(rc.payload->'externalExecution') else null end
      ) order by rc.created_at,rc.id) from rp rc),'[]'),
    'artifactAfter',coalesce((select id from ap order by created_at desc,id desc limit 1),p_artifact_after),
    'receiptAfter',coalesce((select id from rp order by created_at desc,id desc limit 1),p_receipt_after),
    'hasMore',(select count(*)>20 from af) or (select count(*)>50 from rf)
  ) into result;
  insert into public.ops_work_reads(user_id,account_id,run_id,context_generation,artifact_ids,receipt_ids)
    values(p_user_id,a.id,r.id,a.context_generation,
      array(select (v->>'id')::uuid from jsonb_array_elements(result->'artifacts') v),
      array(select (v->>'id')::uuid from jsonb_array_elements(result->'receipts') v)) returning id into audit_id;
  return result || jsonb_build_object('auditId',audit_id);
end;
$$;
revoke all on function public.read_ops_run_work(uuid,uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_ops_run_work(uuid,uuid,uuid,uuid,uuid,bigint) to service_role;
