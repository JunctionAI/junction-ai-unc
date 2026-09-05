/** Explicit operator entry on the existing worker; never a scheduler or retry loop.
 * Credentials remain on Fly. Approval JSON contains identifiers, not secrets.
 * --inspect reads the original key even after expiry; it never resumes a run.
 * --issue requires the exact reviewed build/revision plus all live preflight gates.
 */
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {inspectKeywordPilot,remotePreflight} from './verify-keyword-pilot-readiness.mjs';

export function parsePilotCommand(args, approval) {
  const mode=args[0];
  if (!['--inspect','--issue'].includes(mode) || !approval || typeof approval!=='object' || Array.isArray(approval))
    throw Error('Explicit inspect or issue command and approval JSON required');
  const options={};
  for(let i=1;i<args.length;i+=2) {
    if (!['--approval','--expected-build','--expected-revision'].includes(args[i]) ||
        Object.hasOwn(options,args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw Error('Invalid or duplicate option');
    options[args[i]]=args[i+1];
  }
  if (!options['--approval']) throw Error('Original approval file required');
  const keys=['authorizedBy','approvalReference','idempotencyKey','market','contextGeneration','maxProviderCalls','expiresAt'];
  if (Object.keys(approval).length!==keys.length || keys.some(k=>!Object.hasOwn(approval,k)) ||
      approval.authorizedBy!=='74802c60-149a-4405-b719-dc058d174072' || approval.contextGeneration!==1 ||
      !['US','NZ','AU'].includes(approval.market) || approval.maxProviderCalls!==1 ||
      !['approvalReference','idempotencyKey'].every(k=>typeof approval[k]==='string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(approval[k])) ||
      typeof approval.expiresAt!=='string' || !Number.isFinite(Date.parse(approval.expiresAt))) throw Error('Invalid original pilot approval');
  const expectedBuild=options['--expected-build'],expectedRevision=options['--expected-revision'];
  if(mode==='--issue' && (!/^[a-f0-9]{40}$/.test(expectedBuild??'') ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedRevision??''))) throw Error('Exact reviewed build and revision required');
  if(mode==='--inspect' && (expectedBuild || expectedRevision)) throw Error('Inspect does not require current deployment pins');
  return {mode:mode.slice(2),approval:{...approval},...(mode==='--issue'?{expectedBuild,expectedRevision}:{})};
}

// Self-contained for execution inside the existing worker; raw errors/results are
// never serialized. A database error is not an absent permit or permission to retry.
export async function operatePilot(command, load, env, preflight) {
  const accountId='aa5cfc84-2569-4c99-9b40-67003ae55eda';
  if(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!=='https://ycgayfsvcjpsnryrpukv.supabase.co') throw Error('Wrong database');
  const {serviceDb}=load('/app/dist/worker/worker/wiring.js');
  const db=serviceDb();
  if(!db) throw Error('No service database');
  const identity={accountId,generation:command.approval.contextGeneration,idempotencyKey:command.approval.idempotencyKey};
  const inspect=async()=>{
    const {data,error}=await db.from('n8n_shadow_permits')
      .select('id,run_id,registration_id,status,execution_id,authorized_by,issuance')
      .eq('account_id',accountId).eq('context_generation',identity.generation).eq('idempotency_key',identity.idempotencyKey).maybeSingle();
    if(error) throw Error('Original allowance unreadable');
    if(!data) return {...identity,status:'NOT_FOUND',safeToRedispatch:false};
    if(data.authorized_by!==command.approval.authorizedBy ||
        !load('node:util').isDeepStrictEqual(data.issuance,command.approval)) throw Error('Original approval mismatch');
    const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if(![data.id,data.run_id,data.registration_id].every(v=>typeof v==='string' && uuid.test(v)) ||
        !['reserved','dispatching','provider_authorized','verifying','verified','refused','uncertain'].includes(data.status) ||
        !(data.execution_id===null || typeof data.execution_id==='string' && /^[0-9]{1,30}$/.test(data.execution_id))) throw Error('Invalid stored identity');
    return {...identity,status:'FOUND',permitId:data.id,runId:data.run_id,registrationId:data.registration_id,
      permitStatus:data.status,executionId:data.execution_id,safeToRedispatch:false};
  };
  const original=await inspect();
  if(command.mode==='inspect' || original.status==='FOUND') return original;
  if(command.mode!=='issue') throw Error('Unsupported operation');
  const pilot=load('/app/dist/worker/worker/issueKeywordShadowPilot.js');
  if(env.UNC_BUILD_SHA!==command.expectedBuild || pilot.KEYWORD_PILOT_PIN.workflowVersion!==command.expectedRevision)
    return {...identity,status:'BLOCKED',reason:'reviewed_build_or_revision_mismatch',safeToRedispatch:false};
  pilot.keywordPilotContract(command.approval,new Date());
  const readiness=await preflight();
  if(readiness.status!=='PASS' || readiness.buildSha!==command.expectedBuild || readiness.expectedRevision!==command.expectedRevision)
    return {...identity,status:'BLOCKED',reason:'configuration_preflight_not_ready',safeToRedispatch:false};
  const {SupabaseStore}=load('/app/dist/worker/lib/runtime/store/supabase.js');
  const {DbAccountsSource}=load('/app/dist/worker/worker/accounts.js');
  try {
    // One invocation only. The existing RPC remains the atomic race/duplicate guard.
    await pilot.runKeywordShadowPilot({db,store:new SupabaseStore(db),accounts:new DbAccountsSource(db),
      producer:null,llm:null},command.approval);
  } catch {
    // The request may already have committed or reached the provider. No retry,
    // new key, refresh, recovery, switch change or raw exception output here.
    const seen=await inspect();
    return {...seen,status:'RECONCILE_REQUIRED',safeToRedispatch:false};
  }
  // A verified permit is not, by itself, customer artifact/receipt acceptance.
  return {...await inspect(),endToEndProven:false};
}

async function main() {
  const args=process.argv.slice(2),fileIndex=args.indexOf('--approval');
  if(fileIndex<0 || !args[fileIndex+1]) throw Error('Approval file required');
  const raw=await readFile(args[fileIndex+1]);
  if(raw.length>4096) throw Error('Approval too large');
  const command=parsePilotCommand(args,JSON.parse(raw.toString('utf8')));
  // Retain this identity before a potentially lost transport reply. No fresh keys
  // are generated by the command. The approval reference must point to real authority.
  console.log(JSON.stringify({operation:command.mode,idempotencyKey:command.approval.idempotencyKey,
    generation:command.approval.contextGeneration,market:command.approval.market}));
  const cli=process.env.FLY_BIN??'fly',exec=promisify(execFile);
  const invoke=async(args,timeout=30000)=>(await exec(cli,args,{timeout,maxBuffer:1048576})).stdout;
  const app='unc-worker',machine='1857466fd76998';
  const before=JSON.parse(await invoke(['status','-a',app,'--json']));
  const current=before.Machines?.[0];
  if(before.Name!==app || before.Machines?.length!==1 || current?.id!==machine || current.state!=='started') throw Error('Unexpected worker');
  const program=`(${operatePilot.toString()})(${JSON.stringify(command)},require,process.env,()=>(${remotePreflight.toString()})(${inspectKeywordPilot.toString()},require,process.env)).then(r=>console.log(JSON.stringify(r))).catch(()=>console.log(JSON.stringify({status:"RECONCILE_REQUIRED",safeToRedispatch:false})));`;
  const encoded=Buffer.from(program).toString('base64'); // identifiers/code only, no credentials
  const report=JSON.parse((await invoke(['ssh','console','-a',app,'--machine',machine,'--quiet','-C',
    `node -e 'eval(Buffer.from("${encoded}","base64").toString())'`],180000)).trim());
  const after=JSON.parse(await invoke(['status','-a',app,'--json'])),latest=after.Machines?.[0];
  if(after.Machines?.length!==1 || latest?.id!==machine || latest.state!=='started' ||
      latest.config.image!==current.config.image || latest.config.metadata?.fly_release_version!==current.config.metadata?.fly_release_version)
    throw Error('Worker changed; reconcile original key');
  console.log(JSON.stringify(report,null,2));
  if(['BLOCKED','RECONCILE_REQUIRED'].includes(report.status) ||
      command.mode==='issue' && report.permitStatus!=='verified') process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{console.error('Pilot incomplete or transport uncertain. Inspect the ORIGINAL approval key; do not issue a replacement. Raw errors suppressed.');process.exitCode=1;});
}
