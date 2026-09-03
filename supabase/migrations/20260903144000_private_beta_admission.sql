-- Unc private-beta admission: identities may claim a pre-seeded account only through a
-- confirmed-email beta invite. The original self-serve bootstrap RPC remains defined for
-- migration compatibility, but no browser/session role can execute it.

begin;

revoke all on function public.create_account(text, text) from public;
revoke all on function public.create_account(text, text) from anon;
revoke all on function public.create_account(text, text) from authenticated;

commit;
