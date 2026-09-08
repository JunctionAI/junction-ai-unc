-- Only the existing worker owns text-revision queue consumption. This is discovery,
-- not a claim; claim_review_revision performs the atomic claim and rechecks context.
create function public.pending_review_text_job(acct uuid)
returns table(id uuid,account_id uuid,context_generation bigint)
language sql stable security invoker set search_path='' as $$
 select j.id,j.account_id,o.context_generation
 from public.review_revision_jobs j
 join public.review_outputs o on o.id=j.output_id and o.account_id=j.account_id
 join public.accounts a on a.id=o.account_id and a.context_generation=o.context_generation
 join public.review_comments c on c.id=j.comment_id and c.account_id=j.account_id
 join public.review_output_versions v on v.output_id=o.id and v.account_id=o.account_id and v.revision=o.revision
 where j.account_id=acct and j.status='queued' and not a.automation_paused
   and (a.monthly_llm_cap_usd is null or a.monthly_llm_cap_usd>0)
   and o.kind in ('article','outreach','sms','brief','decision')
   and c.anchor->>'kind'='whole' and c.intent='change_output'
   and jsonb_typeof(v.content->'body')='string' and length(v.content->>'body') between 1 and 24000
   and v.content#>'{media,image}' is null and v.content#>'{media,video}' is null
   and exists(select 1 from public.account_members m where m.account_id=acct and m.user_id=c.actor_id)
 order by j.created_at,j.id limit 1
$$;
revoke all on function public.pending_review_text_job(uuid) from public,anon,authenticated;
grant execute on function public.pending_review_text_job(uuid) to service_role;
