-- Applied as 20260908151115 after local and full-schema rollback verification.
-- Review content is private. Only session-validated server routes use these functions.
create table public.review_outputs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  artifact_id uuid not null references public.artifacts(id),
  context_generation bigint not null check (context_generation >= 0),
  revision bigint not null default 0 check (revision >= 0),
  kind text not null check (kind in ('email','sms','image','video','article','outreach','decision','brief')),
  section_ids text[] not null default '{}',
  duration_seconds double precision check (duration_seconds > 0 and duration_seconds < 'Infinity'::float8),
  created_at timestamptz not null default now(),
  unique(id, account_id),
  check(kind='video' or duration_seconds is null)
);
create index review_outputs_artifact on public.review_outputs(account_id, artifact_id);
create table public.review_output_versions (
  output_id uuid not null,
  account_id uuid not null,
  revision bigint not null check(revision>=0),
  content jsonb not null check(jsonb_typeof(content)='object'),
  created_at timestamptz not null default now(),
  primary key(output_id,revision),
  foreign key(output_id,account_id) references public.review_outputs(id,account_id)
);
create table public.review_comments (
  id uuid primary key,
  output_id uuid not null,
  account_id uuid not null,
  output_revision bigint not null,
  actor_id uuid not null,
  anchor jsonb not null check(jsonb_typeof(anchor)='object'),
  note text not null check(length(btrim(note)) between 1 and 4000),
  intent text not null check(intent in ('change_output','suggest_brand_preference')),
  created_at timestamptz not null default now(),
  foreign key(output_id,account_id) references public.review_outputs(id,account_id),
  foreign key(output_id,output_revision) references public.review_output_versions(output_id,revision)
);
create index review_comments_output on public.review_comments(account_id,output_id,created_at);
create table public.review_revision_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  output_id uuid not null,
  base_revision bigint not null,
  comment_id uuid not null unique references public.review_comments(id),
  status text not null default 'queued' check(status in ('queued','running','done','failed','superseded')),
  claim_token uuid,
  result_revision bigint,
  created_at timestamptz not null default now(),
  foreign key(output_id,account_id) references public.review_outputs(id,account_id),
  foreign key(output_id,base_revision) references public.review_output_versions(output_id,revision)
);
create index review_jobs_pending on public.review_revision_jobs(status,created_at);
alter table public.review_outputs enable row level security;
alter table public.review_output_versions enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_revision_jobs enable row level security;
revoke all on public.review_outputs,public.review_output_versions,public.review_comments,public.review_revision_jobs from public,anon,authenticated;
grant select,insert,update on public.review_outputs to service_role;
grant select,insert on public.review_output_versions,public.review_comments to service_role;
grant select,insert,update on public.review_revision_jobs to service_role;

