/** Exact routed inbox/control/outbox/command SQL on real local PostgreSQL.
 * Synthetic fixtures; no provider calls, env files, production DB or messages. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.'))throw Error('Explicit isolated dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'unc-slack-pipeline-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55450,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const table=(source,name)=>{const m=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));if(!m)throw Error(name);return m[0];};
const fn=(source,name)=>{const m=source.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.','\\.')}\\([\\s\\S]*?\\$\\$;`));if(!m)throw Error(name);return m[0];};
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase('pipeline');
  for(let i=0;i<3;i++){const c=cluster.getPgClient('pipeline','127.0.0.1');await c.connect();await c.query("set statement_timeout='6s'");clients.push(c);}
  const [admin,a,b]=clients;
  const base=await sql('0001_init.sql'),channels=await sql('0012_channels.sql');
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema unc_private;create table auth.users(id uuid primary key);
    ${['accounts','account_members','routine_runs','chat_messages'].map(t=>table(base,t)).join('\n')}
    ${['channel_links','outbound_messages','channel_secrets'].map(t=>table(channels,t)).join('\n')}
    ${table(await sql('0010_client_brain.sql'),'account_profiles')}
    alter table accounts add column context_generation bigint not null default 0,add column automation_paused boolean not null default false;
    alter table routine_runs add column context_generation bigint not null default 0;
    alter table chat_messages add column context_generation bigint not null default 0,add column external_scope text not null default '',
      add column thread text not null default 'corner',add column position integer,add column meta jsonb not null default '{}',
      add column channel text not null default 'app',add column external_msg_id text,add column delivery jsonb not null default '{}';
    create unique index chat_position_test on chat_messages(account_id,context_generation,thread,position);
    grant usage on schema public,auth,unc_private to service_role;
    grant select,insert,update,delete on all tables in schema public to service_role;`);
  await admin.query(await sql('20260904011301_routine_command_queue.sql'));
  await admin.query('alter table routine_commands add column context_generation bigint not null default 0');
  await admin.query(fn(await sql('20260905032814_account_automation_pause.sql'),'unc_private.guard_automation_pause'));
  for(const t of ['outbound_messages','routine_commands'])await admin.query(`create trigger account_automation_pause before insert or update or delete on ${t} for each row execute function unc_private.guard_automation_pause()`);
  for(const name of ['20260905053820_channel_inbox_identity.sql','20260905054958_channel_inbound_controls.sql',
    '20260905065409_channel_outbound_claims.sql','20260905071413_command_delivery_identity.sql',
    '20260905220557_slack_conversation_registry.sql','20260905221238_slack_routed_inbox.sql',
    '20260905222650_slack_route_owner_setup.sql'])await admin.query(await sql(name));
  await admin.query('create trigger command_context before insert or update on routine_commands for each row execute function unc_private.guard_command_context()');
  const accountA=randomUUID(),accountB=randomUUID(),owner=randomUUID(),identity=randomUUID();
  await admin.query('insert into auth.users values($1)',[owner]);
  await admin.query("insert into accounts(id,name) values($1,'Synthetic A'),($2,'Synthetic B')",[accountA,accountB]);
  await admin.query("insert into account_members(account_id,user_id,role) values($1,$3,'owner'),($2,$3,'owner')",[accountA,accountB,owner]);
  await admin.query(`insert into channel_links(id,account_id,user_id,channel,external_id,verified_at,meta)
    values($1,$2,$3,'slack','U1',now(),'{"team_id":"T1","bot_user_id":"UBOT"}')`,[identity,accountA,owner]);
  await a.query('set role service_role');await b.query('set role service_role');
  async function register(accountId,conversationId){
    const input={accountId,actorId:owner,contextGeneration:0,identityLinkId:identity,identityLinkVersion:0,workspaceId:'T1',conversationId};
    const evidence={workspaceId:'T1',conversationId,botUserId:'UBOT',isMember:true,isArchived:false,isShared:false,verifiedAt:new Date().toISOString()};
    const r=(await a.query('select stage_slack_conversation_route($1,$2) r',[input,evidence])).rows[0].r;
    // Local fixture activation only. Production routes remain staged.
    await admin.query("update unc_slack_private.conversation_routes set state='active' where id=$1",[r.id]);return r;
  }
  const ra=await register(accountA,'CA');await register(accountB,'CB');
  const ownerView=(accountId=accountB,actorId=owner,contextGeneration=0)=>a.query('select slack_route_owner_view($1) r',[
    {accountId,actorId,contextGeneration}]).then(q=>q.rows[0].r);
  const setup=await ownerView();
  assert.equal(setup.identities.length,1);assert.equal(setup.identities[0].identityLinkId,identity);
  assert.equal(setup.identities[0].credentialStored,false);assert.equal(setup.routes.length,1);
  assert.equal(setup.routes[0].conversationId,'CB');assert.equal(setup.routes[0].bindingCurrent,true);
  assert.equal(setup.activationAvailable,false);assert.equal(setup.executedAction,'none');
  await admin.query("insert into channel_secrets(account_id,channel,scope_id,ciphertext,iv,tag) values($1,'slack','T1','synthetic-not-a-token','synthetic','synthetic')",[accountA]);
  assert.equal((await ownerView()).identities[0].credentialStored,true);
  assert.equal(JSON.stringify(await ownerView()).includes('synthetic-not-a-token'),false);
  await assert.rejects(ownerView(accountB,randomUUID()),{code:'42501'});
  await assert.rejects(ownerView(accountB,owner,1),{code:'PT409'});
  await assert.rejects(a.query('select slack_route_owner_view($1)',[{accountId:accountB,actorId:owner,contextGeneration:0,token:'forged'}]),{code:'22023'});
  checks.push('owner readback reuses one direct identity across clients, returns only target routes, rejects foreign owner/stale context, never exposes tokens or activation');
  function event(room,ts='1756800001.000001',text='run the keyword routine'){
    return {channel:'slack',externalId:'U1',scopeId:'T1',conversationId:room,threadId:'1756800000.000099',externalMsgId:`${room}:${ts}`,text};
  }
  const accept=(e,c=a)=>c.query('select accept_channel_inbound($1,$2) r',[
    createHash('sha256').update(JSON.stringify([e.channel,e.scopeId,e.externalId,e.externalMsgId])).digest('hex'),e]).then(q=>q.rows[0].r);
  const verify=(row,e=row.event)=>a.query('select verify_channel_inbound_binding($1,$2,false) r',[row.binding,e]).then(q=>q.rows[0].r);
  const [first,duplicate]=await Promise.all([accept(event('CA')),accept(event('CA'),b)]);
  assert.deepEqual(first,duplicate);
  const second=await accept(event('CB'));
  assert.equal(first.binding.accountId,accountA);assert.equal(second.binding.accountId,accountB);
  assert.notEqual(first.binding.linkId,second.binding.linkId);assert.notEqual(first.binding.linkId,identity);
  assert.equal((await admin.query('select account_id from channel_links where id=$1',[identity])).rows[0].account_id,accountA);
  assert.equal((await admin.query('select count(*)::int n from channel_links')).rows[0].n,3);
  assert.equal((await ownerView()).identities.length,1);
  assert.equal((await accept(event('CUNKNOWN'))).binding.kind,'unlinked');
  const missingOrigin=event('CA','1756800002.000001');delete missingOrigin.conversationId;
  assert.equal((await accept(missingOrigin)).binding.kind,'unlinked');
  const foreignScope={...event('CA','1756800003.000001'),accountScope:accountB};
  assert.equal((await accept(foreignScope)).binding.kind,'unlinked');
  const code=await accept(event('CB','1756800004.000001','UNC-ABC234'));
  assert.equal(code.binding.kind,'linked');assert.equal(code.binding.accountId,accountB);
  checks.push('durable two-client capture, concurrent dedupe, room code cannot transfer identity, unknown/missing room never falls back to DM account');
  await verify(first);await verify(second);
  await assert.rejects(verify(first,second.event),{code:'40001'});
  await admin.query("update channel_inbox set status='running' where id=$1",[first.id]);
  const control=(await a.query('select apply_channel_inbound_control($1) r',[first.id])).rows[0].r;
  assert.equal(control.kind,'opened');assert.equal(control.link.account_id,accountA);
  await assert.rejects(admin.query("update channel_inbox set event=jsonb_set(event,'{threadId}','\"1756800009.000001\"') where id=$1",[first.id]),{code:'23514'});
  checks.push('claimed control retains client identity; cross-room verification and rewriting saved thread are denied');
  const binding=row=>({...row.binding,channel:'slack',externalId:'U1',scopeId:'T1',conversationId:row.event.conversationId,threadId:row.event.threadId});
  const enqueue=(row,ref)=>a.query('select enqueue_channel_outbound($1) r',[{binding:binding(row),kind:'reply',ref,payload:{text:'Synthetic result only'},appendThread:true,
    replyContext:{live:true,inReplyTo:row.event.externalMsgId,conversationId:row.event.conversationId,threadId:row.event.threadId}}]).then(q=>q.rows[0].r);
  const out=await enqueue(first,'inbound:'+first.id), attempt=randomUUID();
  const claim=(await a.query('select claim_channel_outbound($1,$2) r',[out.id,attempt])).rows[0].r;
  assert.equal(claim.claimed,true);assert.equal(claim.link.slack_route_id,ra.id);assert.equal(claim.row.binding.threadId,first.event.threadId);
  await a.query("select finish_channel_outbound($1,$2,'sent','CA:1756800005.000001')",[out.id,attempt]);
  const projected=(await a.query('select project_channel_outbound($1) r',[out.id])).rows[0].r;
  const history=(await admin.query('select * from chat_messages where id=$1',[projected])).rows[0];
  assert.deepEqual(history.delivery.slack_origin,{workspaceId:'T1',conversationId:'CA',threadId:first.event.threadId});
  assert.equal((await a.query('select claim_channel_outbound($1,$2) r',[out.id,randomUUID()])).rows[0].r.claimed,false);
  checks.push('outbox claim carries same room/thread, synthetic acceptance projects matching origin, completed operation cannot resend');
  const command=randomUUID();
  await a.query(`insert into routine_commands(id,account_id,user_id,channel,request_id,link_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply,channel_binding)
    values($1,$2,$3,'slack',$4,$5,'local-only','D03-W01','local-spec','local-workflow',1,'keyword please','queued','Queued',$6)`,
    [command,accountB,owner,second.event.externalMsgId,second.binding.linkId,binding(second)]);
  await a.query("update routine_commands set status='done',reply='Synthetic saved result' where id=$1",[command]);
  const prepared=(await a.query('select prepare_command_notification($1,1) r',[command])).rows[0].r;
  assert.equal(prepared.operation.account_id,accountB);assert.equal(prepared.operation.binding.conversationId,'CB');
  assert.equal(prepared.operation.reply_context.threadId,second.event.threadId);
  assert.equal((await a.query('select claim_channel_outbound($1,$2) r',[prepared.operation.id,randomUUID()])).rows[0].r.claimed,true);
  checks.push('queued command and asynchronous notification retain the second client room and original thread');
  const pending=await enqueue(first,'pending-before-route-change');
  await admin.query("update unc_slack_private.conversation_routes set state='active' where id=$1",[ra.id]);
  await assert.rejects(verify(first),{code:'40001'});
  const cancelled=(await a.query('select claim_channel_outbound($1,$2) r',[pending.id,randomUUID()])).rows[0].r;
  assert.equal(cancelled.claimed,false);assert.equal(cancelled.row.status,'cancelled');
  const fresh=await accept(event('CA','1756800010.000001'));
  assert.equal(fresh.binding.linkId,first.binding.linkId);assert.ok(fresh.binding.bindingVersion>first.binding.bindingVersion);
  await verify(fresh);
  const replay=await accept(first.event);
  assert.equal(replay.id,first.id);assert.deepEqual(replay.binding,first.binding);assert.deepEqual(replay.event,first.event);
  await assert.rejects(verify(first),{code:'40001'});
  checks.push('route revision cancels queued delivery; fresh event captures new revision while old ingress never rebinds');
  await admin.query('delete from account_members where account_id=$1 and user_id=$2',[accountB,owner]);
  await assert.rejects(ownerView(),{code:'42501'});
  await assert.rejects(verify(second),{code:'40001'});
  assert.equal((await accept(event('CB','1756800011.000001'))).binding.kind,'unlinked');
  await admin.query("update channel_links set meta=meta||'{\"refresh_test\":true}' where id=$1",[identity]);
  await assert.rejects(verify(fresh),{code:'40001'});
  assert.equal((await ownerView(accountA)).routes[0].bindingCurrent,false);
  await assert.rejects(admin.query('update channel_links set slack_route_id=null where id=$1',[fresh.binding.linkId]),{code:'23514'});
  checks.push('membership removal and OAuth identity revision invalidate existing captured routes; routed links cannot become direct identities');
  for(const role of ['anon','authenticated']){
    await b.query(`set role ${role}`);
    await assert.rejects(b.query('select accept_channel_inbound($1,$2)',['a'.repeat(64),first.event]),{code:'42501'});
    await assert.rejects(b.query('select verify_channel_inbound_binding($1,$2,false)',[first.binding,first.event]),{code:'42501'});
    await assert.rejects(b.query('select enqueue_channel_outbound($1)',[{}]),{code:'42501'});
    await assert.rejects(b.query('select slack_route_owner_view($1)',[{}]),{code:'42501'});
  }
  const security=(await admin.query(`select not prosecdef invoker_only,proconfig @> array['search_path=""']::text[] pinned_path,
    has_function_privilege('service_role',oid,'EXECUTE') server_allowed,
    has_function_privilege('anon',oid,'EXECUTE') anon_allowed,has_function_privilege('authenticated',oid,'EXECUTE') member_allowed
    from pg_proc where oid='public.slack_route_owner_view(jsonb)'::regprocedure`)).rows[0];
  assert.deepEqual(security,{invoker_only:true,pinned_path:true,server_allowed:true,anon_allowed:false,member_allowed:false});
  checks.push('owner view security catalog confirms invoker execution, pinned search path and service-only execute grants; only credential-presence boolean is exposed');
  console.log(JSON.stringify({status:'PASS',checks,providerCalls:0,customerMessages:0,productionChanges:0,database:directory},null,2));
} finally {await Promise.all(clients.map(c=>c.end()));await cluster.stop();}
