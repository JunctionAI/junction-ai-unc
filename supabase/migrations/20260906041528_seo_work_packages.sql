-- A draft package is separate from a routine execution receipt. Nothing here publishes.
create table public.seo_package_settings (
  account_id uuid primary key references public.accounts(id),
  context_generation bigint not null,
  actor_id uuid not null references auth.users(id),
  enabled boolean not null default false,
  prepare_articles boolean not null default true,
  prepare_page_edits boolean not null default true,
  starts_at timestamptz not null default now()
);
create table public.seo_work_packages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  context_generation bigint not null,
  actor_id uuid not null references auth.users(id),
  keyword_artifact_id uuid not null references public.artifacts(id),
  keyword_revision integer not null,
  market text not null check(market in ('US','NZ','AU')),
  website text not null,
  prepare_articles boolean not null,
  prepare_page_edits boolean not null,
  status text not null default 'queued' check(status in ('queued','running','ready','needs','cancelled')),
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(account_id,context_generation,keyword_artifact_id,keyword_revision)
);
create unique index seo_package_one_inflight on public.seo_work_packages(account_id,context_generation) where status in ('queued','running');
alter table public.seo_package_settings enable row level security;
alter table public.seo_work_packages enable row level security;
revoke all on public.seo_package_settings,public.seo_work_packages from public,anon,authenticated;
grant select,insert,update on public.seo_package_settings,public.seo_work_packages to service_role;

create function public.guard_seo_package() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.accounts; k public.artifacts; r public.routine_runs;
begin
  select * into a from public.accounts where id=new.account_id for share;
  if a.id is null or a.context_generation<>new.context_generation or a.automation_paused or
    not exists(select 1 from public.account_members where account_id=a.id and user_id=new.actor_id and role='owner') then
    raise exception 'SEO account authority changed';
  end if;
  if tg_table_name='seo_package_settings' then
    if tg_op='UPDATE' then new.starts_at:=case when not old.enabled and new.enabled then now() else old.starts_at end; end if;
    return new;
  end if;
  select * into k from public.artifacts where id=new.keyword_artifact_id for share;
  select * into r from public.routine_runs where id=k.run_id;
  if k.account_id is distinct from new.account_id or k.revision is distinct from new.keyword_revision or
    k.kind<>'keyword_list' or k.status not in ('draft','approved','edited') or
    r.account_id is distinct from new.account_id or r.context_generation is distinct from new.context_generation or
    r.routine_id<>'D03-W01' or r.status<>'done' or r.mode<>'dry_run' or
    not exists(select 1 from public.n8n_shadow_permits where run_id=r.id and account_id=a.id and status='verified') or
    not exists(select 1 from public.routine_states where account_id=a.id and routine_id='D03-W01' and enabled) or
    not exists(select 1 from public.seo_package_settings where account_id=a.id and context_generation=new.context_generation and actor_id=new.actor_id and enabled and prepare_articles=new.prepare_articles and prepare_page_edits=new.prepare_page_edits) then
    raise exception 'SEO source or selection changed';
  end if;
  if new.market is distinct from (case k.meta#>>'{executionReceipt,client,locationCode}' when '2840' then 'US' when '2554' then 'NZ' when '2036' then 'AU' end) or
     new.website is distinct from 'https://'||(k.meta#>>'{executionReceipt,client,primaryDomain}')||'/' then
    raise exception 'SEO source market or website mismatch';
  end if;
  if tg_op='INSERT' then
    if new.status<>'queued' or new.result is not null then raise exception 'SEO must start queued'; end if;
  else
    if (to_jsonb(new)-array['status','result','started_at','finished_at']) is distinct from
       (to_jsonb(old)-array['status','result','started_at','finished_at']) then raise exception 'SEO identity immutable'; end if;
    if not ((old.status='queued' and new.status in ('running','cancelled')) or (old.status='running' and new.status in ('ready','needs','cancelled'))) then raise exception 'Invalid SEO transition'; end if;
    if new.status='ready' and (new.result#>>'{artifact,meta,publishEnabled}' is distinct from 'false' or new.result#>>'{artifact,kind}' is distinct from 'generic') then raise exception 'Draft-only result required'; end if;
    if length(coalesce(new.result::text,''))>100000 then raise exception 'SEO result too large'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_seo_package() from public,anon,authenticated;
grant execute on function public.guard_seo_package() to service_role;
create trigger seo_settings_guard before insert or update on public.seo_package_settings for each row execute function public.guard_seo_package();
create trigger seo_package_guard before insert or update on public.seo_work_packages for each row execute function public.guard_seo_package();

create function public.claim_seo_package() returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.seo_work_packages;
begin
  select p.* into job from public.seo_work_packages p
    join public.accounts a on a.id=p.account_id and a.context_generation=p.context_generation and not a.automation_paused
    join public.seo_package_settings s on s.account_id=p.account_id and s.context_generation=p.context_generation and s.enabled
    where p.status='queued' order by p.created_at for update of p skip locked limit 1;
  if job.id is null then return null; end if;
  update public.seo_work_packages set status='running',started_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
revoke all on function public.claim_seo_package() from public,anon,authenticated;
grant execute on function public.claim_seo_package() to service_role;
