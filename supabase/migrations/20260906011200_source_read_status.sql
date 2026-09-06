-- Expose only whether this operator has the separate source-read gate, never its reason or grant actor.
create or replace function public.read_ops_account_source_bindings(p_user_id uuid,p_account_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_account_id is not null and not exists(select 1 from public.ops_account_access g
    where g.user_id=p_user_id and g.account_id=p_account_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())) then
    raise exception 'ops_access_denied' using errcode='42501';
  end if;
  if p_account_id is null and not exists(select 1 from public.ops_account_access g
    where g.user_id=p_user_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())) then
    raise exception 'ops_access_denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'accountId',b.account_id,
    'sourceSystem',b.source_system,'sourceProject',b.source_project,'sourceKind',b.source_kind,
    'sourceKey',b.source_key,'displayName',b.display_name,'status',b.status,
    'evidenceRef',b.evidence_ref,'revision',b.revision,'verifiedAt',b.verified_at,
    'verifiedBy',b.verified_by,'sourceReadAuthorized',g.source_read_granted_at is not null)
    order by b.account_id,b.source_system,b.source_project,b.source_kind,b.source_key),'[]'::jsonb)
    into result from public.account_source_bindings b join public.ops_account_access g on g.account_id=b.account_id
    where g.user_id=p_user_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())
      and (p_account_id is null or b.account_id=p_account_id);
  return result;
end;
$$;
revoke all on function public.read_ops_account_source_bindings(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_ops_account_source_bindings(uuid,uuid) to service_role;
