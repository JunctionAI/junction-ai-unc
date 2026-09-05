-- Rollback-only PostgreSQL rehearsal, after the staged channel_inbox_identity migration.
-- No webhook, model, provider, message or n8n execution. Never run a consumer in this test.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); owner_id uuid;
  link_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid();
  e jsonb; saved jsonb; again jsonb; claimed jsonb; initial_binding jsonb;
  denied boolean; epoch bigint; n integer:=0;
begin
  -- The rehearsal must never claim an existing real queued message.
  assert not exists(select 1 from public.channel_inbox), 'inbox no longer empty: use an isolated database';
  select user_id into owner_id from public.account_members order by account_id limit 1;
  assert owner_id is not null, 'requires an existing referenced auth user; none is created/changed';
  insert into public.accounts(id,name) values(a,'UNC_CHANNEL_IDENTITY_CANARY'),(b,'UNC_CHANNEL_IDENTITY_CANARY_OTHER');
  insert into public.account_members(account_id,user_id,role) values(a,owner_id,'owner'),(b,owner_id,'owner');
  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at)
    values(link_id,a,owner_id,'telegram','canary-device',clock_timestamp());
  assert (select binding_version=0 from public.channel_links where id=link_id), 'initial binding epoch wrong';

  e:=jsonb_build_object('channel','telegram','externalId','canary-device','externalMsgId','m1','text','hello',
    'binding',jsonb_build_object('accountId',b,'contextGeneration',99));
  saved:=public.accept_channel_inbound(repeat('a',64),e);
  initial_binding:=saved->'binding';
  assert initial_binding->>'kind'='linked' and initial_binding->>'accountId'=a::text
    and initial_binding->>'contextGeneration'='0' and initial_binding->>'bindingVersion'='0', 'trusted capture wrong';
  update public.accounts set context_generation=1,automation_paused=true where id=a;
  again:=public.accept_channel_inbound(repeat('a',64),e);
  assert again->'binding'=initial_binding, 'duplicate rebound to fresh generation';
  denied:=false;
  begin perform public.accept_channel_inbound(repeat('a',64),e||jsonb_build_object('text','different'));
  exception when check_violation then denied:=true; end;
  assert denied, 'same provider event ID accepted with different content';
  denied:=false;
  begin update public.channel_inbox set binding=initial_binding||jsonb_build_object('contextGeneration',1) where id=repeat('a',64);
  exception when check_violation then denied:=true; end;
  assert denied, 'accepted binding mutated';
  denied:=false;
  begin update public.channel_inbox set event=e||jsonb_build_object('text','rewrite') where id=repeat('a',64);
  exception when check_violation then denied:=true; end;
  assert denied, 'accepted payload mutated';
  -- Legitimate state-only updates exercise the same trigger's passing branch.
  update public.channel_inbox set status='running' where id=repeat('a',64);
  update public.channel_inbox set status='done' where id=repeat('a',64);
  denied:=false;
  begin update public.channel_inbox set status='queued' where id=repeat('a',64);
  exception when check_violation then denied:=true; end;
  assert denied, 'terminal message replay was accepted';

  update public.channel_links set last_inbound_at=clock_timestamp(),prefs='{"brief":false}' where id=link_id;
  assert (select binding_version=0 from public.channel_links where id=link_id), 'nonidentity update changed epoch';
  update public.channel_links set account_id=b where id=link_id;
  update public.channel_links set account_id=a where id=link_id;
  assert (select binding_version=2 from public.channel_links where id=link_id), 'ABA rebind was not versioned';
  update public.channel_links set meta='{"team_id":"routing-changed"}' where id=link_id;
  assert (select binding_version=3 from public.channel_links where id=link_id), 'routing change was not versioned';
  denied:=false;
  begin update public.channel_links set binding_version=0 where id=link_id;
  exception when check_violation then denied:=true; end;
  assert denied, 'caller rewound binding version';
  denied:=false;
  begin update public.channel_links set id=gen_random_uuid() where id=link_id;
  exception when check_violation then denied:=true; end;
  assert denied, 'link ID rewritten';
  saved:=public.accept_channel_inbound(repeat('b',64),e||jsonb_build_object('externalMsgId','m2'));
  assert saved->'binding'->>'contextGeneration'='1' and saved->'binding'->>'bindingVersion'='3', 'new message missed current context';
  saved:=public.accept_channel_inbound(repeat('3',64),jsonb_build_object('channel','telegram','externalId','canary-device','externalMsgId','button1','action','ap:example:why'));
  assert saved->'binding'->>'kind'='linked', 'textless approval button lost its sender';
  insert into public.channel_links(account_id,user_id,channel,external_id,verified_at)
    values(b,owner_id,'apple','canary-apple',clock_timestamp());
  saved:=public.accept_channel_inbound(repeat('4',64),jsonb_build_object('channel','apple','externalId','canary-apple','externalMsgId','closed1','lifecycle','conversation_closed'));
  assert saved->'binding'->>'kind'='linked', 'textless lifecycle opt-out lost its sender';

  e:=jsonb_build_object('channel','sms','externalId','canary-unknown','externalMsgId','unknown1','text','hello');
  saved:=public.accept_channel_inbound(repeat('c',64),e);
  assert saved->'binding'->>'kind'='unlinked', 'unknown sender was assigned';
  insert into public.channel_links(account_id,user_id,channel,external_id,verified_at)
    values(b,owner_id,'sms','canary-unknown',clock_timestamp());
  again:=public.accept_channel_inbound(repeat('c',64),e);
  assert again->'binding'=saved->'binding', 'unknown arrival inherited a later link';
  saved:=public.accept_channel_inbound(repeat('d',64),e||jsonb_build_object('externalMsgId','unknown2','accountScope',a));
  assert saved->'binding'->>'kind'='unlinked', 'pilot scope bypass';

  insert into public.channel_links(account_id,user_id,channel,external_id,verified_at,meta)
    values(b,owner_id,'slack','canary-slack-user',clock_timestamp(),'{"team_id":"workspace-a"}');
  e:=jsonb_build_object('channel','slack','externalId','canary-slack-user','externalMsgId','slack1','scopeId','workspace-b','text','hello');
  saved:=public.accept_channel_inbound(repeat('e',64),e);
  assert saved->'binding'->>'kind'='unlinked', 'workspace scope bypass';
  saved:=public.accept_channel_inbound(repeat('f',64),e||jsonb_build_object('externalMsgId','slack2','scopeId','workspace-a'));
  assert saved->'binding'->>'kind'='linked', 'correct workspace was not captured';

  denied:=false;
  begin insert into public.channel_links(account_id,user_id,channel,link_code,link_code_expires_at)
    values(a,owner_id,'sms','UNC-ABC234',clock_timestamp()+interval '10 minutes');
  exception when check_violation then denied:=true; end;
  assert denied, 'unbound pending code accepted';
  denied:=false;
  begin insert into public.channel_links(account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(a,owner_id,'sms','UNC-ABC234',0,clock_timestamp()+interval '10 minutes');
  exception when check_violation then denied:=true; end;
  assert denied, 'stale pending code accepted';
  insert into public.channel_links(id,account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(pending_id,a,owner_id,'sms','UNC-ABC234',1,clock_timestamp()+interval '10 minutes');
  e:=jsonb_build_object('channel','sms','externalId','new-device','externalMsgId','code1','text',' /start unc-abc234 ');
  saved:=public.accept_channel_inbound(repeat('1',64),e);
  assert saved->'binding'->>'kind'='link_code' and saved->'binding'->>'linkId'=pending_id::text
    and saved->'binding'->>'contextGeneration'='1', 'pending handshake was not bound';
  update public.accounts set context_generation=2 where id=a;
  saved:=public.accept_channel_inbound(repeat('2',64),e||jsonb_build_object('externalMsgId','code2'));
  assert saved->'binding'->>'kind'='unlinked', 'pre-reset code gained post-reset authority';
  update public.channel_links set link_code='UNC-DEF234',link_code_generation=2 where id=pending_id;
  select binding_version into epoch from public.channel_links where id=pending_id;
  assert epoch=1, 'reissue was not versioned';
  update public.channel_links set external_id='new-device',verified_at=clock_timestamp(),link_code=null,link_code_expires_at=null where id=pending_id;
  assert (select link_code_generation is null and binding_version>epoch from public.channel_links where id=pending_id), 'consume did not clear/version code context';
  insert into public.channel_links(account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(b,owner_id,'sms','UNC-EXP234',0,clock_timestamp()-interval '1 minute');
  saved:=public.accept_channel_inbound(repeat('5',64),e||jsonb_build_object('externalMsgId','expired-code','text','UNC-EXP234'));
  assert saved->'binding'->>'kind'='unlinked', 'expired code granted a captured account';

  -- Only legacy unbound rows are quarantined; claims retain their ORIGINAL binding.
  insert into public.channel_inbox(id,channel,event,status,created_at)
    values('legacy','sms',e,'queued',clock_timestamp()-interval '1 day');
  loop
    claimed:=public.claim_channel_inbound();
    exit when claimed is null;
    assert claimed->>'id'<>'legacy' and claimed->'binding' is not null, 'unbound legacy row claimed';
    n:=n+1;
    assert n<20, 'claim loop repeated running work';
  end loop;
  assert n=10, 'unexpected captured claim count';
  assert (select status='uncertain' from public.channel_inbox where id='legacy'), 'legacy ingress not quarantined';
  assert public.claim_channel_inbound() is null, 'claimed rows were replayed';
  update public.channel_inbox set updated_at=clock_timestamp()-interval '11 minutes' where status='running';
  assert public.claim_channel_inbound() is null, 'uncertain send was replayed';
  assert not exists(select 1 from public.channel_inbox where status='running'), 'stranded claim not quarantined';

  assert not has_function_privilege('anon','public.accept_channel_inbound(text,jsonb)','EXECUTE'), 'anonymous ingress RPC access';
  assert not has_function_privilege('authenticated','public.accept_channel_inbound(text,jsonb)','EXECUTE'), 'client ingress RPC access';
  assert not has_function_privilege('authenticated','public.claim_channel_inbound()','EXECUTE'), 'client claim RPC access';
  -- Inspect the catalog without giving service_role USAGE on the trigger-only schema.
  assert not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ((ns.nspname='public' and p.proname in ('accept_channel_inbound','claim_channel_inbound'))
        or (ns.nspname='unc_private' and p.proname in ('version_channel_link','guard_channel_inbox_identity')))
      and p.prosecdef), 'unexpected security definer';
end;
$$;
select 'PASS: immutable ingress, link revisions, code generations, tenant/workspace scope, claim and role denial' as channel_identity_canary;
rollback;
