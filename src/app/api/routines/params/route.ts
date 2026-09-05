/* Account-bound routine editor. Values and draft commit atomically against the
   exact snapshot the owner reviewed. Promotion is separate from enable/run. */
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { nodesFor, prepareRoutineParams, PresetValidationError } from "@/lib/runtime/presets";
import { commitEditor, EditorError, editorState, editorValidation, editorView, readEditor, type EditorSnapshot } from "@/lib/runtime/presets/editor";
import { getStore } from "@/lib/runtime/store";
import { scoreAgreement } from "@/lib/runtime/agreement";
import { skillFor } from "@/lib/runtime/skills";
import { assertValidSpec, ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { dryRunPassed } from "@/lib/runtime/versioning";
import { stableHash } from "@/lib/runtime/context";
import { runRoutine } from "@/lib/runtime/engine";
import { buildAdapters, resolveAccount, WorkerError } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { workerErrorStatus } from "../shared";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { automationPauseResponse } from "@/lib/db/automationPause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const bad=(error:string,status=400,extra:Record<string,unknown>={})=>json({error,...extra},status);
function routineIdOf(value:unknown) {return typeof value==="string" && ROUTINE_ID_RE.test(value) && CATALOG_SPEC_BY_ID[value]?value:null;}

async function shape(snapshot:EditorSnapshot,routineId:string) {
  const {view}=editorView(snapshot,CATALOG_SPEC_BY_ID[routineId]);
  const state=editorState(snapshot,routineId);
  const validation=state.draftSpec?await editorValidation(getStore(),snapshot,state.draftSpec):null;
  const relevant=new Set(view.relevant),bound=new Set(view.bound);
  return {accountId:snapshot.accountId,contextGeneration:snapshot.contextGeneration,role:snapshot.role,
    configurationRevision:snapshot.configurationRevision,routineId,domain:view.domain,currency:view.set.currency,band:view.set.band,
    fields:view.set.fields.map(f=>({...f,relevant:relevant.has(f.key),bound:bound.has(f.key)})),steps:view.steps,
    version:{live:state.version,draft:state.draftSpec?.version??null},stateUpdatedAt:snapshot.state?.updated_at??null,
    canPromote:!!validation && !!validation.finishedAt && dryRunPassed(validation.status),skillFile:skillFor(routineId)?.file??null,
    agreement:await scoreAgreement(getStore(),snapshot.accountId,routineId)};
}

async function handle(req:Request,method:"GET"|"PATCH"|"POST") {
  const session=await (method==="GET"?requireAccountSession():requireAccountOwnerSession());
  if(session instanceof Response)return session.status===200?bad("Settings require a saved account.",503):session;
  const ctx=await captureArtifactContext(session.service,session.accountId,req);if(ctx instanceof Response)return ctx;
  const identity={...ctx,userId:session.userId};
  let body:Record<string,unknown>={};
  const query=new URL(req.url).searchParams;
  if(method!=="GET") {
    const raw=await req.json().catch(()=>null);
    if(!raw || typeof raw!=="object" || Array.isArray(raw))return bad("Invalid JSON body.");
    body=raw;
  } else if([...query.keys()].some(k=>k!=="routineId") || query.getAll("routineId").length!==1)return bad("Invalid routine selection.");
  const routineId=routineIdOf(method==="GET"?query.get("routineId"):body.routineId);
  if(!routineId)return bad("routineId must be a catalog routine (D0x-W0y)");
  const catalog=CATALOG_SPEC_BY_ID[routineId];
  const snapshot=await readEditor(session.service,identity,routineId);
  if(method==="GET")return json(await shape(snapshot,routineId));
  const paused=await automationPauseResponse(session.service,session.accountId);if(paused)return paused;
  const allowed=method==="PATCH"?["routineId","params","steps","version","stateUpdatedAt","configurationRevision"]:["routineId","action","version","stateUpdatedAt","configurationRevision"];
  if(Object.keys(body).some(k=>!allowed.includes(k)))return bad("Unexpected settings field.");
  const state=editorState(snapshot,routineId);
  if(body.configurationRevision!==snapshot.configurationRevision || body.version!==state.version || body.stateUpdatedAt!==(snapshot.state?.updated_at??null))
    return bad("Settings changed. Refresh before continuing.",409);
  if(method==="PATCH") {
    let steps:Record<string,boolean>|undefined;
    if(body.steps!==undefined) {
      if(!body.steps || typeof body.steps!=="object" || Array.isArray(body.steps) || Object.values(body.steps).some(v=>typeof v!=="boolean"))return bad("steps must map optional step IDs to true or false.");
      steps=body.steps as Record<string,boolean>;
    }
    const {spec,view:previous,configuredSpec}=editorView(snapshot,catalog);
    const own=prepareRoutineParams(spec,{params:body.params,steps},previous.own);
    const {view}=editorView(snapshot,catalog,own);
    const nodes=nodesFor(spec,view);
    const draft=JSON.stringify(nodes)===JSON.stringify(configuredSpec.nodes)?null:{...spec,nodes,version:state.version+1};
    if(draft)assertValidSpec(draft);
    const saved=await commitEditor(session.service,identity,routineId,snapshot.configurationRevision,{action:"save",own,draft});
    return json(await shape(saved,routineId));
  }
  const action=body.action;
  if(action!=="discard" && action!=="promote" && action!=="validate")return bad("action must be validate, promote or discard");
  if(routineId==="D03-W01" && action!=="discard")return bad("Keyword pilot requires operator-authorized registration and independent execution verification.",409);
  if(action==="discard")return json(await shape(await commitEditor(session.service,identity,routineId,snapshot.configurationRevision,{action}),routineId));
  const draft=state.draftSpec;
  if(!draft)return bad("There is no draft to validate or promote.",409);
  assertValidSpec(draft);
  if(action==="promote") {
    const validation=await editorValidation(getStore(),snapshot,draft);
    if(!validation || !validation.finishedAt || !dryRunPassed(validation.status))return bad("The latest validation of this exact draft must pass before promotion.",409);
    const saved=await commitEditor(session.service,identity,routineId,snapshot.configurationRevision,{action,draft,validationRun:validation.id,specHash:stableHash(draft)});
    return json(await shape(saved,routineId));
  }
  if(!state.enabled)return bad("Select this routine in Agents before requesting validation.",409);
  const deps={store:getStore(),accounts:defaultAccountsSource()};
  const acct=await resolveAccount(deps,session.accountId);
  if(acct.account.contextGeneration!==ctx.contextGeneration)return bad("Account changed before validation.",409);
  // Run the captured draft, never reload a different draft after the request's check.
  const run=await runRoutine(draft,{account:acct.account,triggeredBy:"manual",vars:acct.vars??{}},buildAdapters(deps),{mode:"dry_run"});
  const after=await readEditor(session.service,identity,routineId);
  if(after.configurationRevision!==snapshot.configurationRevision)return bad("Configuration changed during validation. Refresh to inspect the recorded run.",409,{runId:run.runId});
  return json({...await shape(after,routineId),run:{runId:run.runId,status:run.status,summary:run.summary},passed:dryRunPassed(run.status)});
}

const endpoint=(method:"GET"|"PATCH"|"POST")=>withErrorCapture("api/routines/params",async(req:Request)=>{
  try {const response=await handle(req,method);response.headers.set("cache-control","private, no-store");return response;}
  catch(err) {
    if(err instanceof PresetValidationError)return bad(err.message,400,{issues:err.issues});
    if(err instanceof EditorError)return bad(err.message,err.status);
    if(err instanceof WorkerError)return bad(err.message,workerErrorStatus(err));
    return bad("Could not confirm the settings operation. Refresh to inspect its saved state; no automatic retry.",503);
  }
});
export const GET=endpoint("GET");
export const PATCH=endpoint("PATCH");
export const POST=endpoint("POST");
