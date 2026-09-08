create index review_outputs_inbox on public.review_outputs(account_id,context_generation,created_at desc,id desc);
create function public.read_review_inbox(acct uuid,generation bigint,actor uuid,before_at timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.accounts where id=acct and context_generation=generation for share;
 if not found then raise exception 'Context changed' using errcode='40001'; end if;
 perform 1 from public.account_members where account_id=acct and user_id=actor for share;
 if not found then raise exception 'Membership required' using errcode='42501'; end if;
 if (before_at is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
 with candidates as (
  select o.*,v.content from public.review_outputs o
  join public.review_output_versions v on v.output_id=o.id and v.account_id=o.account_id and v.revision=o.revision
  join public.artifacts a on a.id=o.artifact_id and a.account_id=o.account_id
  join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id and r.context_generation=o.context_generation
  where o.account_id=acct and o.context_generation=generation
   and (before_at is null or (o.created_at,o.id)<(before_at,before_id))
  order by o.created_at desc,o.id desc limit 11
 ), page as (select * from candidates order by created_at desc,id desc limit 10)
 select jsonb_build_object('accountId',acct,'contextGeneration',generation,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'revision',revision,'kind',kind,
   'title',left(coalesce(content->>'title','Saved output'),300),'excerpt',left(coalesce(content->>'body',''),240),
   'image',jsonb_typeof(content#>'{media,image}')='object','video',jsonb_typeof(content#>'{media,video}')='object',
   'createdAt',created_at) order by created_at desc,id desc) from page),'[]'::jsonb),
  'nextCursor',case when (select count(*) from candidates)>10 then (select jsonb_build_object('createdAt',created_at,'id',id) from page order by created_at,id limit 1) else null end)
 into result;
 return result;
end $$;
revoke all on function public.read_review_inbox(uuid,bigint,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.read_review_inbox(uuid,bigint,uuid,timestamptz,uuid) to service_role;
