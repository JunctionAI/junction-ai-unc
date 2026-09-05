/* Store — the runtime's persistence boundary.

   Designed so a Supabase adapter maps 1:1 onto supabase/migrations/0001_init.sql.
   Every method is account-scoped (RLS does the rest server-side).

   TABLE MAPPING
   ─────────────────────────────────────────────────────────────────────────
   RoutineStateRecord  → routine_states
     accountId         → account_id
     routineId         → routine_id
     enabled           → enabled
     version           → version            (the LIVE version number)
     draftSpec         → draft_spec (jsonb) (RoutineSpec | null; its .version = version + 1)
     liveSpec          → live_spec  (jsonb) (RoutineSpec | null; null = catalog default)
     updatedAt         → updated_at

   RunRecord           → routine_runs
     id                → id
     accountId         → account_id
     routineId         → routine_id
     version           → version
     mode              → mode   ('live' | 'dry_run')
     status            → status ('running' | 'waiting_approval' | 'done' | 'failed' | 'skipped')
     startedAt         → started_at
     finishedAt        → finished_at
     summary           → summary
     approvalId        → *needs column*  approval_id uuid references approvals(id)
     dedupKey          → *needs column*  dedup_key text          (index (account_id, dedup_key))
     specHash          → *needs column*  spec_hash text          (promote checks the dry run
                                                                  ran the exact draft)
     snapshot          → *needs column*  snapshot jsonb          (RunSnapshot: spec + ctx +
                                                                  nextNodeIndex, written when a
                                                                  gate pauses the run; cleared on
                                                                  finish)
     → these four columns are migration 0002 (not written by the runtime work).

   ApprovalRecord      → approvals
     id/accountId/runId/routineId → id/account_id/run_id/routine_id
     title/detail      → title/detail
     beforeState       → before_state
     afterState        → after_state
     reasoning         → reasoning
     status            → status ('pending' | 'approved' | 'held' | 'expired')
     expiresAt         → expires_at
     decidedAt         → decided_at
     decidedBy         → decided_by (uuid; the runtime treats it as an opaque string)
     createdAt         → created_at

   Receipt             → receipts
     id/accountId/runId/approvalId → id/account_id/run_id/approval_id
     kind              → kind ('read' | 'draft' | 'mutation' | 'notification')
     platform          → platform
     description       → description
     payload           → payload (jsonb)
     spend             → payload.spend   (the adapter folds it into payload as
                                          {amount, currency, period}; sumSpend reads it back
                                          with  (payload->'spend'->>'amount')::numeric)
     createdAt         → created_at

   TasteEvent          → taste_events
     id/accountId/approvalId/routineId → id/account_id/approval_id/routine_id
     action            → action ('approved' | 'held' | 'why_opened' | 'edited')
     context           → context (jsonb)
     createdAt         → created_at

   ── migration 0006 (telemetry) ──
   OutcomeRecord       → routine_outcomes
     id/accountId/routineId/runId → id/account_id/routine_id/run_id
     kpiKey/kpiTarget/kpiOp/kpiActual → kpi_key/kpi_target/kpi_op/kpi_actual
     provenance        → provenance
     windowStart/windowEnd/measuredAt → window_start/window_end/measured_at
     (upsert on account_id,routine_id,kpi_key,window_end)

   SelfReviewRecord    → self_reviews
     id/accountId      → id/account_id
     weekStart         → week_start (date, 'YYYY-MM-DD')
     body              → body
     changes           → changes (jsonb)
     evidence          → evidence (jsonb)
     createdAt         → created_at
     (upsert on account_id,week_start)

   BenchmarkRecord     → benchmarks
     metricKey/segment → metric_key/segment   (primary key)
     p50/p75/n         → p50/p75/n
     computedAt        → computed_at

   BenchmarkOptin      → benchmark_optins
     accountId/optedIn → account_id/opted_in

   ── migration 0013 (artifacts — routines produce real work) ──
   Artifact            → artifacts
     id/accountId/runId/routineId → id/account_id/run_id/routine_id
     kind/title/body   → kind/title/body
     items/meta/evidence → items/meta/evidence (jsonb)
     status            → status ('draft' | 'approved' | 'held' | 'edited' | 'used')
     editedBody        → edited_body
     createdAt         → created_at
   N8nWorkflow         → n8n_workflows (read-only for the runtime; Tom registers rows)
     id/accountId(null = global)/routineId/webhookUrl/active → id/account_id/routine_id/webhook_url/active
   routine_runs.status gains 'waiting_input'; RunSnapshot gains needs / awaiting.
   ───────────────────────────────────────────────────────────────────────── */