create function public.add_review_comment(acct uuid,generation bigint,actor uuid,artifact uuid,
  output uuid,expected_revision bigint,comment uuid,anchor_value jsonb,note_value text,intent_value text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_generation bigint; o public.review_outputs%rowtype; old public.review_comments%rowtype;
  j uuid; anchor_kind text; x double precision; y double precision; seconds double precision;
begin
  select context_generation into current_generation from public.accounts where id=acct for share;
  if not found or current_generation is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  perform 1 from public.account_members where account_id=acct and user_id=actor for share;
  if not found then raise exception 'Membership required' using errcode='42501'; end if;
  select ro.* into o from public.review_outputs ro
    join public.artifacts a on a.id=ro.artifact_id and a.account_id=ro.account_id
    join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
    where ro.id=output and ro.account_id=acct and ro.artifact_id=artifact
      and ro.context_generation=generation and r.context_generation=generation for update of ro;
  if not found then raise exception 'Output unavailable' using errcode='P0002'; end if;
  if o.revision is distinct from expected_revision then raise exception 'Output changed' using errcode='40001'; end if;
  if intent_value is null or intent_value not in ('change_output','suggest_brand_preference')
    or note_value is null or length(btrim(note_value)) not between 1 and 4000
    or anchor_value is null or jsonb_typeof(anchor_value)<>'object' then
    raise exception 'Invalid comment' using errcode='22023'; end if;
  anchor_kind:=anchor_value->>'kind';
  if anchor_kind='whole' then
    if anchor_value <> '{"kind":"whole"}'::jsonb then raise exception 'Invalid anchor'; end if;
  elsif anchor_kind='section' then
    if not coalesce((anchor_value->>'sectionId')=any(o.section_ids),false)
      or anchor_value - 'kind' - 'sectionId' <> '{}'::jsonb then raise exception 'Section unavailable'; end if;
  elsif anchor_kind='visual' then
    if o.kind not in ('image','email') or jsonb_typeof(anchor_value->'x') is distinct from 'number'
      or jsonb_typeof(anchor_value->'y') is distinct from 'number'
      or anchor_value - 'kind' - 'x' - 'y' <> '{}'::jsonb then raise exception 'Invalid visual anchor'; end if;
    x:=(anchor_value->>'x')::float8; y:=(anchor_value->>'y')::float8;
    if not(x between 0 and 1 and y between 0 and 1) then raise exception 'Invalid coordinates'; end if;
  elsif anchor_kind='video' then
    if o.kind<>'video' or o.duration_seconds is null or jsonb_typeof(anchor_value->'seconds') is distinct from 'number'
      or anchor_value - 'kind' - 'seconds' <> '{}'::jsonb then raise exception 'Invalid video anchor'; end if;
    seconds:=(anchor_value->>'seconds')::float8;
    if not(seconds between 0 and o.duration_seconds) then raise exception 'Invalid timestamp'; end if;
  else raise exception 'Invalid anchor'; end if;
  select * into old from public.review_comments where id=comment;
  if found then
    if old.account_id<>acct or old.output_id<>output or old.output_revision<>expected_revision
      or old.actor_id<>actor or old.anchor<>anchor_value or old.note<>btrim(note_value) or old.intent<>intent_value then
      raise exception 'Conflicting comment ID' using errcode='40001'; end if;
    select id into j from public.review_revision_jobs where comment_id=comment;
    return jsonb_build_object('commentId',comment,'jobId',j,'duplicate',true);
  end if;
  insert into public.review_comments(id,output_id,account_id,output_revision,actor_id,anchor,note,intent)
    values(comment,output,acct,expected_revision,actor,anchor_value,btrim(note_value),intent_value);
  if intent_value='change_output' then
    insert into public.review_revision_jobs(account_id,output_id,base_revision,comment_id)
      values(acct,output,expected_revision,comment) returning id into j;
  end if;
  return jsonb_build_object('commentId',comment,'jobId',j,'duplicate',false);
end $$;
revoke all on function public.add_review_comment(uuid,bigint,uuid,uuid,uuid,bigint,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.add_review_comment(uuid,bigint,uuid,uuid,uuid,bigint,uuid,jsonb,text,text) to service_role;

create function public.read_review_output(acct uuid,generation bigint,actor uuid,output uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.review_outputs%rowtype; g bigint; result jsonb;
begin
  select context_generation into g from public.accounts where id=acct for share;
  if not found or g is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  perform 1 from public.account_members where account_id=acct and user_id=actor for share;
  if not found then raise exception 'Membership required' using errcode='42501'; end if;
  select ro.* into o from public.review_outputs ro
    join public.artifacts a on a.id=ro.artifact_id and a.account_id=ro.account_id
    join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
    where ro.id=output and ro.account_id=acct and ro.context_generation=generation
      and r.context_generation=generation for share of ro;
  if not found then return null; end if;
  select jsonb_build_object('output',to_jsonb(o),'version',to_jsonb(v),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from
      (select * from public.review_comments where output_id=o.id and account_id=acct order by created_at desc,id desc limit 200) c),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at,j.id) from
      (select * from public.review_revision_jobs where output_id=o.id and account_id=acct order by created_at desc,id desc limit 50) j),'[]'::jsonb))
    into result from public.review_output_versions v where v.output_id=o.id and v.account_id=acct and v.revision=o.revision;
  if result is null then raise exception 'Output version unavailable'; end if;
  return result;
