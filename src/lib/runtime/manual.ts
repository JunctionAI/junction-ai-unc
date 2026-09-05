import type { DbClient, Row } from "../db/types";
import { readEditor, editorState, type EditorIdentity, type EditorSnapshot } from "./presets/editor";
import { CATALOG_SPEC_BY_ID } from "./catalog-specs";
import { effectiveSpec } from "./versioning";
import { cleanAnswers, resumeCapturedInput, runRoutine, type Adapters } from "./engine";
import { rowToRun } from "./store/supabase";
import type { RunRecord, Store } from "./store/interface";
import type { RunResult } from "./types";
import { buildAdapters, resolveAccount, type ServiceDeps } from "../../worker/service";

export const MANUAL_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ManualRequestError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type ManualPurpose = "run" | "validate" | "input";
type Operation = { request_id: string; purpose: ManualPurpose; routine_id: string; phase: "prepared" | "claimed";
  request_body: Row; configuration_revision: string; initial_record: RunRecord; run_id: string };
export type ManualRecord = { operation: Operation; run: RunRecord };
const args = (i: EditorIdentity, requestId: string) => ({ p_account: i.accountId, p_actor: i.userId, p_generation: i.contextGeneration, p_request: requestId });
function confirmed(data: unknown, i: EditorIdentity, requestId: string): ManualRecord {
  const d = data as { operation?: Operation & { account_id: string; actor_id: string; context_generation: number }; run?: Row } | null;
  const o = d?.operation, r = d?.run;
  if (!o || !r || o.account_id !== i.accountId || o.actor_id !== i.userId || o.context_generation !== i.contextGeneration ||
    o.request_id !== requestId || !["run", "validate", "input"].includes(o.purpose) || !["prepared", "claimed"].includes(o.phase) ||
    r.id !== o.run_id || r.account_id !== i.accountId || r.context_generation !== i.contextGeneration || r.routine_id !== o.routine_id ||
    r.mode !== "dry_run" || !o.initial_record || o.initial_record.id !== r.id || o.initial_record.accountId !== i.accountId ||
    o.initial_record.contextGeneration !== i.contextGeneration || o.initial_record.routineId !== o.routine_id)
    throw new ManualRequestError("Could not verify the original run. Check its saved outcome; do not start another request.", 503);
  return { operation: o, run: rowToRun(r) };
}
const failed = (code?: string): never => { throw new ManualRequestError("Run not confirmed. Access, settings or an earlier run may have changed. Check the original request before retrying.", code === "42501" ? 403 : code === "40001" ? 409 : code === "22023" ? 400 : 503); };
export async function readManual(db: DbClient, i: EditorIdentity, requestId: string): Promise<ManualRecord | null> {
  if (!MANUAL_REQUEST_ID.test(requestId)) throw new ManualRequestError("A valid requestId is required.", 400);
  const { data, error } = await db.rpc("read_manual_routine_request", args(i, requestId));
  if (error) return failed(error.code);
  return data ? confirmed(data, i, requestId) : null;
}
export async function manualResult(store: Store, record: ManualRecord): Promise<RunResult> {
  const r = record.run;
  const [receipts, artifacts] = await Promise.all([
    store.listReceipts(r.accountId, { runId: r.id, limit: 500 }),
    store.listArtifacts(r.accountId, { runId: r.id, contextGeneration: r.contextGeneration, limit: 1 }),
  ]);
  return { runId: r.id, routineId: r.routineId, version: r.version, mode: r.mode, status: r.status,
    summary: record.operation.phase === "prepared" ? "Prepared; not started. Continue this original request to claim it." : r.summary ?? "Outcome not confirmed; inspect this original run without restarting it.",
    receipts, ...(artifacts[0] ? { artifact: artifacts[0] } : {}), ...(r.snapshot?.needs ? { needs: r.snapshot.needs } : {}) };
}
function guardAdapters(db: DbClient, i: EditorIdentity, snapshot: EditorSnapshot, routineId: string, adapters: Adapters): Adapters {
  return { ...adapters, assertContext: async context => {
    await adapters.assertContext?.(context);
    const current = await readEditor(db, i, routineId);
    if (current.role !== "owner" || current.paused || !current.state?.enabled || current.configurationRevision !== snapshot.configurationRevision)
      throw new ManualRequestError("Account or routine settings changed; further work was stopped.");
  } };
}
export async function executeManual(db: DbClient, i: EditorIdentity, requestId: string, purpose: ManualPurpose, body: Row,
  snapshot: EditorSnapshot, deps: ServiceDeps): Promise<{ result: RunResult; requestId: string; phase: "prepared" | "claimed" }> {
  if (!MANUAL_REQUEST_ID.test(requestId)) throw new ManualRequestError("A valid requestId is required.", 400);
  const routineId = String(body.routineId);
  if (routineId === "D03-W01" || !CATALOG_SPEC_BY_ID[routineId]) throw new ManualRequestError("This routine cannot use manual admission.");
  let record = await readManual(db, i, requestId);
  const same = (a: unknown, b: unknown): boolean => {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ?
      Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v;
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  };
  if (record && (record.operation.purpose !== purpose || !same(record.operation.request_body, body))) throw new ManualRequestError("This request ID already belongs to a different request.");
  if (record?.operation.phase === "claimed") return { result: await manualResult(deps.store, record), requestId, phase: "claimed" };
  const state = editorState(snapshot, routineId);
  if (snapshot.role !== "owner" || snapshot.paused || !state.enabled) throw new ManualRequestError("Routine is unavailable, paused or not selected.");
  const adapters = guardAdapters(db, i, snapshot, routineId, buildAdapters(deps));
  const prepareAndClaim = async (initial: RunRecord) => {
    const { data, error } = await db.rpc("prepare_manual_routine_request", { ...args(i, requestId), p_purpose: purpose,
      p_body: body, p_revision: snapshot.configurationRevision, p_initial: initial });
    if (error) return failed(error.code);
    record = confirmed(data, i, requestId);
    if (record.operation.phase === "claimed") return false;
    const claim = await db.rpc("claim_manual_routine_request", args(i, requestId));
    if (claim.error) return failed(claim.error.code);
    if (typeof claim.data !== "boolean") throw new ManualRequestError("Start claim outcome is uncertain. Check this original request without restarting it.", 503);
    if (!claim.data) {
      record = await readManual(db, i, requestId);
      if (!record) return failed();
    }
    return claim.data;
  };
  let result: RunResult;
  if (purpose === "input") {
    const original = record?.operation.initial_record ?? await deps.store.getRun(String(body.runId));
    if (!original || original.accountId !== i.accountId || original.contextGeneration !== i.contextGeneration || original.routineId !== routineId || original.mode !== "dry_run" ||
      !original.snapshot || ![effectiveSpec(state, CATALOG_SPEC_BY_ID[routineId]), state.draftSpec].some(spec => spec && same(spec, original.snapshot?.spec)))
      throw new ManualRequestError("Waiting run no longer matches this account and configuration.");
    const answers = cleanAnswers(body.answers as Row);
    if (!Object.keys(answers).length) throw new ManualRequestError("answers are empty", 400);
    result = await prepareAndClaim(original) ? await resumeCapturedInput(structuredClone(record!.operation.initial_record), answers, adapters) : await manualResult(deps.store, record!);
  } else {
    const spec = purpose === "validate" ? state.draftSpec : effectiveSpec(state, CATALOG_SPEC_BY_ID[routineId]);
    if (!spec) throw new ManualRequestError("There is no draft to validate.");
    const acct = await resolveAccount(deps, i.accountId);
    if (acct.account.accountId !== i.accountId || acct.account.contextGeneration !== i.contextGeneration) throw new ManualRequestError("Account context changed before execution.");
    result = await runRoutine(spec, { account: acct.account, triggeredBy: "manual", vars: acct.vars ?? {} }, adapters, { mode: "dry_run",
      admitManualStart: async initial => await prepareAndClaim(initial) ? { start: true, run: structuredClone(record!.operation.initial_record) } : { start: false, result: await manualResult(deps.store, record!) } });
  }
  return { result, requestId, phase: "claimed" };
}
