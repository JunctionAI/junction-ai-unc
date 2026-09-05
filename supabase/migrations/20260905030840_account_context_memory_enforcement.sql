-- Apply only after deploying the generation-aware app. Reads remain RLS-scoped.
-- Memory mutation uses the verified session's service-backed API; the guard's
-- row lock must not be bypassed by granting browser roles UPDATE on accounts.
begin;
create trigger memory_context_generation before insert or update on public.memories
for each row execute function public.guard_memory_context_generation();
revoke insert,update,delete,truncate,references,trigger on public.memories from public,anon,authenticated;
commit;
