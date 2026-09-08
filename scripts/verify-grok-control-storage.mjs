// Real local SQL + actual transport functions; simulated webhook, no cloud or secrets.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const {PGlite}=await import(pathToFileURL(process.env.REVIEW_PGLITE_MODULE).href);
const db=new PGlite(),vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true},server:{middlewareMode:true}});
let checks=0,calls=0;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to service_role;
 create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean);
 create table routine_states(account_id uuid,routine_id text,enabled boolean,updated_at timestamptz);
 grant select,update on accounts,routine_states to service_role;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908170923_grok_control_records.sql',import.meta.url),'utf8'));
 const account=randomUUID(),changedAt=new Date().toISOString();
 await db.query('insert into accounts values($1,0,true)',[account]);
 await db.query("insert into routine_states values($1,'D02-W01',false,$2)",[account,changedAt]);
 await db.exec('set role service_role');
 const tables=['grok_control_records','accounts','routine_states'];
 const adapter={from(table){assert.ok(tables.includes(table));return {
  async insert(row){try{const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));return {data:null,error:null};}catch(error){return {data:null,error:{code:error.code}};}},
  select(){const filters=[];const q={eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push([k,v]);return q;},async maybeSingle(){try{const r=await db.query(`select * from ${table} where ${filters.map(([k],i)=>k+'=$'+(i+1)).join(' and ')}`,filters.map(([,v])=>v));const row=r.rows[0]?JSON.parse(JSON.stringify(r.rows[0])):null;if(row?.context_generation!==undefined)row.context_generation=Number(row.context_generation);return {data:row,error:null};}catch(error){return {data:null,error:{code:error.code}};}}};return q;},
 };}};
 const {dispatchGrokChange,receiveGrokAck,callbackToken,readGrokChange}=await vite.ssrLoadModule('/src/lib/agents/grokControl.ts');
 const secret='synthetic-local-control-secret-not-production';
 const change={changeId:randomUUID(),accountId:account,routineId:'D02-W01',contextGeneration:0,workerId:'local-fixture',stateUpdatedAt:changedAt,enabled:false,schedule:{time:'08:00',timezone:'Pacific/Auckland'},expiresAt:new Date(Date.now()+300000).toISOString()};
 const config={webhookUrl:'https://api2.cursor.sh/synthetic',webhookKey:'synthetic',callbackOrigin:'https://junction.test',signingSecret:secret};
 const fetcher=async()=>{calls++;return Response.json({accepted:true});};
 assert.equal((await dispatchGrokChange(adapter,change,config,fetcher)).status,'accepted');checks++;
 assert.equal((await dispatchGrokChange(adapter,change,config,fetcher)).status,'already_requested');assert.equal(calls,1);checks++;
 const ack={changeId:change.changeId,workerId:change.workerId,status:'applied',enabled:false,schedule:change.schedule,blocker:null};
 const request=()=>new Request('https://junction.test',{method:'POST',headers:{authorization:'Bearer '+callbackToken(change,secret),'content-type':'application/json'},body:JSON.stringify(ack)});
 assert.equal((await receiveGrokAck(request(),change.changeId,{db:()=>adapter,secret,enabled:true})).status,201);checks++;
 assert.equal((await receiveGrokAck(request(),change.changeId,{db:()=>adapter,secret,enabled:true})).status,200);checks++;
 assert.equal((await readGrokChange(adapter,change.changeId,account)).status,'off');checks++;
 assert.equal((await db.query('select automation_paused from accounts')).rows[0].automation_paused,true);checks++;
 const original=(await db.query("select * from grok_control_records where platform='grok_control_request'")).rows[0];
 async function refused(row){const r=await adapter.from('grok_control_records').insert(row);assert.ok(r.error);checks++;}
 await refused({...original,id:randomUUID(),context_generation:1});
 await db.query('update routine_states set enabled=true');
 const enabled={...change,changeId:randomUUID(),enabled:true};
 await refused({...original,id:enabled.changeId,payload:{change:enabled}});
 await db.query('update routine_states set enabled=false,updated_at=now()');
 await refused({...original,id:randomUUID(),payload:{change:{...change,changeId:randomUUID()}}});
 const grants=(await db.query("select has_table_privilege('anon','grok_control_records','select') a,has_table_privilege('authenticated','grok_control_records','insert') b,has_table_privilege('service_role','grok_control_records','update') c")).rows[0];
 assert.ok(Object.values(grants).every(v=>!v));checks++;
 console.log(JSON.stringify({status:'PASS',checks,simulatedWebhookCalls:calls,externalNetworkCalls:0,scope:'actual transport with PostgreSQL WASM persistence; not Grok runtime proof'}));
}finally{await vite.close();await db.close();}
