-- Canonical external-system identity bindings for operator-managed client setup.
-- These rows contain identifiers and evidence references only, never credentials.
create table public.account_source_bindings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_system text not null check (source_system ~ '^[a-z][a-z0-9_-]{1,39}$'),
  source_project text not null check (length(source_project) between 2 and 100),
  source_kind text not null check (source_kind ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  source_key text not null check (length(source_key) between 1 and 200 and source_key !~ '[[:space:]]'),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  status text not null check (status in ('verified','superseded')),
  evidence_ref text not null check (length(btrim(evidence_ref)) between 10 and 500),
  revision bigint not null default 0 check (revision >= 0),
  verified_at timestamptz not null default now(),
  verified_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system,source_project,source_kind,source_key)
);
create index account_source_bindings_account_idx on public.account_source_bindings(account_id,status);
alter table public.account_source_bindings enable row level security;
revoke all on public.account_source_bindings from public,anon,authenticated;
grant select,insert,update on public.account_source_bindings to service_role;

alter table public.ops_account_access
  add column source_binding_granted_at timestamptz,
  add column source_binding_granted_by uuid references auth.users(id),
  add column source_binding_reason text;
alter table public.ops_account_access add constraint ops_source_binding_authority_complete check (
  (source_binding_granted_at is null and source_binding_granted_by is null and source_binding_reason is null)
  or (source_binding_granted_at is not null and source_binding_granted_by is not null
    and length(btrim(source_binding_reason)) between 10 and 500)
);

create function public.upsert_ops_account_source_binding(
  p_user_id uuid,
  p_account_id uuid,
  p_context_generation bigint,
  p_source_system text,
  p_source_project text,
  p_source_kind text,
  p_source_key text,
  p_display_name text,
  p_status text,
  p_evidence_ref text,
  p_expected_revision bigint default null
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  account_row public.accounts%rowtype;
  grant_row public.ops_account_access%rowtype;
  existing public.account_source_bindings%rowtype;
  saved public.account_source_bindings%rowtype;
begin
  select * into account_row from public.accounts where id=p_account_id for share;
  if account_row.id is null or account_row.context_generation<>p_context_generation then
    raise exception 'account_context_changed' using errcode='PT409';
  end if;
  select * into grant_row from public.ops_account_access where user_id=p_user_id and account_id=p_account_id for share;
  if grant_row.user_id is null or grant_row.revoked_at is not null
    or (grant_row.expires_at is not null and grant_row.expires_at<=statement_timestamp())
    or grant_row.source_binding_granted_at is null then
    raise exception 'source_binding_authority_required' using errcode='42501';
  end if;
  if p_source_system !~ '^[a-z][a-z0-9_-]{1,39}$'
    or length(p_source_project) not between 2 and 100
    or p_source_kind !~ '^[a-z][a-z0-9_.-]{1,79}$'
    or length(p_source_key) not between 1 and 200 or p_source_key ~ '[[:space:]]'
    or length(btrim(p_display_name)) not between 1 and 200
    or p_status not in ('verified','superseded')
    or length(btrim(p_evidence_ref)) not between 10 and 500 then
    raise exception 'invalid_source_binding' using errcode='22023';
  end if;

  select * into existing from public.account_source_bindings
    where source_system=p_source_system and source_project=p_source_project
      and source_kind=p_source_kind and source_key=p_source_key for update;
  if existing.id is null then
    if p_expected_revision is not null then raise exception 'source_binding_changed' using errcode='40001'; end if;
    insert into public.account_source_bindings(account_id,source_system,source_project,source_kind,source_key,
      display_name,status,evidence_ref,verified_by)
    values(p_account_id,p_source_system,p_source_project,p_source_kind,p_source_key,
      btrim(p_display_name),p_status,btrim(p_evidence_ref),p_user_id)
    returning * into saved;
  else
    if existing.account_id<>p_account_id then raise exception 'source_already_bound' using errcode='23505'; end if;
    if p_expected_revision is null or existing.revision<>p_expected_revision then
      raise exception 'source_binding_changed' using errcode='40001';
    end if;
    update public.account_source_bindings set display_name=btrim(p_display_name),status=p_status,
      evidence_ref=btrim(p_evidence_ref),revision=revision+1,verified_at=clock_timestamp(),
      verified_by=p_user_id,updated_at=clock_timestamp()
      where id=existing.id and revision=p_expected_revision returning * into saved;
    if saved.id is null then raise exception 'source_binding_changed' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('id',saved.id,'accountId',saved.account_id,'sourceSystem',saved.source_system,
    'sourceProject',saved.source_project,'sourceKind',saved.source_kind,'sourceKey',saved.source_key,
    'displayName',saved.display_name,'status',saved.status,'evidenceRef',saved.evidence_ref,
    'revision',saved.revision,'verifiedAt',saved.verified_at,'verifiedBy',saved.verified_by);
end;
$$;
revoke all on function public.upsert_ops_account_source_binding(uuid,uuid,bigint,text,text,text,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.upsert_ops_account_source_binding(uuid,uuid,bigint,text,text,text,text,text,text,text,bigint) to service_role;

create function public.read_ops_account_source_bindings(p_user_id uuid,p_account_id uuid default null)
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
    'verifiedBy',b.verified_by) order by b.account_id,b.source_system,b.source_project,b.source_kind,b.source_key),'[]'::jsonb)
    into result from public.account_source_bindings b join public.ops_account_access g on g.account_id=b.account_id
    where g.user_id=p_user_id and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>statement_timestamp())
      and (p_account_id is null or b.account_id=p_account_id);
  return result;
end;
$$;
revoke all on function public.read_ops_account_source_bindings(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_ops_account_source_bindings(uuid,uuid) to service_role;
