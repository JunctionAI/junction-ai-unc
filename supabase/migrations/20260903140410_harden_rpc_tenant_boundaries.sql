-- The similarity-search helpers are SECURITY DEFINER functions. PostgreSQL grants
-- EXECUTE to PUBLIC when a function is created, so keep these server-only RPCs
-- behind the service role even when the public schema is exposed by the Data API.
revoke all on function public.match_memories(uuid, vector, integer, text[]) from public;
revoke all on function public.match_memories(uuid, vector, integer, text[]) from anon;
revoke all on function public.match_memories(uuid, vector, integer, text[]) from authenticated;
grant execute on function public.match_memories(uuid, vector, integer, text[]) to service_role;

revoke all on function public.match_playbooks(vector, integer, text[]) from public;
revoke all on function public.match_playbooks(vector, integer, text[]) from anon;
revoke all on function public.match_playbooks(vector, integer, text[]) from authenticated;
grant execute on function public.match_playbooks(vector, integer, text[]) to service_role;

-- Playbooks are a shared, non-tenant library. Preserve authenticated read access,
-- but scope it through the policy role instead of the deprecated auth.role() check.
drop policy if exists authed_read on public.playbooks;
create policy authed_read on public.playbooks
  for select
  to authenticated
  using (true);
