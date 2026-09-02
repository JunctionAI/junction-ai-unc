/* The shared "run a routine now / resume a paused run" service.

   Used by BOTH the always-on loop (src/worker/loop.ts) and the app's API
   routes (src/app/api/routines/run, /resume), so a manual trigger and a
   scheduled tick go through exactly the same adapters and the same checks.

   Pure of Node specifics (no fs, no signals, no http) so Next can bundle it.

   ┌──────────────────────────────────────────────────────────────────────┐
   │ LIVE_MODE_ENABLED = false                                             │
   │ Every run this service starts is a DRY RUN. Flipping this constant is │
   │ a product decision gated by the founder (Wave 2): it also needs real  │
   │ executors (today: RefusingExecutor), real credentials (today: fixture │
   │ markers), and the approval UI wired to /api/routines/resume.          │
   └──────────────────────────────────────────────────────────────────────┘ */

import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "../lib/runtime/catalog-specs";
import { resumeRun, runRoutine, type Adapters } from "../lib/runtime/engine";
import type { Store } from "../lib/runtime/store/interface";
import type { AccountContext, RoutineSpec, RunMode, RunResult } from "../lib/runtime/types";
import { effectiveSpec, getOrInitState } from "../lib/runtime/versioning";
import type { AccountsSource, WorkerAccount } from "./accounts";
import { FixtureCredentialProvider, type CredentialProvider } from "./credentials";
import type { Logger } from "./log";
import { WorkerConnectorReader } from "./providers/connectorReader";
import { RefusingExecutor } from "./providers/executor";
import { LlmDecisionProvider, type LlmClient } from "./providers/llmDecision";
import type { ScheduleCandidate } from "./scheduler";

/** Hard constant. See the box above — flipping it is founder-gated (Wave 2). */
export const LIVE_MODE_ENABLED: boolean = false;

export const WORKER_RUN_MODE: RunMode = "dry_run";

export type WorkerErrorCode = "live_mode_disabled" | "unknown_account" | "unknown_routine" | "invalid_request";

