// One fixed internal HTTP callback test. No Grok invocation or provider call.
// Credentials supplied by environment injection, never printed or written.
import {createClient} from '@supabase/supabase-js';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const account='55a377a5-c12e-4de6-a085-0d9a50ccd488',id='425a1a25-e4e3-49ee-9430-d250f8f57350';
const origin=new URL(process.argv[2]);
assert.match(origin.hostname,/^junction-[a-z0-9]+-tom-junctionmedis-projects\.vercel\.app$/);
assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'ycgayfsvcjpsnryrpukv.supabase.co');
assert.ok(process.env.JUNCTION_GROK_CONTROL_SECRET?.length>=32);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function checked(q){const r=await q;if(r.error)throw new Error(`Database refused: ${r.error.code}`);return r.data;}
const a=await checked(db.from('accounts').select('name,automation_paused,context_generation,monthly_llm_cap_usd').eq('id',account).single());
assert.equal(a.name,'Junction TEST — Review sandbox');assert.equal(a.automation_paused,true);assert.equal(a.context_generation,0);assert.equal(Number(a.monthly_llm_cap_usd),0);
assert.equal((await checked(db.from('grok_control_records').select('id').eq('id',id))).length,0,'Fixed test already exists: reconcile, do not rerun');
assert.equal((await checked(db.from('routine_states').select('routine_id').eq('account_id',account))).length,0,'Do not overwrite existing test routines');
const state=await checked(db.from('routine_states').insert({account_id:account,routine_id:'D02-W01',enabled:false}).select('updated_at').single());
const change={changeId:id,accountId:account,routineId:'D02-W01',contextGeneration:0,workerId:'http-fixture-not-grok',stateUpdatedAt:state.updated_at,
 enabled:false,schedule:{time:'08:00',timezone:'Pacific/Auckland'},expiresAt:new Date(Date.now()+600000).toISOString()};
await checked(db.from('grok_control_records').insert({id,account_id:account,context_generation:0,kind:'notification',platform:'grok_control_request',description:'Internal HTTP fixture only — no Grok runtime invoked',payload:{change}}));
const token=createHmac('sha256',process.env.JUNCTION_GROK_CONTROL_SECRET).update(`junction-grok-control-v1:${JSON.stringify(change)}`).digest('base64url');
const ack={changeId:id,workerId:change.workerId,status:'blocked',enabled:false,schedule:change.schedule,blocker:'runtime_error'};
const send=(body,auth=token)=>fetch(new URL(`/api/external-agents/control/${id}`,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
assert.equal((await send(ack,'invalid')).status,401);
const response=await send(ack);assert.equal(response.status,201);assert.deepEqual(await response.json(),{saved:true,duplicate:false});
const retry=await send(ack);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),{saved:true,duplicate:true});
assert.equal((await send({...ack,blocker:'skill_missing'})).status,409);
const hex=createHmac('sha256','junction-grok-result-id-v1').update(id).digest('hex');
const resultId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
const result=await checked(db.from('grok_control_records').select('account_id,context_generation,payload').eq('id',resultId).single());
assert.equal(result.account_id,account);assert.equal(result.context_generation,0);assert.deepEqual(result.payload.ack,ack);
const after=await checked(db.from('accounts').select('automation_paused,monthly_llm_cap_usd').eq('id',account).single());
assert.equal(after.automation_paused,true);assert.equal(Number(after.monthly_llm_cap_usd),0);
assert.equal((await checked(db.from('routine_states').select('enabled').eq('account_id',account).eq('routine_id','D02-W01').single())).enabled,false);
console.log(JSON.stringify({status:'PASS',changeId:id,resultId,scope:'real deployed HTTP and database, synthetic blocked acknowledgement; no Grok or provider execution',tests:['invalid auth401','persist201','duplicate200','conflict409','independent database readback'],accountPaused:true,routineEnabled:false}));
