import type { DbClient, Row } from "../../db/types";
import type { RoutineSpec } from "../types";
import type { RoutineStateRecord, Store } from "../store/interface";
import { effectiveSpec } from "../versioning";
import { stableHash } from "../context";
import { resolvePreset } from "./industry";
import { boundFields, domainOf, optionalSteps, relevantFields } from "./routines";
import { resolveInputFromRows, type RoutineParamsRecord, type RoutinePresetView } from "./store";
import type { PresetParams, PresetSource } from "./types";

export interface EditorSnapshot {
  accountId: string; contextGeneration: number; role: "owner" | "member"; paused: boolean;
  configurationRevision: string; state: Row | null; own: Row | null; accountPreset: Row | null;
  input: Parameters<typeof resolveInputFromRows>[0];
}
export class EditorError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export type EditorIdentity = { accountId: string; userId: string; contextGeneration: number };
const args = (identity: EditorIdentity, routineId: string) => ({p_account:identity.accountId,p_actor:identity.userId,p_generation:identity.contextGeneration,p_routine:routineId,p_domain:domainOf(routineId)});
function confirmed(data: unknown, identity: EditorIdentity, routineId: string): EditorSnapshot {
  const s=data as EditorSnapshot | null;
  if (!s || s.accountId!==identity.accountId || s.contextGeneration!==identity.contextGeneration ||
    !["owner","member"].includes(s.role) || typeof s.paused!=="boolean" || !/^[a-f0-9]{64}$/.test(s.configurationRevision) || !s.input ||
    (s.state && (s.state.account_id!==identity.accountId || s.state.routine_id!==routineId)) ||
    (s.own && (s.own.account_id!==identity.accountId || s.own.routine_id!==routineId)))
    throw new EditorError("Could not verify the saved configuration. Refresh before continuing.",503);
  return s;
}
export async function readEditor(db: DbClient, identity: EditorIdentity, routineId: string) {
  const {data,error}=await db.rpc("read_routine_editor",args(identity,routineId));
  if (error) throw new EditorError("Could not read the saved configuration.",503);
  if (!data) throw new EditorError("Account access or context changed. Reload before continuing.",409);
  return confirmed(data,identity,routineId);
}
export async function commitEditor(db: DbClient, identity: EditorIdentity, routineId: string, revision: string,
  change: {action:"save"|"discard"|"promote"; own?:RoutineParamsRecord; draft?:RoutineSpec|null; validationRun?:string; specHash?:string}) {
  const {data,error}=await db.rpc("commit_routine_editor",{...args(identity,routineId),p_expected_revision:revision,p_action:change.action,
    p_params:change.own?.params??null,p_disabled_steps:change.own?.disabledSteps??null,p_draft:change.draft??null,
    p_validation_run:change.validationRun??null,p_spec_hash:change.specHash??null});
  if (error) throw new EditorError("Save not confirmed. Settings, validation or account access may have changed; refresh to inspect them.",error.code==="42501"?403:error.code==="40001"?409:503);
  return confirmed(data,identity,routineId);
}
export function editorState(snapshot:EditorSnapshot,routineId:string):RoutineStateRecord {
  const s=snapshot.state;
  return {accountId:snapshot.accountId,routineId,enabled:s?.enabled===true,version:Number(s?.version??1),
    liveSpec:(s?.live_spec as RoutineSpec|null)??null,draftSpec:(s?.draft_spec as RoutineSpec|null)??null,updatedAt:String(s?.updated_at??"")};
}
export function editorOwn(snapshot:EditorSnapshot,routineId:string):RoutineParamsRecord|null {
  const r=snapshot.own;if(!r)return null;
  return {routineId,domain:domainOf(routineId)!,params:r.params as PresetParams,disabledSteps:r.disabled_steps as string[],source:r.source as PresetSource,updatedAt:String(r.updated_at)};
}
export function editorView(snapshot:EditorSnapshot,catalog:RoutineSpec,own=editorOwn(snapshot,catalog.id)):{spec:RoutineSpec;configuredSpec:RoutineSpec;view:RoutinePresetView} {
  const configuredSpec=effectiveSpec(editorState(snapshot,catalog.id),catalog);
  // Keep promoted/custom nodes. Restore only absent catalog-optional nodes to the
  // editor blueprint so an owner can include them again after a promotion.
  const nodes=[...configuredSpec.nodes];
  const absent=catalog.nodes.filter(n=>"optional" in n && n.optional && !nodes.some(l=>l.id===n.id));
  for(const node of absent) {
    const following=catalog.nodes.slice(catalog.nodes.indexOf(node)+1).find(n=>nodes.some(l=>l.id===n.id));
    nodes.splice(following?nodes.findIndex(n=>n.id===following.id):nodes.length,0,node);
  }
  const spec={...configuredSpec,nodes};
  const domain=domainOf(catalog.id)!;
  if(!own && absent.length)own={routineId:catalog.id,domain,params:{},disabledSteps:absent.map(n=>n.id),source:"founder",updatedAt:""};
  const account=snapshot.accountPreset;
  const set=resolvePreset(resolveInputFromRows(snapshot.input),domain,{account:account?.params as PresetParams|null,accountSource:account?.source as PresetSource,
    routine:own?.params??null,routineSource:own?.source});
  const off=new Set(own?.disabledSteps??[]);
  return {spec,configuredSpec,view:{routineId:catalog.id,domain,set,relevant:relevantFields(catalog.id),bound:boundFields(catalog.id),
    steps:optionalSteps(spec).map(s=>({...s,included:!off.has(s.id)})),own}};
}
/** A validation of an earlier account generation cannot authorize this draft. */
export async function editorValidation(store:Store,snapshot:EditorSnapshot,draft:RoutineSpec) {
  const hash=stableHash(draft);
  const runs=await store.listRuns(snapshot.accountId,{routineId:draft.id,mode:"dry_run",version:draft.version,limit:100});
  return runs.filter(r=>r.specHash===hash && (r.contextGeneration??0)===snapshot.contextGeneration)
    .sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id))[0]??null;
}
