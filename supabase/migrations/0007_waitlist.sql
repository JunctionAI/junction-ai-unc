-- Unc — waitlist (2026-09-02). Additive only; 0001–0006 untouched.
--
-- getjunction.ai's landing page is a waitlist while founders are onboarded in small groups.
-- POST /api/waitlist (src/app/api/waitlist/route.ts) inserts here with the SERVICE ROLE only:
-- RLS is enabled with no policies, so the anon key and signed-in users can neither read nor
-- write it (the service role bypasses RLS). Email is stored lower-cased and unique — a repeat
-- signup is a no-op to the visitor (the route still answers ok).

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  country text,                       -- ISO 3166-1 alpha-2 from x-vercel-ip-country, when present
  source text,                        -- where on the site they joined: hero | closer | pricing | nav …
  referrer text,                      -- Referer header, when present
  created_at timestamptz not null default now()
);
create index waitlist_created_idx on waitlist (created_at desc);

alter table waitlist enable row level security;
-- No policies on purpose: no client access. Service role inserts; Tom reads in the dashboard.
