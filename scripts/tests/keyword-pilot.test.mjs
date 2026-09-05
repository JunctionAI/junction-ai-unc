import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {parsePilotCommand,operatePilot} from '../keyword-pilot.mjs';

const approval=()=>({authorizedBy:'74802c60-149a-4405-b719-dc058d174072',approvalReference:'test:explicit-approval',
  idempotencyKey:'test:US:one',market:'US',contextGeneration:1,maxProviderCalls:1,expiresAt:new Date(Date.now()+300000).toISOString()});
const sha='a'.repeat(40),revision='11111111-1111-1111-1111-111111111111';
const args=['--issue','--approval','original.json','--expected-build',sha,'--expected-revision',revision];
function fixture() {
  const command=parsePilotCommand(args,approval()),calls=[];
  const f={command,calls,row:null,readError:null,runError:null,
    env:{NEXT_PUBLIC_SUPABASE_URL:'https://ycgayfsvcjpsnryrpukv.supabase.co',UNC_BUILD_SHA:sha},
    readiness:{status:'PASS',buildSha:sha,expectedRevision:revision}};
  const query={select:columns=>{assert.equal(columns,'id,run_id,registration_id,status,execution_id,authorized_by,issuance');return query;},
    eq:(k,v)=>{calls.push(['filter',k,v]);return query;},maybeSingle:async()=>({data:f.row,error:f.readError})};
  const db={from:name=>{assert.equal(name,'n8n_shadow_permits');calls.push(['read']);return query;}};
  const modules={
    '/app/dist/worker/worker/wiring.js':{serviceDb:()=>db},
    '/app/dist/worker/worker/issueKeywordShadowPilot.js':{KEYWORD_PILOT_PIN:{workflowVersion:revision},
      keywordPilotContract:a=>{if(Date.parse(a.expiresAt)<=Date.now()) throw Error('Expired');},
      runKeywordShadowPilot:async(deps,a)=>{calls.push(['run']);assert.equal(deps.db,db);assert.equal(deps.producer,null);
        f.row={id:'11111111-1111-1111-1111-111111111111',run_id:'22222222-2222-2222-2222-222222222222',
          registration_id:'33333333-3333-3333-3333-333333333333',status:'verified',execution_id:'90',authorized_by:a.authorizedBy,issuance:{...a}};
        if(f.runError) throw f.runError;
        return {secret:'must not print',artifact:{body:'private customer data'}};
      }},
    '/app/dist/worker/lib/runtime/store/supabase.js':{SupabaseStore:class{}},
    '/app/dist/worker/worker/accounts.js':{DbAccountsSource:class{}},
    'node:util':{isDeepStrictEqual},
  };
  f.load=name=>{assert.ok(Object.hasOwn(modules,name));return modules[name];};
  f.preflight=async()=>{calls.push(['preflight']);return f.readiness;};
  f.run=()=>operatePilot(f.command,f.load,f.env,f.preflight);
  return f;
}

test('explicit command captures exact approval without a default key or expiry',()=>{
  const a=approval(),c=parsePilotCommand(args,a);a.market='NZ';assert.equal(c.approval.market,'US');
  for(const market of ['US','NZ','AU']) assert.equal(parsePilotCommand(args,{...approval(),market}).approval.market,market);
});
for(const [name,mutate] of [
  ['other owner',a=>{a.authorizedBy='another-owner';}],['other generation',a=>{a.contextGeneration=2;}],
  ['multiple calls',a=>{a.maxProviderCalls=3;}],['unknown market',a=>{a.market='all';}],
  ['extra credential field',a=>{a.token='secret';}],['missing key',a=>{delete a.idempotencyKey;}],
]) test(`rejects ${name} before transport`,()=>{const a=approval();mutate(a);assert.throws(()=>parsePilotCommand(args,a));});
test('rejects omitted, duplicate, malformed pins and unknown flags',()=>{
  for(const options of [[],['--issue','--approval','x'],[...args,'--approval','other'],[...args,'--enable','true'],
    args.map(v=>v===sha?'bad':v)]) assert.throws(()=>parsePilotCommand(options,approval()));
});
test('inspect supports expired original approval and never preflights or issues',async()=>{
  const f=fixture();f.command=parsePilotCommand(['--inspect','--approval','x'],{...approval(),expiresAt:'2000-01-01T00:00:00Z'});
  const r=await f.run();assert.equal(r.status,'NOT_FOUND');assert.equal(r.safeToRedispatch,false);
  assert.ok(!f.calls.some(c=>['run','preflight'].includes(c[0])));
  assert.ok(f.calls.some(c=>c[1]==='account_id' && c[2]==='aa5cfc84-2569-4c99-9b40-67003ae55eda'));
});
test('an unreadable lookup cannot become absent or trigger issuance',async()=>{
  const f=fixture();f.readError={message:'private database error'};await assert.rejects(f.run());
  assert.ok(!f.calls.some(c=>c[0]==='run'));
});
for(const reason of ['build','revision','preflight']) test(`blocks ${reason} drift without issuance`,async()=>{
  const f=fixture();if(reason==='build') f.env.UNC_BUILD_SHA='b'.repeat(40);
  if(reason==='revision') f.command.expectedRevision='22222222-2222-2222-2222-222222222222';
  if(reason==='preflight') f.readiness.status='BLOCKED';
  assert.equal((await f.run()).status,'BLOCKED');assert.ok(!f.calls.some(c=>c[0]==='run'));
});
test('expired issue is rejected before preflight/provider',async()=>{
  const f=fixture();f.command.approval.expiresAt='2000-01-01T00:00:00Z';await assert.rejects(f.run());
  assert.ok(!f.calls.some(c=>['run','preflight'].includes(c[0])));
});
test('one issue uses existing worker function and returns only durable identity',async()=>{
  const f=fixture(),r=await f.run();assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
  assert.equal(r.status,'FOUND');assert.equal(r.permitStatus,'verified');assert.equal(r.endToEndProven,false);
  assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('must not print'));
  const second=await f.run();assert.equal(second.runId,r.runId);assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
test('lost reply reads original committed row without repeating provider work',async()=>{
  const f=fixture();f.runError=Error('secret bearer example');const r=await f.run();
  assert.equal(r.status,'RECONCILE_REQUIRED');assert.equal(r.executionId,'90');assert.equal(r.safeToRedispatch,false);
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('a reused key cannot be rebound to another market or approval',async()=>{
  const f=fixture();await f.run();f.command.approval.market='NZ';await assert.rejects(f.run());
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
});
test('wrong database denied before any read or issuance',async()=>{
  const f=fixture();f.env.NEXT_PUBLIC_SUPABASE_URL='https://other.supabase.co';await assert.rejects(f.run());assert.equal(f.calls.length,0);
});
test('serialized operator has no closure dependency',async()=>{
  const f=fixture(),serialized=Function(`return (${operatePilot.toString()})`)();
  f.command.mode='inspect';assert.equal((await serialized(f.command,f.load,f.env,f.preflight)).status,'NOT_FOUND');
});
