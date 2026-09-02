/* In-memory Store. Reference implementation + test double; the Supabase
   adapter implements the same interface (see interface.ts for the mapping). */

import type { ApprovalRecord, ApprovalStatus, Receipt, RoutineId, TasteEvent } from "../types";
import type {
  BenchmarkOptin,
  BenchmarkRecord,
  ListOutcomesOptions,
  ListReceiptsOptions,
  ListRunsOptions,
  ListTasteEventsOptions,
  OutcomeRecord,
  RoutineStateRecord,
  RunRecord,
  SelfReviewRecord,
  Store,
} from "./interface";

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class MemoryStore implements Store {
  private states = new Map<string, RoutineStateRecord>();
  private runs = new Map<string, RunRecord>();
  private approvals = new Map<string, ApprovalRecord>();
  private receipts: Receipt[] = [];
  private tasteEvents: TasteEvent[] = [];
  private outcomes = new Map<string, OutcomeRecord>();
  private selfReviews = new Map<string, SelfReviewRecord>();
  private benchmarks = new Map<string, BenchmarkRecord>();
  private optins = new Map<string, boolean>();

  private static stateKey(accountId: string, routineId: RoutineId) {
    return `${accountId}:${routineId}`;
  }

  // ----- routine_states -----
  async getRoutineState(accountId: string, routineId: RoutineId) {
    const rec = this.states.get(MemoryStore.stateKey(accountId, routineId));
    return rec ? clone(rec) : null;
  }
  async putRoutineState(record: RoutineStateRecord) {
    this.states.set(MemoryStore.stateKey(record.accountId, record.routineId), clone(record));
    return clone(record);
  }
  async listRoutineStates(accountId: string) {
    return clone([...this.states.values()].filter((r) => r.accountId === accountId));
  }

  // ----- routine_runs -----
  async createRun(run: RunRecord) {
    if (this.runs.has(run.id)) throw new Error(`run ${run.id} already exists`);
    this.runs.set(run.id, clone(run));
    return clone(run);
  }
  async getRun(runId: string) {
    const run = this.runs.get(runId);
    return run ? clone(run) : null;
  }
  async updateRun(runId: string, patch: Partial<Omit<RunRecord, "id" | "accountId">>) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const next = { ...run, ...clone(patch) };
    // explicit undefined clears (e.g. snapshot: undefined on finish)
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete next[k];
    this.runs.set(runId, next);
    return clone(next);
  }
  async listRuns(accountId: string, opts: ListRunsOptions = {}) {
    const out = [...this.runs.values()]
      .filter((r) => r.accountId === accountId)
      .filter((r) => (opts.routineId ? r.routineId === opts.routineId : true))
      .filter((r) => (opts.mode ? r.mode === opts.mode : true))
      .filter((r) => (opts.status ? r.status === opts.status : true))
      .filter((r) => (opts.version !== undefined ? r.version === opts.version : true))
      .filter((r) => (opts.dedupKey ? r.dedupKey === opts.dedupKey : true))
      .filter((r) => (opts.since ? r.startedAt >= opts.since : true))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    return clone(opts.limit ? out.slice(0, opts.limit) : out);
  }

  // ----- approvals -----
  async createApproval(approval: ApprovalRecord) {
    this.approvals.set(approval.id, clone(approval));
    return clone(approval);
  }
  async getApproval(approvalId: string) {
    const a = this.approvals.get(approvalId);
    return a ? clone(a) : null;
  }
  async updateApproval(approvalId: string, patch: Partial<Pick<ApprovalRecord, "status" | "decidedAt" | "decidedBy">>) {
    const a = this.approvals.get(approvalId);
    if (!a) throw new Error(`approval ${approvalId} not found`);
    const next = { ...a, ...clone(patch) };
    this.approvals.set(approvalId, next);
    return clone(next);
  }
  async listApprovals(accountId: string, status?: ApprovalStatus) {
    return clone(
      [...this.approvals.values()]
        .filter((a) => a.accountId === accountId && (status ? a.status === status : true))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  }

  // ----- receipts -----
  async appendReceipt(receipt: Receipt) {
    this.receipts.push(clone(receipt));
    return clone(receipt);
  }
  async listReceipts(accountId: string, opts: ListReceiptsOptions = {}) {
    let out = this.receipts.filter((r) => r.accountId === accountId);
    if (opts.runId) out = out.filter((r) => r.runId === opts.runId);
    if (opts.kind) out = out.filter((r) => r.kind === opts.kind);
    if (opts.since) out = out.filter((r) => r.createdAt >= opts.since!);
    // oldest first within a run (chronological receipt trail); newest first otherwise
    if (!opts.runId) out = [...out].reverse();
    if (opts.limit) out = out.slice(0, opts.limit);
    return clone(out);
  }
  async sumSpend(accountId: string, since: string, until: string) {
    return this.receipts
      .filter((r) => r.accountId === accountId && r.kind === "mutation" && r.spend)
      .filter((r) => r.createdAt >= since && r.createdAt <= until)
      .reduce((sum, r) => sum + (r.spend?.amount ?? 0), 0);
  }

  // ----- taste_events -----
  async appendTasteEvent(event: TasteEvent) {
    this.tasteEvents.push(clone(event));
    return clone(event);
  }

  async listTasteEvents(accountId: string, opts: ListTasteEventsOptions = {}) {
    let out = this.tasteEvents.filter((e) => e.accountId === accountId);
    if (opts.since) out = out.filter((e) => e.createdAt >= opts.since!);
    out = [...out].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    if (opts.limit) out = out.slice(0, opts.limit);
    return clone(out);
  }

  // ----- routine_outcomes -----
  private static outcomeKey(o: Pick<OutcomeRecord, "accountId" | "routineId" | "kpiKey" | "windowEnd">) {
    return `${o.accountId}:${o.routineId}:${o.kpiKey}:${o.windowEnd}`;
  }
  async upsertOutcome(outcome: OutcomeRecord) {
    const key = MemoryStore.outcomeKey(outcome);
    const existing = this.outcomes.get(key);
    const next = clone({ ...outcome, id: existing?.id ?? outcome.id });
    this.outcomes.set(key, next);
    return clone(next);
  }
  async listOutcomes(accountId: string, opts: ListOutcomesOptions = {}) {
    let out = [...this.outcomes.values()].filter((o) => o.accountId === accountId);
    if (opts.routineId) out = out.filter((o) => o.routineId === opts.routineId);
    if (opts.kpiKey) out = out.filter((o) => o.kpiKey === opts.kpiKey);
    if (opts.since) out = out.filter((o) => o.windowEnd >= opts.since!);
    out = out.sort((a, b) => (a.windowEnd < b.windowEnd ? 1 : a.windowEnd > b.windowEnd ? -1 : a.routineId < b.routineId ? -1 : 1));
    if (opts.limit) out = out.slice(0, opts.limit);
    return clone(out);
  }
  async listOutcomesAcrossAccounts(since: string) {
    return clone([...this.outcomes.values()].filter((o) => o.windowEnd >= since).sort((a, b) => (a.windowEnd < b.windowEnd ? 1 : a.windowEnd > b.windowEnd ? -1 : 0)));
  }

  // ----- self_reviews -----
  async putSelfReview(review: SelfReviewRecord) {
    const key = `${review.accountId}:${review.weekStart}`;
    const existing = this.selfReviews.get(key);
    const next = clone({ ...review, id: existing?.id ?? review.id });
    this.selfReviews.set(key, next);
    return clone(next);
  }
  async getLatestSelfReview(accountId: string) {
    const mine = [...this.selfReviews.values()].filter((r) => r.accountId === accountId).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    return mine.length ? clone(mine[0]) : null;
  }

  // ----- benchmarks -----
  async putBenchmarks(rows: BenchmarkRecord[]) {
    for (const r of rows) {
      if (r.n < 5) throw new Error(`benchmark ${r.metricKey}/${r.segment} has n=${r.n} < 5 (anonymisation floor)`);
      this.benchmarks.set(`${r.metricKey}:${r.segment}`, clone(r));
    }
    return clone(rows);
  }
  async getBenchmark(metricKey: string, segment: string) {
    const b = this.benchmarks.get(`${metricKey}:${segment}`);
    return b ? clone(b) : null;
  }
  async listBenchmarks(segment?: string) {
    return clone([...this.benchmarks.values()].filter((b) => (segment ? b.segment === segment : true)).sort((a, b) => (a.metricKey < b.metricKey ? -1 : a.metricKey > b.metricKey ? 1 : a.segment < b.segment ? -1 : 1)));
  }
  async listBenchmarkOptins(): Promise<BenchmarkOptin[]> {
    return [...this.optins.entries()].map(([accountId, optedIn]) => ({ accountId, optedIn }));
  }

  /** Test helper — not part of the Store interface (the real row is written by the founder). */
  setBenchmarkOptin(accountId: string, optedIn: boolean) {
    this.optins.set(accountId, optedIn);
  }
}
