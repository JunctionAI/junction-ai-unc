/* SupabaseStore — the Store contract on supabase/migrations/0001 + 0002.

   Column mapping is exactly the table in interface.ts. The adapter is written against the
   minimal DbClient slice (src/lib/db/types.ts) so it runs unchanged on the real client and
   on the in-memory fake used by the tests (src/lib/db/__tests__/fakeSupabase.ts), which
   is how the mapping is verified without a live project.

   Semantics mirror MemoryStore:
     - records come back with optional fields *omitted* (not null) so deep-equality holds;
     - timestamps are normalised to ISO-8601 with milliseconds on read (Postgres would
       otherwise hand back "+00:00" formatting);
     - updateRun with an explicit `undefined` value writes NULL (snapshot cleared on finish);
     - createRun on an existing id throws (primary-key violation);
     - updateRun / updateApproval on an unknown id throw (0 rows for .single()).

   sumSpend sums payload.spend.amount in JS over the mutation receipts in the window. Upgrade
   path once volume warrants it: a `sum_spend(account_id, since, until)` SQL function using
   (payload->'spend'->>'amount')::numeric over receipts_spend_idx, called via db.rpc. */

import type { ApprovalRecord, ApprovalStatus, Artifact, N8nWorkflow, Receipt, RoutineId, SpendAmount, TasteEvent } from "../types";
import type {
  BenchmarkOptin,
  BenchmarkRecord,
  ListArtifactsOptions,
  ListOutcomesOptions,
  ListReceiptsOptions,
  ListRunsOptions,
  ListTasteEventsOptions,
  OutcomeRecord,
  RoutineStateRecord,
  RunRecord,
  RunSnapshot,
  SelfReviewRecord,
  Store,
} from "./interface";
import { unwrap, type DbClient, type Row } from "../../db/types";

// ---------- helpers ----------

const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

/** Postgres returns timestamptz as "2026-09-02T07:00:00+00:00"; the runtime compares ISO strings. */
const ts = (v: unknown): string => (typeof v === "string" ? new Date(v).toISOString() : String(v));
const tsOpt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : ts(v));
const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