end $$;
revoke all on function public.read_review_output(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_review_output(uuid,bigint,uuid,uuid) to service_role;

-- Trusted producer only: the run and artifact already exist in this account/context.
-- A retry returns version zero without overwriting later revisions or changed content.
create function public.register_review_output(acct uuid,generation bigint,source_run uuid,artifact uuid,
  output uuid,output_kind text,sections text[],duration double precision,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g bigint; old public.review_outputs%rowtype; original jsonb;
begin
  select context_generation into g from public.accounts where id=acct for share;
  if not found or g is distinct from generation then raise exception 'Context changed' using errcode='40001'; end if;
  perform 1 from public.artifacts a join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
    where a.id=artifact and a.account_id=acct and r.id=source_run and r.context_generation=generation for share of a,r;
  if not found then raise exception 'Source artifact unavailable' using errcode='42501'; end if;
  if output is null or output_kind is null or output_kind not in ('email','sms','image','video','article','outreach','decision','brief')
    or sections is null or cardinality(sections)>200
    or exists(select 1 from unnest(sections) s where s is null or length(btrim(s)) not between 1 and 120)
    or cardinality(sections)<>(select count(distinct s) from unnest(sections) s)
    or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>200000 then
    raise exception 'Invalid output' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('review-output:'||output::text,0));
  select * into old from public.review_outputs where id=output for update;
  if found then
    select content into original from public.review_output_versions where output_id=output and revision=0;
    if old.account_id is distinct from acct or old.artifact_id is distinct from artifact
      or old.context_generation is distinct from generation or old.kind is distinct from output_kind
      or old.section_ids is distinct from sections or old.duration_seconds is distinct from duration
      or original is distinct from payload then raise exception 'Conflicting output ID' using errcode='40001'; end if;
    return jsonb_build_object('outputId',output,'revision',0,'duplicate',true);
  end if;
  insert into public.review_outputs(id,account_id,artifact_id,context_generation,kind,section_ids,duration_seconds)
    values(output,acct,artifact,generation,output_kind,sections,duration);
  insert into public.review_output_versions(output_id,account_id,revision,content) values(output,acct,0,payload);
  return jsonb_build_object('outputId',output,'revision',0,'duplicate',false);
end $$;
revoke all on function public.register_review_output(uuid,bigint,uuid,uuid,uuid,text,text[],double precision,jsonb) from public,anon,authenticated;
grant execute on function public.register_review_output(uuid,bigint,uuid,uuid,uuid,text,text[],double precision,jsonb) to service_role;

create function public.claim_review_revision(acct uuid,generation bigint,job uuid,token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.review_revision_jobs%rowtype; o public.review_outputs%rowtype; c public.review_comments%rowtype; v jsonb;
begin
  perform 1 from public.accounts where id=acct and context_generation=generation and automation_paused=false for share;
  if not found or token is null then raise exception 'Runtime unavailable' using errcode='40001'; end if;
  -- Output first, then job: same lock order as comment creation and completion.
  select ro.* into o from public.review_outputs ro join public.review_revision_jobs rj on rj.output_id=ro.id
    join public.artifacts a on a.id=ro.artifact_id and a.account_id=ro.account_id
    join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
    where rj.id=job and rj.account_id=acct and ro.account_id=acct
      and ro.context_generation=generation and r.context_generation=generation for update of ro;
  if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
  select * into j from public.review_revision_jobs where id=job for update;
  if j.status<>'queued' then return null; end if;
  if j.base_revision<>o.revision then
    update public.review_revision_jobs set status='superseded' where id=job;return null;
  end if;
  select * into c from public.review_comments where id=j.comment_id and account_id=acct and intent='change_output';
  if not found then raise exception 'Comment unavailable' using errcode='42501'; end if;
  perform 1 from public.account_members where account_id=acct and user_id=c.actor_id for share;
  if not found then raise exception 'Membership revoked' using errcode='42501'; end if;
  select content into v from public.review_output_versions where output_id=o.id and revision=o.revision and account_id=acct;
  if v is null then raise exception 'Version unavailable'; end if;
  update public.review_revision_jobs set status='running',claim_token=token where id=job;
  return jsonb_build_object('jobId',job,'token',token,'output',to_jsonb(o),'content',v,'comment',to_jsonb(c));
end $$;
revoke all on function public.claim_review_revision(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_review_revision(uuid,bigint,uuid,uuid) to service_role;

create function public.complete_review_revision(acct uuid,generation bigint,job uuid,token uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.review_revision_jobs%rowtype; o public.review_outputs%rowtype; previous jsonb;
begin
  perform 1 from public.accounts where id=acct and context_generation=generation and automation_paused=false for share;
  if not found then raise exception 'Runtime unavailable' using errcode='40001'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>200000 then raise exception 'Invalid revision'; end if;
  select ro.* into o from public.review_outputs ro join public.review_revision_jobs rj on rj.output_id=ro.id
    join public.artifacts a on a.id=ro.artifact_id and a.account_id=ro.account_id
    join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
    where rj.id=job and rj.account_id=acct and ro.account_id=acct and ro.context_generation=generation
      and r.context_generation=generation for update of ro;
  if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
  select * into j from public.review_revision_jobs where id=job for update;
  if j.claim_token is distinct from token or token is null then raise exception 'Claim mismatch' using errcode='42501'; end if;
  if j.status='done' then
    select content into previous from public.review_output_versions where output_id=o.id and revision=j.result_revision;
    if previous is distinct from payload then raise exception 'Conflicting completion' using errcode='40001'; end if;
    return jsonb_build_object('outputId',o.id,'revision',j.result_revision,'duplicate',true);
  end if;
  if j.status<>'running' then raise exception 'Job not running' using errcode='40001'; end if;
  perform 1 from public.review_comments c join public.account_members m on m.account_id=c.account_id and m.user_id=c.actor_id
    where c.id=j.comment_id and c.account_id=acct for share of m;
  if not found then raise exception 'Membership revoked' using errcode='42501'; end if;
  if j.base_revision<>o.revision then
    update public.review_revision_jobs set status='superseded' where id=job;return null;
  end if;
  insert into public.review_output_versions(output_id,account_id,revision,content) values(o.id,acct,o.revision+1,payload);
  update public.review_outputs set revision=o.revision+1 where id=o.id;
  update public.review_revision_jobs set status='done',result_revision=o.revision+1 where id=job;
  return jsonb_build_object('outputId',o.id,'revision',o.revision+1,'duplicate',false);
end $$;
revoke all on function public.complete_review_revision(uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_review_revision(uuid,bigint,uuid,uuid,jsonb) to service_role;

-- Failure recording is allowed while paused, but cannot alter another generation/claim.
create function public.fail_review_revision(acct uuid,generation bigint,job uuid,token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.accounts where id=acct and context_generation=generation for share;
  if not found then raise exception 'Context changed' using errcode='40001'; end if;
  update public.review_revision_jobs j set status='failed' from public.review_outputs o
    where j.id=job and j.account_id=acct and j.claim_token=token and j.status='running'
      and o.id=j.output_id and o.account_id=acct and o.context_generation=generation;
  return found;
end $$;
revoke all on function public.fail_review_revision(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_review_revision(uuid,bigint,uuid,uuid) to service_role;
