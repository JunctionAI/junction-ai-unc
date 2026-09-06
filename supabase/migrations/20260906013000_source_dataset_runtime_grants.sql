-- Runtime authority for reading a verified external stored-data source.
-- This is independent of operator inspection, provider OAuth, routine switches,
-- n8n registration and every outward-action authority.
create table public.account_source_dataset_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  context_generation bigint not null check (context_generation >= 0),
  binding_id uuid not null references public.account_source_bindings(id) on delete cascade,
  platform text not null check (platform = 'klaviyo'),
  dataset text not null check (dataset = 'email_campaigns'),
  source_contract text not null check (source_contract = 'junction.source.email-campaigns.v1'),
  max_source_age_minutes integer not null check (max_source_age_minutes between 1 and 10080),
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  check ((revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null
      and length(btrim(revoke_reason)) between 10 and 500))
);
create unique index account_source_dataset_grants_active
  on public.account_source_dataset_grants(account_id,platform,dataset)
  where revoked_at is null;
alter table public.account_source_dataset_grants enable row level security;
revoke all on public.account_source_dataset_grants from public,anon,authenticated;
grant select,insert,update on public.account_source_dataset_grants to service_role;

create function public.authorize_account_source_dataset_read(
  p_account_id uuid,
  p_context_generation bigint,
  p_platform text,
  p_dataset text
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  grant_row public.account_source_dataset_grants%rowtype;
  binding public.account_source_bindings%rowtype;
begin
  if not exists(select 1 from public.accounts a where a.id=p_account_id
    and a.context_generation=p_context_generation and not a.automation_paused) then
    raise exception 'source_runtime_context_unavailable' using errcode='PT409';
  end if;
  select g.* into grant_row from public.account_source_dataset_grants g
    where g.account_id=p_account_id and g.context_generation=p_context_generation
      and g.platform=p_platform and g.dataset=p_dataset and g.revoked_at is null;
  if grant_row.id is null then
    raise exception 'source_dataset_authority_required' using errcode='42501';
  end if;
  select * into binding from public.account_source_bindings b
    where b.id=grant_row.binding_id and b.account_id=p_account_id
      and b.status='verified' and b.source_system='mission_control'
      and b.source_project='ebcatvidixdjjwmmades';
  if binding.id is null then
    raise exception 'source_binding_unavailable' using errcode='PT409';
  end if;
  return jsonb_build_object('grantId',grant_row.id,'accountId',binding.account_id,
    'contextGeneration',grant_row.context_generation,'bindingId',binding.id,
    'sourceSystem',binding.source_system,'sourceProject',binding.source_project,
    'sourceKind',binding.source_kind,'sourceKey',binding.source_key,
    'platform',grant_row.platform,'dataset',grant_row.dataset,
    'sourceContract',grant_row.source_contract,
    'maxSourceAgeMinutes',grant_row.max_source_age_minutes,
    'bindingRevision',binding.revision);
end;
$$;
revoke all on function public.authorize_account_source_dataset_read(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.authorize_account_source_dataset_read(uuid,bigint,text,text) to service_role;
