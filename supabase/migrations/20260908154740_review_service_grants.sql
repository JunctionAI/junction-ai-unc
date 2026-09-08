-- Applied as 20260908154740. Supabase grants service_role ALL on new public tables.
-- Adding narrower grants does not subtract those defaults. Revoke before granting.
revoke all on public.review_outputs,public.review_output_versions,public.review_comments,
 public.review_revision_jobs,public.review_action_approvals from service_role;
revoke update(status,decided_by,decided_at) on public.review_action_approvals from service_role;
grant select,insert on public.review_outputs,public.review_output_versions,public.review_comments,
 public.review_revision_jobs,public.review_action_approvals to service_role;
grant update(revision) on public.review_outputs to service_role;
grant update(status,claim_token,result_revision) on public.review_revision_jobs to service_role;
grant update(status,decided_by,decided_at) on public.review_action_approvals to service_role;
