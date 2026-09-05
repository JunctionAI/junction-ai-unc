/** Deployed compiled code + no-authority SQL refusal. No permits or provider calls. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),cli='/Users/tomhall-taylor/.fly/bin/flyctl',app='unc-worker',machine='1857466fd76998';
const expected=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(expected??''))throw Error('Expected complete source SHA required');
const flags=['UNC_COMMANDS_ENABLED','UNC_MESSAGING_ENABLED','LIVE_MODE_ENABLED','TNZ_SMS_ENABLED','APPLE_MESSAGES_ENABLED'];
const run=async args=>(await exec(cli,args,{timeout:45000,maxBuffer:1048576})).stdout;
let stage='machine-before';
try{
  const before=JSON.parse(await run(['status','-a',app,'--json'])),m=before.Machines?.[0];
  if(before.Machines?.length!==1||m.id!==machine||m.state!=='started'||flags.some(k=>m.config.env[k]!=='false'))throw Error();
  const source=`let stage='compiled-build',sqlCode=null;const finish=r=>process.stdout.write(JSON.stringify(r)+'\\n',()=>process.exit(r.status==='PASS'?0:1));const deadline=setTimeout(()=>finish({status:'FAIL',stage,sqlCode}),25000);(async()=>{
    const assert=require('node:assert/strict');assert.equal(process.env.UNC_BUILD_SHA,${JSON.stringify(expected)});
    for(const key of ${JSON.stringify(flags)})assert.equal(process.env[key],'false');
    for(const key of ['UNC_DATA_SYNC_ENABLED','UNC_DATA_SYNC_ACCOUNTS','UNC_STORED_DATA_ACCOUNTS','N8N_CALENDAR_SHADOW_RECEIVER_URL','N8N_CALENDAR_SHADOW_WORKFLOW_ID'])assert.ok(!process.env[key]||process.env[key]==='false');
    const {calendarScope}=require('/app/dist/worker/lib/n8n/calendarAdmission.js');
    for(const [module,name] of [['completeCalendarShadow','completeCalendarShadowRun'],['reconcileCalendarShadow','reconcileCalendarShadowArchive'],['runCalendarShadow','runCalendarShadow']])assert.equal(typeof require('/app/dist/worker/worker/'+module+'.js')[name],'function');
    const scope=calendarScope({accountId:'aa5cfc84-2569-4c99-9b40-67003ae55eda',contextGeneration:1,runId:'00000000-0000-4000-8000-000000000001'});
    stage='database-client';const db=require('/app/dist/worker/worker/wiring.js').serviceDb();assert.ok(db);
    stage='account-read';
    const account=await db.from('accounts').select('context_generation,automation_paused').eq('id',scope.accountId).single();
    assert.equal(account.error,null);assert.equal(account.data.context_generation,1);assert.equal(account.data.automation_paused,true);
    const empty=async()=>{for(const table of ['n8n_calendar_bindings','n8n_calendar_runs']){const r=await db.from(table).select('id').limit(1);assert.equal(r.error,null);assert.deepEqual(r.data,[]);}};
    stage='empty-tables-before';await empty();
    stage='missing-permit-refusal';
    const start=await db.rpc('transition_calendar_shadow',{input:{...scope,operation:'start',run:null}});assert.equal(start.error?.code,'P0002');
    stage='paused-completion-refusal';const refusalStarted=Date.now();const complete=await db.rpc('commit_calendar_shadow_completion',{acct:scope.accountId,generation:1,requested_run:scope.runId,packet:null});sqlCode=complete.error?.code??null;assert.equal(sqlCode,'PT409');assert.equal(complete.status,409);const refusalMs=Date.now()-refusalStarted;assert.ok(refusalMs<5000);
    stage='empty-tables-after';await empty();
    clearTimeout(deadline);finish({status:'PASS',checkedAt:new Date().toISOString(),build:process.env.UNC_BUILD_SHA,compiledCalendarModules:true,missingPermitRefused:true,pausedCompletionRefused:true,refusalMs,calendarTablesEmpty:true,externalActionFlagsOff:true,calendarPinsAbsent:true,databaseCalls:7,providerCalls:0,n8nCalls:0,writes:0});
  })().catch(()=>{clearTimeout(deadline);finish({status:'FAIL',stage,sqlCode});});`;
  const encoded=Buffer.from(source).toString('base64');
  stage='ssh-verification';
  const output=await run(['ssh','console','-a',app,'--machine',machine,'--quiet','-C',`node -e 'eval(Buffer.from("${encoded}","base64").toString())'`]);
  const report=JSON.parse(output.trim());if(report.status!=='PASS'){stage='remote:'+String(report.stage).replace(/[^a-z-]/g,'').slice(0,80);throw Error();}
  stage='machine-after';
  const after=JSON.parse(await run(['status','-a',app,'--json'])),last=after.Machines?.find(x=>x.id===machine);
  if(after.Machines?.length!==1||last?.state!=='started'||last.config.image!==m.config.image||flags.some(k=>last.config.env[k]!=='false'))throw Error();
  console.log(JSON.stringify({...report,worker:{app,machine,image:last.config.image,release:last.config.metadata?.fly_release_version}},null,2));
}catch(error){
  try { const remote=JSON.parse(error?.stdout?.trim()); if(remote.status==='FAIL')stage='remote:'+String(remote.stage).replace(/[^a-z-]/g,'').slice(0,80)+':'+String(remote.sqlCode).replace(/[^A-Z0-9]/g,'').slice(0,10); } catch { /* Never expose raw transport data. */ }
  console.error(JSON.stringify({status:'FAIL',stage,transportTimedOut:error?.killed===true,error:'Raw transport output suppressed. No workflow execution requested.'}));process.exitCode=1;
}