import type {
  ApprovalRecord,
  ApprovalStatus,
  Artifact,
  ArtifactStatus,
  KpiContract,
  N8nWorkflow,
  ProduceNeed,
  Receipt,
  ReceiptKind,
  RoutineId,
  RoutineSpec,
  RunContext,
  RunMode,
  RunStatus,
  TasteEvent,
} from "../types";

// ---------- telemetry records (migration 0006) ----------

export interface OutcomeRecord {
  id: string;
  accountId: string;
  routineId: RoutineId;
  /** Newest completed run inside the window. */
  runId?: string;
  kpiKey: string;
  kpiTarget: number;
  kpiOp: KpiContract["op"];
  /** null = couldn't measure; `provenance` says why. */
  kpiActual: number | null;
  /** ok | empty | fixture | runs | error:<reason> */
  provenance: string;
  windowStart: string;
  windowEnd: string;
  measuredAt: string;
}

export type SelfReviewChangeAction = "enable" | "disable" | "reprioritise" | "adjust_cadence";

export interface SelfReviewChange {
  action: SelfReviewChangeAction;
  routineId: RoutineId;
  /** adjust_cadence only: "manual" or a 5-field cron. */
  cadence?: string;
  why: string;
}

export interface SelfReviewRecord {
  id: string;
  accountId: string;
  /** Monday (UTC) of the reviewed week, YYYY-MM-DD. */
  weekStart: string;
  body: string;
  changes: SelfReviewChange[];
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface BenchmarkRecord {
  metricKey: string;
  segment: string;
  p50: number;
  p75: number;
  /** Accounts that contributed — never below 5 (anonymisation floor). */
  n: number;
  computedAt: string;
}

export interface BenchmarkOptin {
  accountId: string;
  optedIn: boolean;
}

export interface ListOutcomesOptions {
  routineId?: RoutineId;
  kpiKey?: string;
  /** ISO timestamp; only outcomes whose window ended at/after it. */
  since?: string;
  limit?: number;
}

export interface ListTasteEventsOptions {
  since?: string;
  limit?: number;
}

export interface RoutineStateRecord {
  accountId: string;
  routineId: RoutineId;
  enabled: boolean;
  version: number;
  draftSpec: RoutineSpec | null;
  liveSpec: RoutineSpec | null;
  updatedAt: string;
}

/** Everything needed to resume a paused run without re-reading anything. */
export interface RunSnapshot {
  spec: RoutineSpec;
  ctx: RunContext;
  nextNodeIndex: number;
  /** waiting_input: what the producer asked for (resume-input re-runs the produce node). */
  needs?: ProduceNeed[];
  /** A run whose artifact an n8n workflow will deliver later (POST /api/routines/artifacts). */
  awaiting?: "n8n";
}

export interface ListArtifactsOptions {
  contextGeneration?: number;
  runId?: string;
  routineId?: RoutineId;
  status?: ArtifactStatus;
  limit?: number;
}

export interface RunRecord {
  id: string;
  accountId: string;
  /** Immutable captured account generation. Legacy absence means generation zero only. */
  contextGeneration?: number;
  routineId: RoutineId;
  version: number;
  mode: RunMode;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  approvalId?: string;
  dedupKey?: string;
  specHash?: string;
  snapshot?: RunSnapshot;
}

export interface ListRunsOptions {
  contextGeneration?: number;
  routineId?: RoutineId;
  mode?: RunMode;
  status?: RunStatus;
  version?: number;
  dedupKey?: string;
  /** ISO timestamp; only runs started at/after it. */
  since?: string;
  limit?: number;
}

export interface ListReceiptsOptions {
  contextGeneration?: number;
  runId?: string;
  kind?: ReceiptKind;
  since?: string;
  limit?: number;
}

export interface Store {
  // ----- routine_states -----
  getRoutineState(accountId: string, routineId: RoutineId): Promise<RoutineStateRecord | null>;
  putRoutineState(record: RoutineStateRecord): Promise<RoutineStateRecord>;
  /** Every state row the account has (routines never enabled have none). */
  listRoutineStates(accountId: string): Promise<RoutineStateRecord[]>;

