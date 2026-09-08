// Ephemeral deployment-only signing key. Never changes the project-level key.
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const directory=process.argv[2];
assert.match(directory,/^\/tmp\/junction-control-release\.[A-Za-z0-9]+$/);
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY?.length>32,'Test database credentials unavailable');
const secret=randomBytes(32).toString('base64url');
function run(command,args,env=process.env){return new Promise((resolve,reject)=>{
 const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error(output.split(secret).join('[redacted]').slice(-2000))));
});}
const deployed=await run('npx',['--yes','vercel@50.28.0','deploy',directory,'--prod','--skip-domain','--yes',
 '--env',`JUNCTION_GROK_CONTROL_SECRET=${secret}`,'--env','JUNCTION_GROK_CONTROL_ENABLED=true',
 '--env','JUNCTION_REVIEW_ENABLED=true','--env','JUNCTION_REVIEW_ACCOUNT_IDS=55a377a5-c12e-4de6-a085-0d9a50ccd488',
 '--env','JUNCTION_REVIEW_INTAKE_ENABLED=false']);
const url=deployed.match(/https:\/\/junction-[a-z0-9]+-tom-junctionmedis-projects\.vercel\.app/)?.[0];
assert.ok(url,'Deployment URL not returned');
console.log(JSON.stringify({stage:'isolated_deployment_ready',url,signingKey:'deployment-only; not logged or written locally'}));
const result=await run(process.execPath,[fileURLToPath(new URL('./verify-grok-callback-live.mjs',import.meta.url)),url+'/'],{...process.env,JUNCTION_GROK_CONTROL_SECRET:secret});
console.log(result.split(secret).join('[redacted]'));
