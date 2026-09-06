-- Execute the allowlist-checked source bridge with its owner privileges.
-- Direct table reads remain unavailable to browser and service roles; only the
-- exact, bounded RPC contract is executable by service_role.
alter function public.read_unc_source_email_campaigns(uuid,text,text,text,integer)
  security definer;

revoke all on function public.read_unc_source_email_campaigns(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.read_unc_source_email_campaigns(uuid,text,text,text,integer) to service_role;

revoke all on table h1.email_campaigns from service_role;
revoke all on table dbh.email_campaigns from service_role;
