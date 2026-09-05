-- Explicit operator read scopes, separate from customer membership and write authority.
-- No grants are seeded by this migration. Provisioning is an audited operator action.
create table public.ops_account_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users(id),
  reason text not null check (length(reason) between 10 and 500),
  revoked_at timestamptz,
  expires_at timestamptz,
  primary key (user_id, account_id)
);
create index ops_account_access_account_idx on public.ops_account_access(account_id);
create index ops_account_access_granter_idx on public.ops_account_access(granted_by);
alter table public.ops_account_access enable row level security;
revoke all on public.ops_account_access from public, anon, authenticated;
grant select, insert, update, delete on public.ops_account_access to service_role;

-- STABLE uses the calling statement's snapshot for both authorization and data.
-- No SECURITY DEFINER, no credential/body/snapshot payloads, no browser-supplied actor.
create function public.read_ops_console(p_user_id uuid, p_account_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not exists(select 1 from public.ops_account_access g where g.user_id=p_user_id
    and g.revoked_at is null and (g.expires_at is null or g.expires_at>statement_timestamp())
    and (p_account_id is null or g.account_id=p_account_id)) then
    raise exception 'ops_access_denied' using errcode='42501';
  end if;
  with allowed as materialized (
    select a.* from public.accounts a join public.ops_account_access g on g.account_id=a.id
    where g.user_id=p_user_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())
  ), page as (
    select * from allowed order by created_at,id limit 100
  ), clients as (
    select jsonb_build_object(
      'id',a.id,'name',a.name,'currency',a.currency,'contextGeneration',a.context_generation,
      'paused',a.automation_paused,'createdAt',a.created_at,
      'website',(select website from public.resource_profiles where account_id=a.id),
      'memberCount',(select count(*) from public.account_members where account_id=a.id),
      'connectorCount',(select count(*) from public.connectors where account_id=a.id),
      'datedReadCount',(select count(*) from public.connectors where account_id=a.id and status='connected'
        and nullif(external_ref,'') is not null and last_sync_at is not null and last_sync_result in ('ok','empty')),
      'enabledCount',(select count(*) from public.routine_states where account_id=a.id and enabled),
      'pendingDraftCount',(select count(*) from public.artifacts f join public.routine_runs r on r.id=f.run_id
        and r.account_id=f.account_id where f.account_id=a.id and r.context_generation=a.context_generation and f.status in ('draft','edited')),
      'pendingRunApprovalCount',(select count(*) from public.approvals q join public.routine_runs r on r.id=q.run_id and r.account_id=q.account_id
        where q.account_id=a.id and q.context_generation=a.context_generation and r.context_generation=a.context_generation
        and q.status='pending' and q.expires_at>statement_timestamp()),
      'runCount',(select count(*) from public.routine_runs where account_id=a.id and context_generation=a.context_generation),
      'lastRunAt',(select max(started_at) from public.routine_runs where account_id=a.id and context_generation=a.context_generation),
      'failedRunCount',(select count(*) from public.routine_runs where account_id=a.id and context_generation=a.context_generation and status='failed'),
      'verifiedChannelCount',(select count(*) from public.channel_links c join public.account_members m on m.account_id=c.account_id and m.user_id=c.user_id
        where c.account_id=a.id and c.verified_at is not null),
      'registeredWorkflowCount',(select count(*) from public.n8n_workflows where account_id=a.id and active)
    ) as value,a.created_at,a.id from page a
  ), selected as (
    select a.* from allowed a where a.id=p_account_id
  )
  select jsonb_build_object('checkedAt',statement_timestamp(),'accountLimit',100,
    'accountCount',(select count(*) from allowed),'historyLimit',100,
    'clients',coalesce((select jsonb_agg(value order by created_at,id) from clients),'[]'::jsonb),
    'selected', (select jsonb_build_object('accountId',a.id,'contextGeneration',a.context_generation,
      'connectors',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'platform',c.platform,'status',c.status,
        'externalRef',c.external_ref,'lastReadAt',c.last_sync_at,
        'lastReadResult',case when c.last_sync_result in ('ok','empty') then c.last_sync_result when c.last_sync_result is null then null else 'error' end,
        'lastReadMetrics',c.last_read_metrics) order by c.platform) from public.connectors c where c.account_id=a.id),'[]'::jsonb),
      'routines',coalesce((select jsonb_agg(jsonb_build_object('id',routine_id,'enabled',enabled,'version',version,'updatedAt',updated_at) order by routine_id)
        from public.routine_states where account_id=a.id),'[]'::jsonb),
      'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',c.channel,'verifiedAt',c.verified_at,'lastInboundAt',c.last_inbound_at) order by c.channel,c.id)
        from public.channel_links c join public.account_members m on m.account_id=c.account_id and m.user_id=c.user_id
        where c.account_id=a.id and c.verified_at is not null),'[]'::jsonb),
      'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r."startedAt" desc,r.id desc) from (
        select id,account_id as "accountId",routine_id as "routineId",version,mode,status,started_at as "startedAt",finished_at as "finishedAt"
        from public.routine_runs where account_id=a.id and context_generation=a.context_generation order by started_at desc,id desc limit 100) r),'[]'::jsonb),
      'drafts',coalesce((select jsonb_agg(to_jsonb(f) order by f."createdAt" desc,f.id desc) from (
        select f.id,f.run_id as "runId",f.routine_id as "routineId",f.title,f.status,f.revision,f.created_at as "createdAt"
        from public.artifacts f join public.routine_runs r on r.id=f.run_id and r.account_id=f.account_id
        where f.account_id=a.id and r.context_generation=a.context_generation order by f.created_at desc,f.id desc limit 100) f),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt" desc,r.id desc) from (
        select rc.id,rc.run_id as "runId",rc.kind,rc.platform,rc.description,rc.created_at as "createdAt"
        from public.receipts rc join public.routine_runs r on r.id=rc.run_id and r.account_id=rc.account_id
        where rc.account_id=a.id and rc.context_generation=a.context_generation and r.context_generation=a.context_generation
        order by rc.created_at desc,rc.id desc limit 100) r),'[]'::jsonb)
    ) from selected a),
    'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r."startedAt" desc,r.id desc) from (
      select r.id,r.account_id as "accountId",r.routine_id as "routineId",r.version,r.mode,r.status,r.started_at as "startedAt",r.finished_at as "finishedAt"
      from public.routine_runs r join allowed a on a.id=r.account_id and a.context_generation=r.context_generation
      order by r.started_at desc,r.id desc limit 100) r),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.read_ops_console(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_ops_console(uuid,uuid) to service_role;
