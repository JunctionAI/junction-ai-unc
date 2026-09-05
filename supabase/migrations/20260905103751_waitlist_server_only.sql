-- Signups are accepted only through the server's validated, rate-limited endpoint.
-- RLS already denies clients; remove unused table grants as a second boundary.
revoke all on table public.waitlist from public, anon, authenticated;
grant select, insert, update, delete on table public.waitlist to service_role;
