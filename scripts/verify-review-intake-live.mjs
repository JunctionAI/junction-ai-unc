// Real database/private storage, local HTTP callback. Synthetic asset, no Grok/provider run.
import {createServer as createViteServer} from 'vite';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const accountId='55a377a5-c12e-4de6-a085-0d9a50ccd488',actor='7371b18c-55a3-4b40-8231-33035e506b80';
const outputId='1a5273d2-f2a3-4b0b-a1c8-85a6175c24e1',grantId='b06ed3a4-fb9b-46a7-b1cc-11917c692e33';
const artifactId='f47ede89-947a-47e0-9e72-cfc42d9699ee',sourceRunId='5495cad8-e082-42df-b91e-c8196f69ae54';
assert.equal(process.env.REVIEW_INTAKE_TEST_GO,grantId);
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname,'ycgayfsvcjpsnryrpukv.supabase.co');
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function checked(query){const r=await query;if(r.error)throw new Error(`Database refused (${r.error.code||'unknown'})`);return r.data;}
const account=await checked(db.from('accounts').select('name,automation_paused,context_generation,monthly_llm_cap_usd').eq('id',accountId).single());
assert.equal(account.name,'Junction TEST — Review sandbox');assert.equal(account.automation_paused,true);assert.equal(account.context_generation,0);assert.equal(Number(account.monthly_llm_cap_usd),0);
assert.equal((await checked(db.from('receipts').select('id').eq('id',grantId))).length,0,'Reconcile existing grant instead of rerunning');
assert.equal((await checked(db.from('review_outputs').select('id').eq('id',outputId))).length,0);
for(const table of ['connectors','routine_states'])assert.equal((await checked(db.from(table).select('account_id').eq('account_id',accountId).limit(1))).length,0);
const artifact=await checked(db.from('artifacts').select('run_id').eq('id',artifactId).eq('account_id',accountId).single());assert.equal(artifact.run_id,sourceRunId);
const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createViteServer({configFile:false,root,resolve:{alias:{'@':`${root}src`}},optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
let server;
try{
 const load=path=>vite.ssrLoadModule(`/@fs/${root}src/lib/${path}.ts`);
 const {issueReviewIntakeGrant,readReviewIntakeGrant,receiveReviewOutput}=await load('artifacts/reviewIntake');
 const {reviewStorage,uploadReviewMedia}=await load('artifacts/reviewStorage');
 const {registerReviewOutput}=await load('artifacts/reviewProducer');
 const {assertRuntimeContext}=await load('db/runtimeContext');
 const output={ref:{accountId,artifactId,outputId,revision:0},kind:'email',sectionIds:['hero'],durationSeconds:null};
 const bytes=new Uint8Array(await readFile('/Users/tomhall-taylor/Documents/Junction AI 2/outputs/junction-taste-gate-demo-2026-09-09/assets/email-carry.png'));
 const storage=reviewStorage(db),uploaded=await uploadReviewMedia(output,0,'image','png',bytes,storage);
 const secret=randomBytes(32).toString('base64url'),now=Date.now();
 const grant={id:grantId,workerId:'LOCAL HTTP TEST — not Grok',contextGeneration:0,sourceRunId,output,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()};
 // Existing runtime receipt guard requires issuance while active. Cap stays zero;
 // no routines/connectors exist. Restore before processing the callback itself.
 let auth;
 try{
  const changed=await checked(db.from('accounts').update({automation_paused:false}).eq('id',accountId).eq('context_generation',0).eq('automation_paused',true).eq('monthly_llm_cap_usd',0).select('id'));
  assert.equal(changed.length,1);auth=await issueReviewIntakeGrant(db,grant,secret);
 }finally{await checked(db.from('accounts').update({automation_paused:true}).eq('id',accountId));}
 const deps={enabled:true,secret,resolve:id=>readReviewIntakeGrant(db,id),released:id=>id===accountId,
  checkContext:g=>assertRuntimeContext(db,{accountId:g.output.ref.accountId,contextGeneration:g.contextGeneration},{allowPaused:true}),storage,
  register:(g,content)=>registerReviewOutput(db,{accountId,contextGeneration:0},{output:g.output,sourceRunId:g.sourceRunId,content})};
 server=createServer(async(req,res)=>{try{
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  const request=new Request('http://127.0.0.1/callback',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
  const response=await receiveReviewOutput(request,grantId,deps);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Local intake test failed');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${server.address().port}/callback`;
 const content={title:'Internal demo — rendered email ready for review',body:'Existing demonstration artwork, not a newly generated campaign. Nothing sent or published.',media:{image:uploaded.descriptor}};
 async function post(value,authorization=auth.authorization){return fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(value)});}
 assert.equal((await post({content},'')).status,401);
 assert.equal((await post({content,accountId:'other'})).status,400);
 const first=await post({content});assert.equal(first.status,201);const receipt=await first.json();assert.equal(receipt.executed,false);assert.equal(receipt.outputId,outputId);
 const second=await post({content});assert.equal(second.status,200);assert.equal((await second.json()).duplicate,true);
 assert.equal((await post({content:{...content,title:'Conflicting retry'}})).status,503);
 const saved=await checked(db.rpc('read_review_output',{acct:accountId,generation:0,actor,output:outputId}));assert.equal(saved.output.revision,0);assert.equal(saved.version.content.title,content.title);
 assert.equal((await checked(db.from('review_output_versions').select('revision').eq('output_id',outputId))).length,1);
 const publicRead=await fetch(`${url}/storage/v1/object/public/junction-review-private/${uploaded.path}`,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(publicRead.ok,false);
 console.log(JSON.stringify({status:'PASS',scope:'local authenticated HTTP callback with real test database/private media; no deployed Next route, Grok, generation, Slack or external execution',accountId,grantId,outputId,receipt,media:uploaded.descriptor,publicStatus:publicRead.status}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await vite.close();
 const final=await checked(db.from('accounts').select('automation_paused,monthly_llm_cap_usd').eq('id',accountId).single());assert.equal(final.automation_paused,true);assert.equal(Number(final.monthly_llm_cap_usd),0);
 console.log(JSON.stringify({stage:'unchanged',accountId,paused:true,capUsd:0}));
}