/** Drop undefined keys so records deep-equal MemoryStore's JSON-cloned ones. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

// ---------- row ↔ record ----------

function stateToRow(r: RoutineStateRecord): Row {
  return {
    account_id: r.accountId,
    routine_id: r.routineId,
    enabled: r.enabled,
    version: r.version,
    draft_spec: r.draftSpec,
    live_spec: r.liveSpec,
    updated_at: r.updatedAt,
  };
}
function rowToState(row: Row): RoutineStateRecord {
  return {
    accountId: row.account_id as string,
    routineId: row.routine_id as RoutineId,
    enabled: !!row.enabled,
    version: Number(row.version),
    draftSpec: (row.draft_spec as RoutineStateRecord["draftSpec"]) ?? null,
    liveSpec: (row.live_spec as RoutineStateRecord["liveSpec"]) ?? null,
    updatedAt: ts(row.updated_at),
  };
}

function runToRow(r: RunRecord): Row {
  return {
    id: r.id,
    account_id: r.accountId,
    routine_id: r.routineId,
    version: r.version,
    mode: r.mode,
    status: r.status,
    started_at: r.startedAt,
    finished_at: nul(r.finishedAt),
    summary: nul(r.summary),
    approval_id: nul(r.approvalId),
    dedup_key: nul(r.dedupKey),
    spec_hash: nul(r.specHash),
    snapshot: nul(r.snapshot),
  };
}
const RUN_PATCH_COLUMNS: Record<keyof Omit<RunRecord, "id" | "accountId">, string> = {
  routineId: "routine_id",
  version: "version",
  mode: "mode",
  status: "status",
  startedAt: "started_at",
  finishedAt: "finished_at",
  summary: "summary",
  approvalId: "approval_id",
  dedupKey: "dedup_key",
  specHash: "spec_hash",
  snapshot: "snapshot",
};
function runPatchToRow(patch: Partial<Omit<RunRecord, "id" | "accountId">>): Row {
  const row: Row = {};
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    const col = RUN_PATCH_COLUMNS[k];
    if (col) row[col] = nul(patch[k]); // explicit undefined → NULL (clears)
  }
  return row;
}
function rowToRun(row: Row): RunRecord {
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    routineId: row.routine_id as RoutineId,
    version: Number(row.version),
    mode: row.mode as RunRecord["mode"],
    status: row.status as RunRecord["status"],
    startedAt: ts(row.started_at),
    finishedAt: tsOpt(row.finished_at),
    summary: opt<string>(row.summary),
    approvalId: opt<string>(row.approval_id),
    dedupKey: opt<string>(row.dedup_key),
    specHash: opt<string>(row.spec_hash),
    snapshot: opt<RunSnapshot>(row.snapshot),
  });
}

function approvalToRow(a: ApprovalRecord): Row {
  return {
    id: a.id,
    account_id: a.accountId,
    run_id: a.runId,
    routine_id: a.routineId,
    title: a.title,
    detail: nul(a.detail),
    before_state: nul(a.beforeState),
    after_state: nul(a.afterState),
    reasoning: nul(a.reasoning),
    status: a.status,
    expires_at: a.expiresAt,
    decided_at: nul(a.decidedAt),
    decided_by: nul(a.decidedBy),
    created_at: a.createdAt,
  };
}
function rowToApproval(row: Row): ApprovalRecord {
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    runId: row.run_id as string,
    routineId: row.routine_id as RoutineId,
    title: row.title as string,
    detail: opt<string>(row.detail),
    beforeState: opt<string>(row.before_state),
    afterState: opt<string>(row.after_state),
    reasoning: opt<string>(row.reasoning),
    status: row.status as ApprovalStatus,
    expiresAt: ts(row.expires_at),
    decidedAt: tsOpt(row.decided_at),
    decidedBy: opt<string>(row.decided_by),
    createdAt: ts(row.created_at),
  });
}

function receiptToRow(r: Receipt): Row {
  // spend folds into payload.spend → sumSpend reads (payload->'spend'->>'amount')
  const payload: Row = { ...r.payload };
  if (r.spend) payload.spend = r.spend;
  return {
    id: r.id,
    account_id: r.accountId,
    run_id: r.runId,
    approval_id: nul(r.approvalId),
    kind: r.kind,
    platform: nul(r.platform),
    description: r.description,
    payload,
    created_at: r.createdAt,
  };
}
function rowToReceipt(row: Row): Receipt {
  const { spend, ...payload } = (row.payload as Row | null) ?? {};
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    runId: row.run_id as string,
    approvalId: opt<string>(row.approval_id),
    kind: row.kind as Receipt["kind"],
    platform: opt<Receipt["platform"]>(row.platform),
    description: row.description as string,
    payload,
    spend: spend && typeof spend === "object" ? (spend as SpendAmount) : undefined,
    createdAt: ts(row.created_at),
  });
}

function tasteToRow(e: TasteEvent): Row {
  return {
    id: e.id,
    account_id: e.accountId,
    approval_id: nul(e.approvalId),
    routine_id: nul(e.routineId),
    action: e.action,
    context: e.context,
    created_at: e.createdAt,
  };
}
function rowToTaste(row: Row): TasteEvent {
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    approvalId: opt<string>(row.approval_id),
    routineId: opt<RoutineId>(row.routine_id),
    action: row.action as TasteEvent["action"],
    context: (row.context as Row) ?? {},
    createdAt: ts(row.created_at),
  });
}

// ---------- telemetry rows (migration 0006) ----------

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function outcomeToRow(o: OutcomeRecord): Row {
  return {
    id: o.id,
    account_id: o.accountId,
    routine_id: o.routineId,
    run_id: nul(o.runId),
    kpi_key: o.kpiKey,
    kpi_target: o.kpiTarget,
    kpi_op: o.kpiOp,
    kpi_actual: o.kpiActual,
    provenance: o.provenance,
    window_start: o.windowStart,
    window_end: o.windowEnd,
    measured_at: o.measuredAt,
  };
}
function rowToOutcome(row: Row): OutcomeRecord {
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    routineId: row.routine_id as RoutineId,
    runId: opt<string>(row.run_id),
    kpiKey: row.kpi_key as string,
    kpiTarget: Number(row.kpi_target),
    kpiOp: (row.kpi_op as OutcomeRecord["kpiOp"]) ?? "gte",
    kpiActual: numOrNull(row.kpi_actual),
    provenance: (row.provenance as string) ?? "ok",
    windowStart: ts(row.window_start),
    windowEnd: ts(row.window_end),
    measuredAt: ts(row.measured_at),
  });
}

function reviewToRow(r: SelfReviewRecord): Row {
  return { id: r.id, account_id: r.accountId, week_start: r.weekStart, body: r.body, changes: r.changes, evidence: r.evidence, created_at: r.createdAt };
}
function rowToReview(row: Row): SelfReviewRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    weekStart: String(row.week_start).slice(0, 10),
    body: row.body as string,
    changes: (row.changes as SelfReviewRecord["changes"]) ?? [],
    evidence: (row.evidence as Row) ?? {},
    createdAt: ts(row.created_at),
  };
}

function benchmarkToRow(b: BenchmarkRecord): Row {
  return { metric_key: b.metricKey, segment: b.segment, p50: b.p50, p75: b.p75, n: b.n, computed_at: b.computedAt };
}
function rowToBenchmark(row: Row): BenchmarkRecord {
  return { metricKey: row.metric_key as string, segment: row.segment as string, p50: Number(row.p50), p75: Number(row.p75), n: Number(row.n), computedAt: ts(row.computed_at) };
}

// ---------- artifacts (migration 0013) ----------

function artifactToRow(a: Artifact): Row {
  return {
    id: a.id,
    account_id: a.accountId,
    run_id: a.runId,
    routine_id: a.routineId,
    kind: a.kind,
    title: a.title,
    body: a.body,
    items: a.items,
    meta: a.meta,
    evidence: a.evidence,
    status: a.status,
    edited_body: nul(a.editedBody),
    created_at: a.createdAt,
  };
}
function rowToArtifact(row: Row): Artifact {
  return compact({
    id: row.id as string,
    accountId: row.account_id as string,
    runId: row.run_id as string,
    routineId: row.routine_id as RoutineId,
    kind: row.kind as Artifact["kind"],
    title: row.title as string,
    body: row.body as string,
    items: (row.items as Artifact["items"]) ?? [],
    meta: (row.meta as Row) ?? {},
    evidence: (row.evidence as Artifact["evidence"]) ?? [],
    status: row.status as Artifact["status"],
    editedBody: opt<string>(row.edited_body),
    createdAt: ts(row.created_at),
  });
}
function rowToWorkflow(row: Row): N8nWorkflow {
  return { id: row.id as string, accountId: (row.account_id as string | null) ?? null, routineId: row.routine_id as RoutineId, webhookUrl: row.webhook_url as string, active: !!row.active };
}

// ---------- the adapter ----------

export class SupabaseStore implements Store {
  constructor(private readonly db: DbClient) {}

  // ----- routine_states -----
  async getRoutineState(accountId: string, routineId: RoutineId) {
    const row = await unwrap<Row | null>(
      "routine_states.select",
      this.db.from("routine_states").select("*").eq("account_id", accountId).eq("routine_id", routineId).maybeSingle(),
    );
    return row ? rowToState(row) : null;
  }
  async putRoutineState(record: RoutineStateRecord) {
    const row = await unwrap<Row>(
      "routine_states.upsert",
      this.db.from("routine_states").upsert(stateToRow(record), { onConflict: "account_id,routine_id" }).select().single(),
    );
    return rowToState(row);
  }
  async listRoutineStates(accountId: string) {
    const rows = await unwrap<Row[]>("routine_states.select", this.db.from("routine_states").select("*").eq("account_id", accountId));
    return rows.map(rowToState);
  }

  // ----- routine_runs -----
  async createRun(run: RunRecord) {
    const row = await unwrap<Row>("routine_runs.insert", this.db.from("routine_runs").insert(runToRow(run)).select().single());
    return rowToRun(row);
  }
  async getRun(runId: string) {
    const row = await unwrap<Row | null>("routine_runs.select", this.db.from("routine_runs").select("*").eq("id", runId).maybeSingle());
    return row ? rowToRun(row) : null;
  }
  async updateRun(runId: string, patch: Partial<Omit<RunRecord, "id" | "accountId">>) {
    const row = await unwrap<Row>(
      "routine_runs.update",
      this.db.from("routine_runs").update(runPatchToRow(patch)).eq("id", runId).select().single(),
    );
    return rowToRun(row);
  }
  async listRuns(accountId: string, opts: ListRunsOptions = {}) {
    let q = this.db.from("routine_runs").select("*").eq("account_id", accountId);
    if (opts.routineId) q = q.eq("routine_id", opts.routineId);
    if (opts.mode) q = q.eq("mode", opts.mode);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.version !== undefined) q = q.eq("version", opts.version);
    if (opts.dedupKey) q = q.eq("dedup_key", opts.dedupKey);
    if (opts.since) q = q.gte("started_at", opts.since);
    q = q.order("started_at", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const rows = await unwrap<Row[]>("routine_runs.select", q);
    return rows.map(rowToRun);
  }

  // ----- approvals -----
  async createApproval(approval: ApprovalRecord) {
    const row = await unwrap<Row>("approvals.insert", this.db.from("approvals").insert(approvalToRow(approval)).select().single());
    return rowToApproval(row);
  }
  async getApproval(approvalId: string) {
    const row = await unwrap<Row | null>("approvals.select", this.db.from("approvals").select("*").eq("id", approvalId).maybeSingle());
    return row ? rowToApproval(row) : null;
  }
  async updateApproval(approvalId: string, patch: Partial<Pick<ApprovalRecord, "status" | "decidedAt" | "decidedBy">>) {
    const row: Row = {};
    if ("status" in patch) row.status = nul(patch.status);
    if ("decidedAt" in patch) row.decided_at = nul(patch.decidedAt);
    if ("decidedBy" in patch) row.decided_by = nul(patch.decidedBy);
    const out = await unwrap<Row>("approvals.update", this.db.from("approvals").update(row).eq("id", approvalId).select().single());
    return rowToApproval(out);
  }
  async listApprovals(accountId: string, status?: ApprovalStatus) {
    let q = this.db.from("approvals").select("*").eq("account_id", accountId);
    if (status) q = q.eq("status", status);
    q = q.order("created_at", { ascending: false });
    const rows = await unwrap<Row[]>("approvals.select", q);
    return rows.map(rowToApproval);
  }

  // ----- receipts (append-only) -----
  async appendReceipt(receipt: Receipt) {
    const row = await unwrap<Row>("receipts.insert", this.db.from("receipts").insert(receiptToRow(receipt)).select().single());
    return rowToReceipt(row);
  }
  async listReceipts(accountId: string, opts: ListReceiptsOptions = {}) {
    let q = this.db.from("receipts").select("*").eq("account_id", accountId);
    if (opts.runId) q = q.eq("run_id", opts.runId);
    if (opts.kind) q = q.eq("kind", opts.kind);
    if (opts.since) q = q.gte("created_at", opts.since);
    // oldest first within a run (chronological receipt trail); newest first otherwise
    q = q.order("created_at", { ascending: !!opts.runId });
    if (opts.limit) q = q.limit(opts.limit);
    const rows = await unwrap<Row[]>("receipts.select", q);
    return rows.map(rowToReceipt);
  }
  async sumSpend(accountId: string, since: string, until: string) {
    const rows = await unwrap<Row[]>(
      "receipts.select",
      this.db
        .from("receipts")
        .select("payload")
        .eq("account_id", accountId)
        .eq("kind", "mutation")
        .gte("created_at", since)
        .lte("created_at", until),
    );
    let sum = 0;
    for (const row of rows) {
      const spend = (row.payload as Row | null)?.spend as { amount?: unknown } | undefined;
      const amount = Number(spend?.amount);
      if (Number.isFinite(amount)) sum += amount;
    }
    return sum;
  }

  // ----- taste_events (append-only) -----
  async appendTasteEvent(event: TasteEvent) {
    const row = await unwrap<Row>("taste_events.insert", this.db.from("taste_events").insert(tasteToRow(event)).select().single());
    return rowToTaste(row);
  }
  async listTasteEvents(accountId: string, opts: ListTasteEventsOptions = {}) {
    let q = this.db.from("taste_events").select("*").eq("account_id", accountId);
    if (opts.since) q = q.gte("created_at", opts.since);
    q = q.order("created_at", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const rows = await unwrap<Row[]>("taste_events.select", q);
    return rows.map(rowToTaste);
  }

  // ----- routine_outcomes (service-role writes) -----
  async upsertOutcome(outcome: OutcomeRecord) {
    const row = await unwrap<Row>(
      "routine_outcomes.upsert",
      this.db.from("routine_outcomes").upsert(outcomeToRow(outcome), { onConflict: "account_id,routine_id,kpi_key,window_end" }).select().single(),
    );
    return rowToOutcome(row);
  }
  async listOutcomes(accountId: string, opts: ListOutcomesOptions = {}) {
    let q = this.db.from("routine_outcomes").select("*").eq("account_id", accountId);
    if (opts.routineId) q = q.eq("routine_id", opts.routineId);
    if (opts.kpiKey) q = q.eq("kpi_key", opts.kpiKey);
    if (opts.since) q = q.gte("window_end", opts.since);
    q = q.order("window_end", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const rows = await unwrap<Row[]>("routine_outcomes.select", q);
    return rows.map(rowToOutcome);
  }
  async listOutcomesAcrossAccounts(since: string) {
    const rows = await unwrap<Row[]>("routine_outcomes.select", this.db.from("routine_outcomes").select("*").gte("window_end", since).order("window_end", { ascending: false }));
    return rows.map(rowToOutcome);
  }

  // ----- self_reviews -----
  async putSelfReview(review: SelfReviewRecord) {
    const row = await unwrap<Row>("self_reviews.upsert", this.db.from("self_reviews").upsert(reviewToRow(review), { onConflict: "account_id,week_start" }).select().single());
    return rowToReview(row);
  }
  async getLatestSelfReview(accountId: string) {
    const rows = await unwrap<Row[]>("self_reviews.select", this.db.from("self_reviews").select("*").eq("account_id", accountId).order("week_start", { ascending: false }).limit(1));
    return rows.length ? rowToReview(rows[0]) : null;
  }

  // ----- benchmarks -----
  async putBenchmarks(rows: BenchmarkRecord[]) {
    if (!rows.length) return [];
    for (const r of rows) if (r.n < 5) throw new Error(`benchmark ${r.metricKey}/${r.segment} has n=${r.n} < 5 (anonymisation floor)`);
    const out = await unwrap<Row[]>("benchmarks.upsert", this.db.from("benchmarks").upsert(rows.map(benchmarkToRow), { onConflict: "metric_key,segment" }).select());
    return out.map(rowToBenchmark);
  }
  async getBenchmark(metricKey: string, segment: string) {
    const row = await unwrap<Row | null>("benchmarks.select", this.db.from("benchmarks").select("*").eq("metric_key", metricKey).eq("segment", segment).maybeSingle());
    return row ? rowToBenchmark(row) : null;
  }
  async listBenchmarks(segment?: string) {
    let q = this.db.from("benchmarks").select("*");
    if (segment) q = q.eq("segment", segment);
    const rows = await unwrap<Row[]>("benchmarks.select", q.order("metric_key", { ascending: true }));
    return rows.map(rowToBenchmark);
  }
  async listBenchmarkOptins(): Promise<BenchmarkOptin[]> {
    const rows = await unwrap<Row[]>("benchmark_optins.select", this.db.from("benchmark_optins").select("account_id, opted_in"));
    return rows.map((r) => ({ accountId: r.account_id as string, optedIn: !!r.opted_in }));
  }

  // ----- artifacts -----
  async putArtifact(artifact: Artifact) {
    const row = await unwrap<Row>("artifacts.insert", this.db.from("artifacts").insert(artifactToRow(artifact)).select().single());
    return rowToArtifact(row);
  }
  async getArtifact(artifactId: string) {
    const row = await unwrap<Row | null>("artifacts.select", this.db.from("artifacts").select("*").eq("id", artifactId).maybeSingle());
    return row ? rowToArtifact(row) : null;
  }
  async updateArtifact(artifactId: string, patch: Partial<Pick<Artifact, "status" | "editedBody">>) {
    const row: Row = {};
    if ("status" in patch) row.status = nul(patch.status);
    if ("editedBody" in patch) row.edited_body = nul(patch.editedBody);
    const out = await unwrap<Row>("artifacts.update", this.db.from("artifacts").update(row).eq("id", artifactId).select().single());
    return rowToArtifact(out);
  }
  async listArtifacts(accountId: string, opts: ListArtifactsOptions = {}) {
    let q = this.db.from("artifacts").select("*").eq("account_id", accountId);
    if (opts.runId) q = q.eq("run_id", opts.runId);
    if (opts.routineId) q = q.eq("routine_id", opts.routineId);
    if (opts.status) q = q.eq("status", opts.status);
    q = q.order("created_at", { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const rows = await unwrap<Row[]>("artifacts.select", q);
    return rows.map(rowToArtifact);
  }

  // ----- n8n_workflows -----
  async findN8nWorkflow(accountId: string, routineId: RoutineId) {
    const rows = await unwrap<Row[]>("n8n_workflows.select", this.db.from("n8n_workflows").select("*").eq("routine_id", routineId).eq("active", true));
    const all = rows.map(rowToWorkflow);
    return all.find((w) => w.accountId === accountId) ?? all.find((w) => w.accountId === null) ?? null;
  }
  async putN8nWorkflow(workflow: N8nWorkflow) {
    const row = await unwrap<Row>(
      "n8n_workflows.upsert",
      this.db.from("n8n_workflows").upsert({ id: workflow.id, account_id: workflow.accountId, routine_id: workflow.routineId, webhook_url: workflow.webhookUrl, active: workflow.active }, { onConflict: "id" }).select().single(),
    );
    return rowToWorkflow(row);
  }
  async listN8nWorkflows(accountId: string) {
    const [own, global] = await Promise.all([
      unwrap<Row[]>("n8n_workflows.select", this.db.from("n8n_workflows").select("*").eq("account_id", accountId)),
      unwrap<Row[]>("n8n_workflows.select", this.db.from("n8n_workflows").select("*").is("account_id", null)),
    ]);
    return [...own, ...global].map(rowToWorkflow);
  }
}
