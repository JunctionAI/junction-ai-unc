-- The invoker admission RPC must resolve its origin helper without granting
-- service_role access to the whole private schema. Preserve the helper ACL.
begin;
alter function unc_private.keyword_command_origin_valid(public.routine_commands) set schema public;
revoke all on function public.keyword_command_origin_valid(public.routine_commands) from public,anon,authenticated;
grant execute on function public.keyword_command_origin_valid(public.routine_commands) to service_role;
do $$
declare target record; definition text; body text;
begin
  for target in select * from (values
    ('public.assert_keyword_command_binding(jsonb)','d5041471a12bb28027849a503f368d41'),
    ('unc_private.guard_keyword_command_permit()','ce4455681dc40be07eb2f6369a8d19e2')
  ) as expected(signature,hash) loop
    select prosrc,pg_get_functiondef(oid) into strict body,definition from pg_proc where oid=target.signature::regprocedure;
    if md5(body)<>target.hash or strpos(definition,'unc_private.keyword_command_origin_valid(c)')=0 then
      raise exception 'Keyword dependency changed: %',target.signature;
    end if;
    execute replace(definition,'unc_private.keyword_command_origin_valid(c)','public.keyword_command_origin_valid(c)');
  end loop;
end $$;
commit;
