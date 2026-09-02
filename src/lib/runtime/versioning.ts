/* Draft → validate (dry run) → promote.

   routine_states holds one live spec (version N) and at most one draft
   (version N+1). A draft can only be promoted when the newest dry run for
   that draft version ran EXACTLY this draft (spec hash matches) and did not
   fail. Promotion bumps the version and clears the draft. */

import { stableHash } from "./context";
import { runRoutine, type Adapters } from "./engine";
import type { RoutineStateRecord, RunRecord, Store } from "./store/interface";
import type { Node, RoutineId, RoutineSpec, RunInput, RunResult } from "./types";
import { assertValidSpec } from "./validate";

export interface VersioningDeps {
  store: Store;
  now?: () => Date;
}

export class PromoteRefusedError extends Error {
  constructor(public readonly reason: string) {
    super(`Promote refused: ${reason}`);
    this.name = "PromoteRefusedError";
  }
}

const nowIso = (deps: VersioningDeps) => (deps.now ?? (() => new Date()))().toISOString();

/** Load the routine's state, initialising the schema default (v1, catalog
    spec live, no draft) when the row does not exist yet. */
export async function getOrInitState(deps: VersioningDeps, accountId: string, routineId: RoutineId): Promise<RoutineStateRecord> {
  const existing = await deps.store.getRoutineState(accountId, routineId);
  if (existing) return existing;
  return deps.store.putRoutineState({ accountId, routineId, enabled: false, version: 1, draftSpec: null, liveSpec: null, updatedAt: nowIso(deps) });
}

/** The spec that runs in production: the promoted one, else the catalog
    default at the state's version. */
export function effectiveSpec(state: RoutineStateRecord, catalogDefault: RoutineSpec): RoutineSpec {
  return state.liveSpec ?? { ...catalogDefault, version: state.version };
}

/** Save (or replace) the draft. Accepts either a full spec or just the edited
    node chain (the rest is copied from the live/catalog spec). The draft is
    always version live+1 and must be structurally valid. */
export async function saveDraft(
  deps: VersioningDeps,
  accountId: string,
  catalogDefault: RoutineSpec,
  edit: Node[] | Partial<Omit<RoutineSpec, "id" | "version">>,
): Promise<RoutineStateRecord> {
  const state = await getOrInitState(deps, accountId, catalogDefault.id);
  const base = effectiveSpec(state, catalogDefault);
  const patch = Array.isArray(edit) ? { nodes: edit } : edit;
  const draft: RoutineSpec = { ...base, ...patch, id: base.id, version: state.version + 1 };
  assertValidSpec(draft);
  return deps.store.putRoutineState({ ...state, draftSpec: draft, updatedAt: nowIso(deps) });
}

export async function discardDraft(deps: VersioningDeps, accountId: string, routineId: RoutineId): Promise<RoutineStateRecord> {
  const state = await getOrInitState(deps, accountId, routineId);
  return deps.store.putRoutineState({ ...state, draftSpec: null, updatedAt: nowIso(deps) });
}

export interface DryRunOutcome {
  run: RunResult;
  passed: boolean;
}

/** A dry run "passes" when it ran the whole chain without an incident. A
    check that found nothing to do (skipped) still proves the chain works. */
export function dryRunPassed(status: RunResult["status"] | RunRecord["status"]): boolean {
  return status === "done" || status === "skipped";
}

/** Run the draft in dry_run mode. The engine records the run with the
    draft's version and spec hash, which is what promote checks. */
export async function validateDraft(deps: VersioningDeps, adapters: Adapters, accountId: string, routineId: RoutineId, input: RunInput): Promise<DryRunOutcome> {
  const state = await getOrInitState(deps, accountId, routineId);
  if (!state.draftSpec) throw new Error(`routine ${routineId} has no draft to validate`);
  if (input.account.accountId !== accountId) throw new Error("input.account.accountId must match accountId");
  const run = await runRoutine(state.draftSpec, input, adapters, { mode: "dry_run" });
  return { run, passed: dryRunPassed(run.status) };
}

/** Newest dry run of exactly this draft (same version AND same spec hash). */
export async function latestDryRunFor(store: Store, accountId: string, draft: RoutineSpec): Promise<RunRecord | null> {
  const hash = stableHash(draft);
  const runs = await store.listRuns(accountId, { routineId: draft.id, mode: "dry_run", version: draft.version, limit: 20 });
  return runs.find((r) => r.specHash === hash) ?? null;
}

/** Promote the draft to live. Refuses when there is no draft, no dry run of
    this exact draft, or the newest such dry run did not pass. */
export async function promoteDraft(deps: VersioningDeps, accountId: string, routineId: RoutineId): Promise<RoutineStateRecord> {
  const state = await getOrInitState(deps, accountId, routineId);
  const draft = state.draftSpec;
  if (!draft) throw new PromoteRefusedError("there is no draft to promote");
  assertValidSpec(draft);
  if (draft.version !== state.version + 1) throw new PromoteRefusedError(`draft is v${draft.version} but live is v${state.version}; re-save the draft`);
  const dryRun = await latestDryRunFor(deps.store, accountId, draft);
  if (!dryRun) throw new PromoteRefusedError(`no dry run has been recorded for draft v${draft.version} — run validation first`);
  if (dryRun.status === "running" || dryRun.status === "waiting_approval") throw new PromoteRefusedError(`dry run ${dryRun.id} is still ${dryRun.status}`);
  if (!dryRunPassed(dryRun.status)) throw new PromoteRefusedError(`last dry run ${dryRun.id} failed: ${dryRun.summary ?? "no summary"}`);
  return deps.store.putRoutineState({
    ...state,
    version: draft.version,
    liveSpec: draft,
    draftSpec: null,
    updatedAt: nowIso(deps),
  });
}

export async function setEnabled(deps: VersioningDeps, accountId: string, routineId: RoutineId, enabled: boolean): Promise<RoutineStateRecord> {
  const state = await getOrInitState(deps, accountId, routineId);
  return deps.store.putRoutineState({ ...state, enabled, updatedAt: nowIso(deps) });
}
