-- Run only after BEGIN + staged review migration. ALWAYS ROLLBACK this test.
-- Synthetic account/run/artifact; existing Tom user referenced, never modified.
create temporary table review_check_ids as select gen_random_uuid() a,gen_random_uuid() o,gen_random_uuid() c,gen_random_uuid() token,
  '7371b18c-55a3-4b40-8231-33035e506b80'::uuid actor;
grant select on review_check_ids to service_role;
set local role service_role;
insert into public.accounts(id,name,context_generation,automation_paused)
  select a,'Junction review rollback verification',1,false from review_check_ids;
insert into public.account_members(account_id,user_id,role) select a,actor,'owner' from review_check_ids;
insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
  select a,a,'D03-W01',1,'dry_run','done',1 from review_check_ids;
insert into public.artifacts(id,account_id,run_id,routine_id,kind,title,body)
  select a,a,a,'D03-W01','generic','Rollback verification','Synthetic article' from review_check_ids;
do $$
declare t record; registered jsonb; comment_result jsonb; claimed jsonb; completed jsonb; loaded jsonb;
begin
  select * into t from review_check_ids;
  if current_user<>'service_role' then raise exception 'Test must use service role'; end if;
  registered:=public.register_review_output(t.a,1,t.a,t.a,t.o,'article',array[]::text[],null,'{"title":"Test article","body":"Original"}');
  if registered->>'outputId'<>t.o::text then raise exception 'Registration mismatch'; end if;
  comment_result:=public.add_review_comment(t.a,1,t.actor,t.a,t.o,0,t.c,'{"kind":"whole"}','Shorten this','change_output');
  claimed:=public.claim_review_revision(t.a,1,(comment_result->>'jobId')::uuid,t.token);
  if claimed is null or claimed#>>'{content,body}'<>'Original' then raise exception 'Claim mismatch'; end if;
  if public.claim_review_revision(t.a,1,(comment_result->>'jobId')::uuid,t.token) is not null then raise exception 'Duplicate claim'; end if;
  completed:=public.complete_review_revision(t.a,1,(comment_result->>'jobId')::uuid,t.token,'{"title":"Test article","body":"Revised"}');
  if (completed->>'revision')::int<>1 then raise exception 'Completion mismatch'; end if;
  loaded:=public.read_review_output(t.a,1,t.actor,t.o);
  if loaded#>>'{version,content,body}'<>'Revised' then raise exception 'Readback mismatch'; end if;
  if (select content->>'body' from public.review_output_versions where output_id=t.o and revision=0)<>'Original' then raise exception 'Original was modified'; end if;
end $$;
reset role;
select 'PASS' as full_schema_service_role_roundtrip,'register -> comment -> claim once -> complete -> readback -> original preserved' as checks;
rollback;
