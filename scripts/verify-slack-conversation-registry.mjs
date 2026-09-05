/** Real isolated PostgreSQL, exact migration, synthetic identities only. No env/provider access. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dependencyDir=process.argv[2];
if(!dependencyDir?.startsWith('/tmp/unc-manual-pg.')) throw Error('Explicit isolated PostgreSQL dependency directory required');
const dependencies=createRequire(join(dependencyDir,'package.json'));
const {default:EmbeddedPostgres}=await import(dependencies.resolve('embedded-postgres'));
const directory=await mkdtemp(join(tmpdir(),'unc-slack-routes-pg-'));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',
  port:55449,persistent:true,createPostgresUser:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
const clients=[], checks=[];
const accountA=randomUUID(), accountB=randomUUID(), owner=randomUUID(), outsider=randomUUID(), link=randomUUID(), strangerLink=randomUUID();
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const table=(source,name)=>{const m=source.match(new RegExp(`create table ${name} \\([\\s\\S]*?\\n\\);`));if(!m)throw Error('Missing table '+name);return m[0];};
try {
  await cluster.initialise();await cluster.start();await cluster.createDatabase('slack_routes');
  for(let i=0;i<3;i++){const c=cluster.getPgClient('slack_routes','127.0.0.1');await c.connect();await c.query("set statement_timeout='5s'");clients.push(c);}
  const [admin,server,peer]=clients;
  const base=await sql('0001_init.sql'), channels=await sql('0012_channels.sql');
  await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    ${['accounts','account_members'].map(t=>table(base,t)).join('\n')}
    ${table(channels,'channel_links')}
    alter table accounts add column context_generation bigint not null default 0,add column automation_paused boolean not null default false;
    alter table channel_links add column binding_version bigint not null default 0;
    grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;`);
  await admin.query(await sql('20260905220557_slack_conversation_registry.sql'));
  await admin.query('insert into auth.users values($1),($2)',[owner,outsider]);
  await admin.query("insert into accounts(id,name) values($1,'Local A'),($2,'Local B')",[accountA,accountB]);
  await admin.query("insert into account_members(account_id,user_id,role) values($1,$3,'owner'),($2,$3,'owner'),($1,$4,'member')",[accountA,accountB,owner,outsider]);
  await admin.query(`insert into channel_links(id,account_id,user_id,channel,external_id,verified_at,meta)
    values($1,$2,$3,'slack','U1',now(),'{"team_id":"T1","bot_user_id":"UBOT"}'),
    ($4,$2,$5,'slack','U2',now(),'{"team_id":"T1","bot_user_id":"UBOT"}')`,[link,accountA,owner,strangerLink,outsider]);
  await server.query('set role service_role');await peer.query('set role service_role');
  const request=(accountId,conversationId)=>({accountId,contextGeneration:0,actorId:owner,identityLinkId:link,identityLinkVersion:0,workspaceId:'T1',conversationId});
  const evidence=r=>({workspaceId:r.workspaceId,conversationId:r.conversationId,botUserId:'UBOT',isMember:true,isArchived:false,isShared:false,verifiedAt:new Date().toISOString()});
  const stage=(r,e=evidence(r),c=server)=>c.query('select public.stage_slack_conversation_route($1,$2) r',[r,e]).then(q=>q.rows[0].r);
  const resolve=(conversationId,externalId='U1',workspaceId='T1')=>server.query('select public.resolve_slack_conversation_route($1) r',[{workspaceId,conversationId,externalId}]).then(q=>q.rows[0].r);
  const a=request(accountA,'CA'),b=request(accountB,'CB');
  const ra=await stage(a), rb=await stage(b);
  assert.equal(ra.state,'staged');assert.equal(rb.state,'staged');assert.equal(await resolve('CA'),null);
  assert.deepEqual(await stage(a),ra);
  assert.equal((await admin.query('select account_id from channel_links where id=$1',[link])).rows[0].account_id,accountA);
  checks.push('two clients share verified sender identity without moving OAuth link; staged routes refuse execution; repeat staging is idempotent');
  await assert.rejects(stage({...a,accountId:accountB}),{code:'PT409'});
  await assert.rejects(stage({...a,actorId:outsider,identityLinkId:strangerLink}),{code:'42501'});
  await assert.rejects(stage({...a,contextGeneration:1}),{code:'PT409'});
  await assert.rejects(stage({...a,identityLinkVersion:1}),{code:'42501'});
  for(const patch of [{isMember:false},{isArchived:true},{isShared:true},{isShared:null},{botUserId:'UOTHER'},{workspaceId:'T2'},
    {verifiedAt:new Date(Date.now()-360000).toISOString()},{verifiedAt:new Date(Date.now()+60000).toISOString()}])
    await assert.rejects(stage(a,{...evidence(a),...patch}),{code:'42501'});
  checks.push('cross-client overwrite, non-owner, stale generation/link and invalid provider evidence are refused');
  const cc=request(accountA,'CC');
  const [first,second]=await Promise.all([stage(cc),stage(cc,evidence(cc),peer)]);
  assert.equal(first.id,second.id);
  checks.push('concurrent registration converges on one unchanged staged route');
  // Test fixture activation only: no production activation endpoint exists yet.
  await admin.query("update unc_slack_private.conversation_routes set state='active' where id=any($1::uuid[])",[[ra.id,rb.id]]);
  assert.equal((await resolve('CA')).accountId,accountA);assert.equal((await resolve('CB')).accountId,accountB);
  assert.equal((await resolve('CA')).routeRevision,1);
  assert.equal(await resolve('CUNKNOWN'),null);assert.equal(await resolve('CA','U1','T2'),null);
  assert.equal(await resolve('CB','U2'),null);assert.equal((await resolve('CA','U2')).userId,outsider);
  checks.push('same sender resolves correct channel client; wrong workspace/room and unentitled sender return no identity');
  await admin.query('delete from account_members where account_id=$1 and user_id=$2',[accountA,outsider]);
  assert.equal(await resolve('CA','U2'),null);
  await admin.query('update channel_links set binding_version=1 where id=$1',[link]);
  assert.equal(await resolve('CA'),null);assert.equal(await resolve('CB'),null);
  await admin.query('update channel_links set binding_version=0 where id=$1',[link]);
  await admin.query('update accounts set automation_paused=true where id=$1',[accountA]);
  assert.equal(await resolve('CA'),null);assert.equal((await resolve('CB')).accountId,accountB);
  await admin.query('update accounts set automation_paused=false,context_generation=1 where id=$1',[accountA]);
  assert.equal(await resolve('CA'),null);
  await admin.query("update unc_slack_private.conversation_routes set state='revoked' where id=$1",[rb.id]);
  assert.equal(await resolve('CB'),null);
  await assert.rejects(admin.query("update unc_slack_private.conversation_routes set state='active' where id=$1",[rb.id]),{code:'23514'});
  await assert.rejects(admin.query('update unc_slack_private.conversation_routes set account_id=$1 where id=$2',[accountB,ra.id]),{code:'23514'});
  checks.push('membership removal, OAuth rebind, account pause/reset and route revocation invalidate resolution; route identity is immutable');
  for(const role of ['anon','authenticated']){
    await peer.query(`set role ${role}`);
    await assert.rejects(peer.query('select public.slack_route_preflight($1)',[a]),{code:'42501'});
    await assert.rejects(peer.query('select public.stage_slack_conversation_route($1,$2)',[a,evidence(a)]),{code:'42501'});
    await assert.rejects(peer.query('select public.resolve_slack_conversation_route($1)',[{workspaceId:'T1',conversationId:'CA',externalId:'U1'}]),{code:'42501'});
    await assert.rejects(peer.query('select * from unc_slack_private.conversation_routes'),{code:'42501'});
  }
  const security=(await admin.query(`select bool_and(not p.prosecdef) invoker_only from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='unc_slack_private' or p.proname in ('slack_route_preflight','stage_slack_conversation_route','resolve_slack_conversation_route')`)).rows[0];
  assert.equal(security.invoker_only,true);
  assert.equal((await admin.query("select relrowsecurity from pg_class where oid='unc_slack_private.conversation_routes'::regclass")).rows[0].relrowsecurity,true);
  checks.push('anon/authenticated RPC and table access denied; service invoker functions and private RLS verified');
  console.log(JSON.stringify({status:'PASS',checks,providerCalls:0,customerMessages:0,productionChanges:0,database:directory},null,2));
} finally {await Promise.all(clients.map(c=>c.end()));await cluster.stop();}