  // ----- routine_runs -----
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: Partial<Omit<RunRecord, "id" | "accountId">>): Promise<RunRecord>;
  /** Newest first. */
  listRuns(accountId: string, opts?: ListRunsOptions): Promise<RunRecord[]>;

  // ----- approvals -----
  createApproval(approval: ApprovalRecord): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | null>;
  updateApproval(
    approvalId: string,
    patch: Partial<Pick<ApprovalRecord, "status" | "decidedAt" | "decidedBy">>,
    expectedStatus?: ApprovalStatus,
  ): Promise<ApprovalRecord>;
  listApprovals(accountId: string, status?: ApprovalStatus, contextGeneration?: number): Promise<ApprovalRecord[]>;

  // ----- receipts (append-only) -----
  appendReceipt(receipt: Receipt): Promise<Receipt>;
  /** Oldest first within a run; newest first across an account. */
  listReceipts(accountId: string, opts?: ListReceiptsOptions): Promise<Receipt[]>;
  /** Sum of mutation-receipt spend with since <= created_at <= until
      (inclusive both ends — a receipt stamped at exactly `now` counts). */
  sumSpend(accountId: string, since: string, until: string): Promise<number>;

  // ----- taste_events (append-only) -----
  appendTasteEvent(event: TasteEvent): Promise<TasteEvent>;
  /** Newest first. */
  listTasteEvents(accountId: string, opts?: ListTasteEventsOptions): Promise<TasteEvent[]>;

  // ----- routine_outcomes (migration 0006; service-role writes) -----
  /** Idempotent per (account, routine, kpi, window_end). */
  upsertOutcome(outcome: OutcomeRecord): Promise<OutcomeRecord>;
  /** Newest window first. */
  listOutcomes(accountId: string, opts?: ListOutcomesOptions): Promise<OutcomeRecord[]>;
  /** Every account's outcomes with window_end ≥ since — the benchmark input (worker only;
      the service role is the only reader that can see across accounts). */
  listOutcomesAcrossAccounts(since: string): Promise<OutcomeRecord[]>;

  // ----- self_reviews -----
  /** Idempotent per (account, week_start). */
  putSelfReview(review: SelfReviewRecord): Promise<SelfReviewRecord>;
  getLatestSelfReview(accountId: string): Promise<SelfReviewRecord | null>;

  // ----- benchmarks (anonymised; n ≥ 5) -----
  putBenchmarks(rows: BenchmarkRecord[]): Promise<BenchmarkRecord[]>;
  getBenchmark(metricKey: string, segment: string): Promise<BenchmarkRecord | null>;
  listBenchmarks(segment?: string): Promise<BenchmarkRecord[]>;
  listBenchmarkOptins(): Promise<BenchmarkOptin[]>;

  // ----- artifacts (migration 0013) -----
  putArtifact(artifact: Artifact): Promise<Artifact>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  updateArtifact(artifactId: string, patch: Partial<Pick<Artifact, "status" | "editedBody">>, expectedStatus?: ArtifactStatus): Promise<Artifact>;
  /** Newest first. */
  listArtifacts(accountId: string, opts?: ListArtifactsOptions): Promise<Artifact[]>;

  // ----- n8n_workflows (read by the engine; written by Tom / the service role) -----
  /** The active workflow for this routine: the account's own row first, then a global row
      (account_id null); null when none is registered. */
  findN8nWorkflow(accountId: string, routineId: RoutineId): Promise<N8nWorkflow | null>;
  putN8nWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow>;
  /** Every row that applies to this account — its own (any state) and the global ones
      (account_id null) — for the skills registry (GET /api/skills/n8n). */
  listN8nWorkflows(accountId: string): Promise<N8nWorkflow[]>;
}
