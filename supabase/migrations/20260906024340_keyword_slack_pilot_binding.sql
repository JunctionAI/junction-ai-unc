-- Extend the existing keyword admission to the single approved Slack pilot.
-- Reuse the routed-inbox verifier at reservation, dispatch and provider admission.
begin;
create function unc_private.keyword_command_origin_valid(c public.routine_commands) returns boolean
language plpgsql security invoker set search_path='' as $$
declare verified jsonb;
begin
  if c.channel='app' then return c.link_id is null and c.channel_binding is null; end if;
  if c.channel is distinct from 'slack' or c.account_id is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda'::uuid
    or c.user_id is distinct from '74802c60-149a-4405-b719-dc058d174072'::uuid or c.context_generation is distinct from 1
    or c.link_id is null or c.channel_binding is null
    or c.channel_binding->>'linkId' is distinct from c.link_id::text
    or c.channel_binding->>'accountId' is distinct from c.account_id::text
    or c.channel_binding->>'userId' is distinct from c.user_id::text
    or c.channel_binding->>'contextGeneration' is distinct from c.context_generation::text
    or c.channel_binding->>'scopeId' is distinct from 'T0BMD3LMWUQ'
    or c.channel_binding->>'conversationId' is distinct from 'C0BR8UNSR26'
    or c.channel_binding->>'externalId' is distinct from 'U0BLLM1NDNV'
    or coalesce(c.channel_binding->>'threadId','') !~ '^[0-9]{10}\.[0-9]{6}$' then return false; end if;
  verified:=public.verify_channel_inbound_binding(c.channel_binding,c.channel_binding,false);
  return verified is not null;
end $$;
revoke all on function unc_private.keyword_command_origin_valid(public.routine_commands) from public,anon,authenticated;
grant execute on function unc_private.keyword_command_origin_valid(public.routine_commands) to service_role;
do $$
declare target record; definition text; body text;
begin
  for target in select * from (values
    ('public.assert_keyword_command_binding(jsonb)','4520c23276ea98cfd045204acdd1ea21',
      'c.channel<>''app'' or c.link_id is not null or c.channel_binding is not null or'),
    ('unc_private.guard_keyword_command_permit()','fd6f2f91bb0fceab697ecd473554f408',
      'c.channel<>''app'' or c.channel_binding is not null or c.link_id is not null or')
  ) as expected(signature,hash,old_clause) loop
    select prosrc,pg_get_functiondef(oid) into strict body,definition from pg_proc where oid=target.signature::regprocedure;
    if md5(body)<>target.hash or strpos(definition,target.old_clause)=0 then raise exception 'Keyword dependency changed: %',target.signature; end if;
    execute replace(definition,target.old_clause,'not unc_private.keyword_command_origin_valid(c) or');
  end loop;
end $$;
commit;
