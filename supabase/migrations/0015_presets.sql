-- Unc — industry parameter presets + per-routine adjustments (2026-09-03). Additive; 0001–0014 untouched.
--
-- 1. account_presets   one row per account × domain (paid · email · content · seo · sales): the
--                      founder's account-wide overrides of the industry preset, as a jsonb map of
--                      field key → value (src/lib/runtime/presets/types.ts says which keys and ranges).
--                      Absent row = the industry band resolved from the business profile + niche brief.
-- 2. routine_params    one row per account × routine: the values the founder set in "Adjust this
--                      routine" (jsonb field key → value) plus `disabled_steps` (ids of optional
--                      nodes switched off). Saving one also writes a draft spec version through the
--                      existing routine_states versioning (src/lib/runtime/versioning.ts).
--
-- `source` says who set the row: founder (the inspector / API), industry (Unc copied a band in),
-- unc (a self-review adjustment — none writes yet). RLS: members read and write their own account's
-- rows (member_all, like routine_states); the worker uses the service role.

create table account_presets (
  account_id uuid not null references accounts(id) on delete cascade,
  domain text not null check (domain in ('paid','email','content','seo','sales')),
  params jsonb not null default '{}',
  source text not null default 'founder' check (source in ('industry','founder','unc')),
  updated_at timestamptz not null default now(),
  primary key (account_id, domain)
);

create table routine_params (
  account_id uuid not null references accounts(id) on delete cascade,
  routine_id text not null,
  domain text not null check (domain in ('paid','email','content','seo','sales')),
  params jsonb not null default '{}',
  disabled_steps text[] not null default '{}',
  source text not null default 'founder' check (source in ('industry','founder','unc')),
  updated_at timestamptz not null default now(),
  primary key (account_id, routine_id)
);

alter table account_presets enable row level security;
alter table routine_params enable row level security;
create policy member_all on account_presets for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy member_all on routine_params for all using (is_account_member(account_id)) with check (is_account_member(account_id));
