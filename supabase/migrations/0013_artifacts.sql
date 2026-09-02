-- Unc — routines produce real work (2026-09-03). Additive; 0001–0012 untouched.
--
-- 1. artifacts        the work a routine's produce step made: a post set, an email, a keyword
--                     list, a brief … Stored by the engine (service role), linked from the run's
--                     draft receipt, reviewed by the founder (Approve / Hold / edit) in the app.
-- 2. n8n_workflows    Tom registers an n8n webhook per routine (account_id null = every account);
--                     when one is active the engine hands the produce step to it (docs/N8N-ROUTINES.md).
-- 3. routine_runs     status gains 'waiting_input' — the producer asked the founder for
--                     something; the run holds a snapshot and resumes through
--                     POST /api/routines/resume-input.
--
-- RLS: members read their artifacts and may update ONLY status + edited_body (column-level
-- grant); inserts are the service role's. n8n_workflows is service role only.

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid references routine_runs(id) on delete set null,
  routine_id text not null,
  kind text not null check (kind in ('post','post_set','email','hook_list','keyword_list','content_gap','lead_brief','outreach_draft','meeting_brief','question_list','calendar','generic')),
  title text not null,
  body text not null,                    -- markdown
  items jsonb not null default '[]',     -- [{title, body, meta}]
  meta jsonb not null default '{}',      -- {via: producer|n8n, node, mode, skill, model, …}
  evidence jsonb not null default '[]',  -- [{source, ref}]
  status text not null default 'draft' check (status in ('draft','approved','held','edited','used')),
  edited_body text,                      -- the founder's edit; body keeps the original
  created_at timestamptz not null default now()
);
create index artifacts_account_idx on artifacts (account_id, created_at desc);
create index artifacts_run_idx on artifacts (run_id);
create index artifacts_routine_idx on artifacts (account_id, routine_id, created_at desc);

create table n8n_workflows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,   -- null = global (every account)
  routine_id text not null,
  webhook_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index n8n_workflows_routine_idx on n8n_workflows (routine_id, active);

alter table routine_runs drop constraint if exists routine_runs_status_check;
alter table routine_runs add constraint routine_runs_status_check check (status in ('running','waiting_approval','waiting_input','done','failed','skipped'));

-- RLS
alter table artifacts enable row level security;
alter table n8n_workflows enable row level security;

create policy member_read on artifacts for select using (is_account_member(account_id));
create policy member_update on artifacts for update using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy deny_clients_n8n on n8n_workflows as restrictive for all using (false) with check (false);

revoke all on n8n_workflows from anon, authenticated;
revoke insert, delete on artifacts from anon, authenticated;
revoke update on artifacts from anon, authenticated;
grant update (status, edited_body) on artifacts to authenticated;
