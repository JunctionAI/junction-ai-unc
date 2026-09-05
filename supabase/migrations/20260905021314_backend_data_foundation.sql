-- Inert until account-scoped application flags are enabled. No existing grants change.
-- Filename reconciled to the actual Supabase migration version returned after application.
create table public.backend_leases (
  lease_key text primary key,
  holder uuid not null,
  expires_at timestamptz not null
);
alter table public.backend_leases enable row level security;
revoke all on public.backend_leases from public, anon, authenticated;
grant select, insert, update, delete on public.backend_leases to service_role;

create function public.claim_backend_lease(p_key text, p_holder uuid, p_seconds integer default 30)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if length(p_key) > 256 or p_seconds < 1 or p_seconds > 120 then raise exception 'invalid lease'; end if;
  insert into public.backend_leases(lease_key, holder, expires_at)
  values(p_key, p_holder, clock_timestamp() + make_interval(secs => p_seconds))
  on conflict(lease_key) do update set holder=excluded.holder, expires_at=excluded.expires_at
    where public.backend_leases.expires_at < clock_timestamp();
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.claim_backend_lease(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_backend_lease(text,uuid,integer) to service_role;

create function public.commit_connector_token(p_connector_id uuid, p_holder uuid, p_expected_ciphertext text,
  p_ciphertext text, p_iv text, p_tag text, p_key_version integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.backend_leases where lease_key='connector:'||p_connector_id::text
    and holder=p_holder and expires_at > clock_timestamp() for update;
  if not found then return false; end if;
  perform 1 from public.connectors where id=p_connector_id and status='connected' for update;
  if not found then return false; end if;
  update public.connector_secrets set ciphertext=p_ciphertext, iv=p_iv, tag=p_tag,
    key_version=p_key_version, updated_at=clock_timestamp()
    where connector_id=p_connector_id and ciphertext=p_expected_ciphertext;
  return found;
end $$;
revoke all on function public.commit_connector_token(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.commit_connector_token(uuid,uuid,text,text,text,text,integer) to service_role;

-- Retained reporting snapshots, not a claim of a complete source-system warehouse.
create table public.account_dataset_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  connector_id uuid not null references public.connectors(id) on delete cascade,
  external_ref text not null,
  platform text not null,
  query_hash text not null check(length(query_hash)=64),
  query jsonb not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  source_fetched_at timestamptz not null,
  stored_at timestamptz not null default now()
);
create index account_dataset_lookup on public.account_dataset_snapshots(account_id,connector_id,query_hash,source_fetched_at desc);
alter table public.account_dataset_snapshots enable row level security;
revoke all on public.account_dataset_snapshots from public,anon,authenticated;
grant select,insert,delete on public.account_dataset_snapshots to service_role;

create function public.check_dataset_connector() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.account_id=new.account_id and c.platform=new.platform and c.external_ref=new.external_ref and c.status='connected') then
    raise exception 'dataset connection identity mismatch';
  end if;
  return new;
end $$;
revoke all on function public.check_dataset_connector() from public,anon,authenticated;
grant execute on function public.check_dataset_connector() to service_role;
create trigger dataset_connector_identity before insert on public.account_dataset_snapshots
  for each row execute function public.check_dataset_connector();
