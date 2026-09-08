// Local integration harness. Never imported by app routes or deployed as an auth bypass.
// REVIEW_PGLITE_MODULE + REVIEW_TEST_IMAGE must point to local, explicitly chosen files.
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {PGlite}=await import(pathToFileURL(process.env.REVIEW_PGLITE_MODULE).href);
const bytes=await readFile(process.env.REVIEW_TEST_IMAGE);
const db=new PGlite();
const a='00000000-0000-4000-8000-000000000001',u='00000000-0000-4000-8000-000000000003',o='00000000-0000-4000-8000-000000000004';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table accounts(id uuid primary key,context_generation bigint,automation_paused boolean default false);
create table account_members(account_id uuid,user_id uuid,role text);
create table routine_runs(id uuid primary key,account_id uuid,context_generation bigint);
create table artifacts(id uuid primary key,account_id uuid,run_id uuid);
grant select,update on accounts,account_members,routine_runs,artifacts to service_role;
insert into accounts(id,context_generation) values('${a}',1);
insert into account_members values('${a}','${u}','owner');
insert into routine_runs values('${a}','${a}',1);insert into artifacts values('${a}','${a}','${a}');`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260908151115_review_outputs.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260908152507_review_history.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260908153321_review_action_approvals.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const content={title:'Your next round starts here',imagePath:`/api/review/media/${o}_image`,media:{image:{format:'png',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}};
await db.query('select register_review_output($1,$2,$3,$4,$5,$6,$7,$8,$9)',[a,1,a,a,o,'email',['hero'],null,JSON.stringify(content)]);
// Synthetic history fixture: same approved demo asset, no AI generation claim.
await db.query('insert into review_output_versions(output_id,account_id,revision,content) values($1,$2,1,$3)',[o,a,JSON.stringify({...content,title:'Your next round, refined',body:'LOCAL TEST: revised copy fixture, not provider-generated.'})]);
await db.query('update review_outputs set revision=1 where id=$1',[o]);
await db.query('select propose_review_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[a,1,o,1,'00000000-0000-4000-8000-000000000009','prepare_provider_draft','LOCAL TEST — no provider connection','Record approval for the local draft fixture. No provider will be called.','{}',new Date(Date.now()+3600000).toISOString()]);
const rpc=async(name,args)=>{
 const keys={read_review_actions:['acct','generation','actor','output'],decide_review_action:['acct','generation','actor','output','expected_revision','proposal','decision'],read_review_output:['acct','generation','actor','output'],read_review_history:['acct','generation','actor','output','before_revision'],read_review_version:['acct','generation','actor','output','selected_revision'],add_review_comment:['acct','generation','actor','artifact','output','expected_revision','comment','anchor_value','note_value','intent_value']}[name];
 if(!keys)throw new Error('RPC outside harness scope');
 try{const values=keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
 const result=await db.query(`select ${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) as result`,values);return {data:result.rows[0].result,error:null};
 }catch(error){return {data:null,error:{code:error.code,message:'Harness SQL rejected request'}};}
};
const bind=async(request)=>request.headers.get('x-unc-account-id')===a&&request.headers.get('x-unc-context-generation')==='1'?{accountId:a,userId:u,contextGeneration:1,db:{rpc}}:new Response(null,{status:403});
const server=await createServer({configFile:false,plugins:[{name:'isolated-review-api',configureServer(s){s.middlewares.use(handle);}}],root:fileURLToPath(new URL('./',import.meta.url)),resolve:{alias:{'@':`${root}src`}},esbuild:{jsx:'automatic'},define:{'process.env.NODE_ENV':'"development"'},server:{host:'127.0.0.1',port:0,strictPort:true,fs:{allow:[root]}}});
async function handle(req,res,next){
 if(!req.url?.startsWith('/api/'))return next();
 try{
  const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24000){res.writeHead(413);res.end();return;}parts.push(chunk);}
  const request=new Request(`http://127.0.0.1:4317${req.url}`,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(parts)}:{})});
  let response;
  const output=/^\/api\/review\/outputs\/([^/?]+)(?:\?|$)/.exec(req.url),media=/^\/api\/review\/media\/([^/?]+)/.exec(req.url);
  if(output){const {reviewApi}=await server.ssrLoadModule('/@fs/'+root+'src/lib/artifacts/reviewApi.ts');response=await reviewApi(request,output[1],{enabled:true,bind});}
  else if(media){const {reviewMedia}=await server.ssrLoadModule('/@fs/'+root+'src/lib/artifacts/reviewMedia.ts');response=await reviewMedia(request,media[1],{enabled:true,bind,download:async(path)=>[0,1].some(r=>path===`${a}/1/${o}/${r}/image.png`)?new Blob([bytes]):null});}
  else response=new Response(null,{status:404});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Local harness error');}
}
await server.listen();console.log(`Local review harness: http://127.0.0.1:${server.httpServer.address().port} — isolated fixtures, no provider calls`);
process.on('SIGINT',async()=>{await server.close();await db.close();process.exit(0);});
