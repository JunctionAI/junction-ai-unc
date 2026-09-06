-- Separate authority for fresh reads from a bound external client data source.
alter table public.ops_account_access
  add column source_read_granted_at timestamptz,
  add column source_read_granted_by uuid references auth.users(id),
  add column source_read_reason text;
alter table public.ops_account_access add constraint ops_source_read_authority_complete check (
  (source_read_granted_at is null and source_read_granted_by is null and source_read_reason is null)
  or (source_read_granted_at is not null and source_read_granted_by is not null
    and length(btrim(source_read_reason)) between 10 and 500)
);

create function public.authorize_ops_account_source_read(
  p_user_id uuid,
  p_account_id uuid,
  p_context_generation bigint,
  p_binding_id uuid
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare binding public.account_source_bindings%rowtype;
begin
  if not exists(select 1 from public.accounts a where a.id=p_account_id and a.context_generation=p_context_generation) then
    raise exception 'account_context_changed' using errcode='PT409';
  end if;
  if not exists(select 1 from public.ops_account_access g
    where g.user_id=p_user_id and g.account_id=p_account_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())
      and g.source_read_granted_at is not null) then
    raise exception 'source_read_authority_required' using errcode='42501';
  end if;
  select * into binding from public.account_source_bindings
    where id=p_binding_id and account_id=p_account_id and status='verified';
  if binding.id is null then raise exception 'source_binding_unavailable' using errcode='PT409'; end if;
  return jsonb_build_object('id',binding.id,'accountId',binding.account_id,'sourceSystem',binding.source_system,
    'sourceProject',binding.source_project,'sourceKind',binding.source_kind,'sourceKey',binding.source_key,
    'displayName',binding.display_name,'status',binding.status,'evidenceRef',binding.evidence_ref,
    'revision',binding.revision,'verifiedAt',binding.verified_at,'verifiedBy',binding.verified_by);
end;
$$;
revoke all on function public.authorize_ops_account_source_read(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.authorize_ops_account_source_read(uuid,uuid,bigint,uuid) to service_role;
