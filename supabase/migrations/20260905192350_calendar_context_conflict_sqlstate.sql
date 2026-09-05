-- A permanent authority/context refusal is NOT a serialization failure.
-- PostgREST versions using retrying transactions can repeat SQLSTATE 40001
-- indefinitely. PT409 preserves refusal and returns an explicit HTTP conflict.
-- Replace only the two exact Batch 62 bodies; no grants or conditions change.
do $$
declare target record; definition text; body_hash text;
begin
  for target in select * from (values
    ('unc_calendar_private.calendar_current(public.n8n_calendar_runs)', 'ac9d0852a79c55ef58064436bfc6ee34'),
    ('public.commit_calendar_shadow_completion(uuid,bigint,uuid,jsonb)', '02fa23528bab214ad20946ba3d9a1edb')
  ) as expected(signature, original_hash) loop
    select md5(prosrc),pg_get_functiondef(oid) into body_hash,definition
      from pg_proc where oid=target.signature::regprocedure;
    if body_hash is distinct from target.original_hash then
      raise exception 'Calendar function differs from reviewed predecessor: %',target.signature;
    end if;
    execute replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
  end loop;
end $$;