export class WorkerError extends Error {
  constructor(
    public readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

export interface ServiceDeps {
  store: Store;
  accounts: AccountsSource;
  /** Default: FixtureCredentialProvider — the only implementation that exists. */
  credentials?: CredentialProvider;
  /** null = no LLM (every llm-rule decide takes its fallback). Default null;
      the CLI passes createAnthropicLlmClient() which is env-gated. */
  llm?: LlmClient | null;
  now?: () => Date;
  log?: Logger;
  fetch?: typeof fetch;
}

export interface BuiltAdapters extends Adapters {
  executor: RefusingExecutor;
}

export function buildAdapters(deps: ServiceDeps): BuiltAdapters {
  const now = deps.now ?? (() => new Date());
  return {
    reader: new WorkerConnectorReader({ credentials: deps.credentials ?? new FixtureCredentialProvider(), now, log: deps.log, fetch: deps.fetch }),
    decider: new LlmDecisionProvider(deps.llm ?? null, { log: deps.log }),
    executor: new RefusingExecutor(),
    store: deps.store,
    now,
  };
}

// ---------- trigger ----------

export interface TriggerRunInput {
  accountId: string;
  routineId: string;
  /** Only "dry_run" is accepted while LIVE_MODE_ENABLED is false. Default "dry_run". */
  mode?: RunMode;
  triggeredBy?: "manual" | "schedule";
  /** Extra template vars, merged over the account's own. */
  vars?: Record<string, unknown>;
  /** Used only when the accounts source does not know `accountId` — lets the
      app dry-run for an account it holds elsewhere. */
  accountFallback?: Omit<AccountContext, "accountId">;
}

export function assertModeAllowed(mode: RunMode | undefined): RunMode {
  const m = mode ?? WORKER_RUN_MODE;
  if (m === "live" && !LIVE_MODE_ENABLED) throw new WorkerError("live_mode_disabled", "live mode is disabled (LIVE_MODE_ENABLED = false — Wave 2, founder-gated); only dry_run is available");
  if (m !== "dry_run" && m !== "live") throw new WorkerError("invalid_request", `unknown run mode "${String(m)}"`);
  return m;
}

export async function resolveAccount(deps: ServiceDeps, accountId: string, fallback?: Omit<AccountContext, "accountId">): Promise<WorkerAccount> {
  const known = await deps.accounts.getAccount(accountId);
  if (known) return known;
  if (fallback) return { account: { ...fallback, accountId } };
  throw new WorkerError("unknown_account", `account "${accountId}" is not known to the worker`);
}

export function catalogSpecOrThrow(routineId: string): RoutineSpec {
  const spec = CATALOG_SPEC_BY_ID[routineId];
  if (!spec) throw new WorkerError("unknown_routine", `routine "${routineId}" is not in the catalog`);
  return spec;
}

/** Dry-run one routine now, on its effective (promoted or catalog) spec. */
export async function triggerRun(deps: ServiceDeps, input: TriggerRunInput, adapters: Adapters = buildAdapters(deps)): Promise<RunResult> {
  const mode = assertModeAllowed(input.mode);
  const acct = await resolveAccount(deps, input.accountId, input.accountFallback);
  const catalog = catalogSpecOrThrow(input.routineId);
  const state = await getOrInitState({ store: deps.store, now: deps.now }, acct.account.accountId, catalog.id);
  const spec = effectiveSpec(state, catalog);
  deps.log?.info("run.start", { accountId: acct.account.accountId, routineId: spec.id, version: spec.version, mode, triggeredBy: input.triggeredBy ?? "manual" });
  const result = await runRoutine(spec, { account: acct.account, triggeredBy: input.triggeredBy ?? "manual", vars: { ...(acct.vars ?? {}), ...(input.vars ?? {}) } }, adapters, { mode });
  deps.log?.info("run.finish", { accountId: acct.account.accountId, routineId: spec.id, runId: result.runId, status: result.status, receipts: result.receipts.length, summary: result.summary });
  return result;
}

// ---------- resume ----------

export interface ResumeInput {
  runId: string;
  decision: "approved" | "held";
  decidedBy?: string;
}

/** Resume a run paused at its gate. The engine re-checks the approval, the
    expiry and (on execute) the caps; this worker's executor then refuses any
    mutation, so "approved" on a mutating routine ends failed-closed. */
export async function resumeApproval(deps: ServiceDeps, input: ResumeInput, adapters: Adapters = buildAdapters(deps)): Promise<RunResult> {
  deps.log?.info("resume.start", { runId: input.runId, decision: input.decision });
  const result = await resumeRun(input.runId, input.decision, adapters, { decidedBy: input.decidedBy });
  deps.log?.info("resume.finish", { runId: result.runId, routineId: result.routineId, status: result.status, summary: result.summary });
  return result;
}

// ---------- schedule candidates ----------

/** Every catalog routine that has a state row for this account, with its
    effective cadence and newest run — the scheduler's input. Routines with
    no state row have never been enabled and are skipped (no row is written). */
export async function collectCandidates(store: Store, accountId: string): Promise<ScheduleCandidate[]> {
  const out: ScheduleCandidate[] = [];
  for (const catalog of CATALOG_SPECS) {
    const state = await store.getRoutineState(accountId, catalog.id);
    if (!state) continue;
    const spec = effectiveSpec(state, catalog);
    const trigger = spec.nodes.find((n) => n.kind === "trigger");
    if (!trigger) continue;
    const [last] = await store.listRuns(accountId, { routineId: catalog.id, limit: 1 });
    out.push({
      accountId,
      routineId: catalog.id,
      enabled: state.enabled,
      cadence: trigger.cadence,
      lastRunStartedAt: last?.startedAt,
      lastRunInFlight: last?.status === "running",
    });
  }
  return out;
}
