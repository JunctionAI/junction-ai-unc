-- Service-only, atomic completion for the existing dataset sync path. No schedules,
-- account flags, existing rows, table policies, or credential grants are changed.
create function public.commit_dataset_sync(p_snapshot jsonb, p_holder uuid, p_context_generation bigint)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  snapshot public.account_dataset_snapshots%rowtype;
  lease_expiry timestamptz;
  lease_owner uuid;
  lease_key_value text;
  stored_time timestamptz;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' or p_holder is null
    or p_context_generation is null or p_context_generation < 0 then
    raise exception 'invalid dataset completion';
  end if;
  snapshot := jsonb_populate_record(null::public.account_dataset_snapshots, p_snapshot);
  if snapshot.id is null or snapshot.account_id is null or snapshot.connector_id is null
    or snapshot.platform is distinct from 'meta_ads' or coalesce(snapshot.external_ref,'') = ''
    or coalesce(snapshot.query_hash,'') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(snapshot.query) is distinct from 'object'
    or jsonb_typeof(snapshot.result) is distinct from 'object'
    or jsonb_typeof(snapshot.result->'rows') is distinct from 'array'
    or jsonb_typeof(snapshot.result->'metrics') is distinct from 'object'
    or coalesce(snapshot.result->>'provenance','') not in ('ok','empty')
    or snapshot.source_fetched_at is null
    or (snapshot.result->>'fetchedAt')::timestamptz is distinct from snapshot.source_fetched_at then
    raise exception 'invalid dataset completion';
  end if;
  if snapshot.query->>'resource' in ('adsets','campaigns') and
    snapshot.result #>> '{metrics,budget_metric_contract}' is distinct from 'unc.meta-budget.v2' then
    raise exception 'dataset budget normalization contract is not current';
  end if;

  -- Lock mutable authority before accepting the observation. FOR SHARE also blocks
  -- non-key changes (pause, generation, connection status and external asset).
  perform 1 from public.accounts where id=snapshot.account_id
    and context_generation=p_context_generation and not automation_paused for share;
  if not found then return null; end if;
  perform 1 from public.connectors where id=snapshot.connector_id and account_id=snapshot.account_id
    and platform=snapshot.platform and external_ref=snapshot.external_ref and status='connected' for share;
  if not found then return null; end if;

  lease_key_value := 'dataset:'||snapshot.account_id::text||':'||snapshot.connector_id::text||':'||snapshot.query_hash;
  select holder,expires_at into lease_owner,lease_expiry from public.backend_leases
    where lease_key=lease_key_value for update;
  -- Check wall time AFTER acquiring every potentially blocking lock. Transaction
  -- start time and a predicate evaluated before a lock wait are not a valid fence.
  stored_time := clock_timestamp();
  if not found or lease_owner is distinct from p_holder or lease_expiry <= stored_time then return null; end if;
  if snapshot.source_fetched_at < stored_time - interval '1 hour'
    or snapshot.source_fetched_at > stored_time + interval '30 seconds'
    or (snapshot.source_fetched_at at time zone 'UTC')::date <> (stored_time at time zone 'UTC')::date then
    raise exception 'dataset source timestamp is stale or reporting day changed';
  end if;

  insert into public.account_dataset_snapshots(id,account_id,connector_id,external_ref,platform,query_hash,
    query,result,source_fetched_at,stored_at)
    values(snapshot.id,snapshot.account_id,snapshot.connector_id,snapshot.external_ref,snapshot.platform,
      snapshot.query_hash,snapshot.query,snapshot.result,snapshot.source_fetched_at,stored_time);
  -- Consume exactly this lease in the same transaction. A replay cannot insert a
  -- second snapshot; an old holder cannot release a successor's lease.
  delete from public.backend_leases where lease_key=lease_key_value and holder=p_holder;
  return stored_time;
end $$;
revoke all on function public.commit_dataset_sync(jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.commit_dataset_sync(jsonb,uuid,bigint) to service_role;
