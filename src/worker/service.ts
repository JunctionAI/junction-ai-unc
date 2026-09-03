/* The shared "run a routine now / resume a paused run" service.

   Used by BOTH the always-on loop (src/worker/loop.ts) and the app's API
   routes (src/app/api/routines/run, /resume), so a manual trigger and a
   scheduled tick go through exactly the same adapters and the same checks.

   Pure of Node specifics (no fs, no signals, no http) so Next can bundle it.

   ┌──────────────────────────────────────────────────────────────────────┐
   │ LIVE_MODE_ENABLED = false                                             │
   │ Every run this service starts is a DRY RUN. Flipping this constant is │
   │ a product decision gated by the founder (Wave 2): it also needs real  │
   │ executors (ActionExecutor: dry-run shapes, live refuses). Credentials │
   │ (real tokens when DB + secret store are configured, fixtures else);   │
   │ the approval UI is wired to /api/approvals/<id> → resumeApproval.     │
   └──────────────────────────────────────────────────────────────────────┘ */

import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "../lib/runtime/catalog-specs";
import { completeExternalArtifact, resumeRun, resumeRunWithInput, runRoutine, type Adapters } from "../lib/runtime/engine";
import type { Store } from "../lib/runtime/store/interface";
import type { AccountContext, ArtifactDraft, N8nBridge, ProduceNeed, Producer, RoutineSpec, RunMode, RunResult } from "../lib/runtime/types";
import { effectiveSpec, getOrInitState } from "../lib/runtime/versioning";
import type { AccountsSource, WorkerAccount } from "./accounts";
import type { DbClient } from "../lib/db/types";
import type { CredentialProvider } from "./credentials";
import type { Logger } from "./log";
import { WorkerConnectorReader } from "./providers/connectorReader";
import { ActionExecutor, enabledActionRisks } from "./providers/executor";
import { LlmDecisionProvider, StorePersonalisation, type LlmClient } from "./providers/llmDecision";
import { RulesDecisionProvider, type PresetSource } from "../lib/actions";
import { presetSource } from "../lib/runtime/presets/store";
import { HttpN8nBridge } from "./providers/n8n";
import { createProducerClient, DbProducerContext, LlmProducer } from "./providers/producer";
import type { ScheduleCandidate } from "./scheduler";
import { defaultCredentialProvider, serviceDb } from "./wiring";

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
  /** Default: wiring.ts defaultCredentialProvider() — ConnectorCredentialProvider when the
      DB + secret store are configured, FixtureCredentialProvider otherwise. */
  credentials?: CredentialProvider;
  /** null = no LLM (every llm-rule decide takes its fallback). Default null;
      the CLI passes createAnthropicLlmClient() which is env-gated. */
  llm?: LlmClient | null;
  /** Service-role client: lets the decider read account_profiles (tone / decision style) and
      the producer read the business profile, memories, goal and plan. undefined = the service
      role when configured (wiring.ts serviceDb); null = none. */
  db?: DbClient | null;
  /** The produce-step Producer. undefined = LlmProducer on the router (task routine_produce);
      null = none (a produce node fails the run closed). Tests inject a fake. */
  producer?: Producer | null;
  /** The n8n bridge. undefined = HttpN8nBridge on process.env; null = none. */
  n8n?: N8nBridge | null;
  /** Decision presets for the rule-bound routines + the Meta guards. undefined = presetSource(db)
      (src/lib/runtime/presets/store.ts: account_presets / routine_params → MetaPreset; defaults
      without a database); null = the library defaults. */
  presets?: PresetSource | null;
  now?: () => Date;
  log?: Logger;
  fetch?: typeof fetch;
}

export interface BuiltAdapters extends Adapters {
  executor: ActionExecutor;
}

let producerOverride: Producer | null | undefined;
/** Tests only: the Producer every buildAdapters() call gets (undefined = restore the default). */
export function setProducerForTests(producer: Producer | null | undefined): void {
  producerOverride = producer;
}

export function buildAdapters(deps: ServiceDeps): BuiltAdapters {
  const now = deps.now ?? (() => new Date());
  const db = deps.db === undefined ? serviceDb() : deps.db;
  const chosen = producerOverride !== undefined ? producerOverride : deps.producer;
  const producer = chosen === undefined ? new LlmProducer(createProducerClient(), { context: new DbProducerContext(db, deps.store, { now, log: deps.log }), log: deps.log, now }) : (chosen ?? undefined);
  const n8n = deps.n8n === undefined ? new HttpN8nBridge({ env: process.env, fetch: deps.fetch, now, log: deps.log }) : (deps.n8n ?? undefined);
  const presets = deps.presets === undefined ? presetSource(db) : deps.presets;
  const credentials = deps.credentials ?? defaultCredentialProvider(process.env, deps.log ? (line) => deps.log?.info("credentials", { line }) : undefined);
  const personalisation = new StorePersonalisation(deps.store, db, { now });
  const llmDecider = new LlmDecisionProvider(deps.llm ?? null, { log: deps.log, personalisation });
  return {
    reader: new WorkerConnectorReader({ credentials, now, log: deps.log, fetch: deps.fetch }),
    // Rule-bound routines (D02-W01) decide deterministically; the LLM only writes the line.
    decider: new RulesDecisionProvider(llmDecider, { presets, writer: deps.llm ?? null, log: deps.log ? (event, fields) => deps.log?.info(event, fields) : undefined }),
    executor: new ActionExecutor({
      liveModeEnabled: LIVE_MODE_ENABLED,
      enabledRisks: enabledActionRisks(process.env),
      credentials,
      presets,
      spendCeiling: async (accountId, currency) => (await personalisation.forAccount(accountId, currency))?.spendCeiling ?? null,
      now,
      fetch: deps.fetch,
      log: deps.log,
    }),
    store: deps.store,
    ...(producer ? { producer } : {}),
    ...(n8n ? { n8n } : {}),
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

// ---------- resume with the founder's answers ----------

export interface ResumeInputInput {
  runId: string;
  answers: Record<string, unknown>;
}

/** A run that ended waiting_input takes the answers and re-runs its produce step. */
export async function resumeWithInput(deps: ServiceDeps, input: ResumeInputInput, adapters: Adapters = buildAdapters(deps)): Promise<RunResult> {
  deps.log?.info("resume_input.start", { runId: input.runId, answered: Object.keys(input.answers ?? {}) });
  const result = await resumeRunWithInput(input.runId, input.answers, adapters);
  deps.log?.info("resume_input.finish", { runId: result.runId, routineId: result.routineId, status: result.status, summary: result.summary });
  return result;
}

// ---------- external (n8n) artifact delivery ----------

export type ExternalArtifactInput = { runId: string; artifact: ArtifactDraft } | { runId: string; needs: ProduceNeed[] };

/** POST /api/routines/artifacts: a workflow the engine handed a run to delivers the artifact. */
export async function completeExternal(deps: ServiceDeps, input: ExternalArtifactInput, adapters: Adapters = buildAdapters(deps)): Promise<RunResult> {
  deps.log?.info("external_artifact.start", { runId: input.runId, kind: "artifact" in input ? input.artifact.kind : "needs" });
  const result = await completeExternalArtifact(input.runId, "artifact" in input ? { artifact: input.artifact } : { needs: input.needs }, adapters);
  deps.log?.info("external_artifact.finish", { runId: result.runId, routineId: result.routineId, status: result.status });
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
