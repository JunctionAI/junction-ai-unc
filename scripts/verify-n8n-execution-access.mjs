/** Read-only operator acceptance. Uses server environment; never prints keys or raw execution data.
 * Run in the actual server environment. Vercel sensitive secrets cannot be pulled locally.
 * For the deployed Fly worker: node scripts/verify-n8n-worker-access.mjs
 * This does not call any workflow webhook, create a permit, or enable dispatch.
 */
const ORIGIN="https://junctionai8.app.n8n.cloud/api/v1";
const WORKFLOW="XiXJKuph1fAeH9pe";
const REVISION="1bce8c54-637e-4770-af90-2da36f38369a";
const NODE="c934c229-1191-43b7-b035-5fc641fbe0d0";
const key=process.env.N8N_EXECUTION_API_KEY??"";
const expectedExpiry="2026-12-04T11:00:00.000Z";
const fail=message=>{throw new Error(message);};
async function read(path) {
  const res=await fetch(ORIGIN+path,{method:"GET",redirect:"error",cache:"no-store",headers:{accept:"application/json","X-N8N-API-KEY":key},signal:AbortSignal.timeout(20000)});
  let bytes=0;const parts=[];
  for await(const chunk of res.body) {bytes+=chunk.length;if(bytes>1048576)fail("Saved execution exceeds the configured response bound.");parts.push(Buffer.from(chunk));}
  const body=JSON.parse(Buffer.concat(parts).toString());
  return{status:res.status,bytes,body};
}
try {
  if(key.length<24 || /\s/.test(key) || process.env.N8N_EXECUTION_API_BASE_URL!==ORIGIN ||
    process.env.N8N_SHADOW_WORKFLOW_ID!==WORKFLOW || process.env.N8N_SHADOW_TRIGGER_NODE_ID!==NODE ||
    process.env.N8N_EXECUTION_READER_ENABLED!=="false" || process.env.N8N_EXECUTION_API_KEY_EXPIRES_AT!==expectedExpiry)
    fail("Expected disabled reader configuration is missing or mismatched.");
  if(["UNC_COMMANDS_ENABLED","UNC_MESSAGING_ENABLED","LIVE_MODE_ENABLED"].some(n=>process.env[n]!=="false"))fail("External action flags are not all explicitly disabled.");
  const [workflow,refusal,seo,ungranted]=await Promise.all([
    read(`/workflows/${WORKFLOW}`),read("/executions/75?includeData=true"),read("/executions/59?includeData=true"),read("/users?limit=1"),
  ]);
  const w=workflow.body,r=refusal.body,s=seo.body;
  if(workflow.status!==200 || w.id!==WORKFLOW || w.versionId!==REVISION || w.activeVersionId!==REVISION || w.active!==true)fail("Frozen published workflow does not match.");
  const hook=w.nodes?.find(n=>n.id===NODE);
  if(hook?.type!=="n8n-nodes-base.webhook" || hook.parameters?.path!=="unc/d03-w01/keyword-shadow" || hook.parameters?.httpMethod!=="POST" ||
    hook.parameters?.authentication!=="headerAuth" || !hook.credentials?.httpHeaderAuth?.id)fail("Frozen webhook binding does not match.");
  if(refusal.status!==200 || r.id!=="75" || r.workflowId!==WORKFLOW || r.workflowVersionId!==REVISION ||
    r.mode!=="manual" || !r.finished || !r.workflowData?.nodes?.some(n=>n.id===NODE && n.type==="n8n-nodes-base.webhook"))fail("Saved refusal execution provenance does not match.");
  if(seo.status!==200 || s.id!=="59" || s.workflowId!=="OUerIfgAkMnhkuen" || s.status!=="success" || !s.finished || !s.workflowVersionId)fail("Saved SEO handoff evidence unavailable.");
  if(ungranted.status!==403)fail("Unrequested user-list scope was not denied. Review key permissions before use.");
  console.log(JSON.stringify({status:"PASS",checkedAt:new Date().toISOString(),keyExpiresAt:expectedExpiry,
    workflow:{id:WORKFLOW,publishedRevision:REVISION,webhookNodeId:NODE,headerCredential:hook.credentials.httpHeaderAuth},
    execution75:{status:refusal.status,bytes:refusal.bytes,savedRevision:r.workflowVersionId,mode:r.mode,nodesRun:Object.keys(r.data?.resultData?.runData??{})},
    execution59:{status:seo.status,bytes:seo.bytes,savedRevision:s.workflowVersionId,mode:s.mode,workflowId:s.workflowId},
    ungrantedUsersReadStatus:ungranted.status,readerEnabled:false,providerRunsStarted:0,liveShadowAcceptance:false},null,2));
} catch(error) {
  // Network/provider bodies may contain secrets: only print our fixed failure messages.
  const allowed=["Expected disabled reader configuration is missing or mismatched.","External action flags are not all explicitly disabled.",
    "Frozen published workflow does not match.","Frozen webhook binding does not match.","Saved refusal execution provenance does not match.",
    "Saved SEO handoff evidence unavailable.","Unrequested user-list scope was not denied. Review key permissions before use.","Saved execution exceeds the configured response bound."];
  console.error(JSON.stringify({status:"FAIL",error:allowed.includes(error?.message)?error.message:"Verification failed; sensitive transport details suppressed. No workflow was invoked."}));
  process.exitCode=1;
}
