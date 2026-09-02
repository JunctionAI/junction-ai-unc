/* The routines engine.

   runRoutine(spec, input, adapters, { mode })
     Executes the node chain in order. dry_run never calls the Executor and
     records what WOULD happen as kind:'draft' receipts (the gate becomes a
     draft approval preview, the execute a draft mutation). live pauses at
     the gate with status 'waiting_approval' and returns.

   resumeRun(runId, 'approved' | 'held', adapters)
     Continues a paused run from its snapshot. 'held' terminates it. Approval
     status is re-read from the Store at execute time, so a forged context
     cannot unlock an execute.

   Hard rules, enforced here regardless of who calls:
     • no execute without an approved, unexpired gate on THIS run
     • no execute unless mode === 'live'
     • no execute that would breach the account's per-day / per-month caps
       (spend already receipted counts against the caps)
   Each failure writes a receipt explaining why and fails the run closed. */

import {
  addHours,
  describePredicate,
  evaluatePredicate,
  newId,
  renderParams,
  renderTemplate,
  resolveSpend,
  stableHash,
  startOfDayUtc,
  startOfMonthUtc,
} from "./context";
import type { RunRecord, RunSnapshot, Store } from "./store/interface";
import type {
  AccountContext,
  ApprovalRecord,
  ConnectorReader,
  DecisionProvider,
  ExecuteNode,
  Executor,
  GateNode,
  Node,
  Receipt,
  ReceiptKind,
  RoutineSpec,
  RunContext,
  RunInput,
  RunMode,
  RunResult,
  RunStatus,
  SpendAmount,
  SpendCaps,
} from "./types";
import { assertValidSpec } from "./validate";

export interface Adapters {
  reader: ConnectorReader;
  decider: DecisionProvider;
  executor: Executor;
  store: Store;
  /** Injectable clock (tests, replays). */
  now?: () => Date;
  /** Injectable id generator. */
  idGen?: () => string;
}

export interface RunOptions {
  mode: RunMode;
}

export interface ResumeOptions {
  /** auth user id of the approver — lands in approvals.decided_by. */
  decidedBy?: string;
}

export function capsFor(account: AccountContext): SpendCaps {
  if (account.caps) return account.caps;
  const perMonth = Math.max(0, account.budgetMonthly ?? 0);
  return { currency: account.currency, perDay: Math.round((perMonth / 30) * 100) / 100, perMonth };
}

// ---------- session ----------

class RunSession {
  readonly receipts: Receipt[] = [];
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(
    private readonly spec: RoutineSpec,
    private ctx: RunContext,
    private run: RunRecord,
    private readonly adapters: Adapters,
  ) {
    this.now = adapters.now ?? (() => new Date());
    this.idGen = adapters.idGen ?? newId;
  }

  get store(): Store {
    return this.adapters.store;
  }
  private nowIso() {
    return this.now().toISOString();
  }
  private get dry() {
    return this.ctx.mode === "dry_run";
  }

  // ----- receipts -----

  async receipt(kind: ReceiptKind, description: string, payload: Record<string, unknown> = {}, extra: Partial<Pick<Receipt, "platform" | "approvalId" | "spend">> = {}) {
    const r: Receipt = {
      id: this.idGen(),
      accountId: this.ctx.account.accountId,
      runId: this.ctx.runId,
      kind,
      description,
      payload,
      createdAt: this.nowIso(),
      ...extra,
    };
    this.receipts.push(r);
    await this.store.appendReceipt(r);
    return r;
  }

  // ----- lifecycle -----

  private async finish(status: Exclude<RunStatus, "running" | "waiting_approval">, summary: string, error?: string): Promise<RunResult> {
    this.run = await this.store.updateRun(this.run.id, { status, summary, finishedAt: this.nowIso(), snapshot: undefined });
    return this.result(status, summary, error);
  }

  private result(status: RunStatus, summary: string, error?: string): RunResult {
    return {
      runId: this.ctx.runId,
      routineId: this.ctx.routineId,
      version: this.ctx.version,
      mode: this.ctx.mode,
      status,
      summary,
      receipts: [...this.receipts],
      approval: this.ctx.approval,
      error,
    };
  }

  private async fail(nodeId: string, message: string, payload: Record<string, unknown> = {}): Promise<RunResult> {
    await this.receipt("notification", `${nodeId}: ${message}`, { node: nodeId, ...payload });
    return this.finish("failed", message, message);
  }

  /** Execute nodes from `start` until the chain ends or pauses. */
  async runFrom(start: number): Promise<RunResult> {
    for (let i = start; i < this.spec.nodes.length; i++) {
      const node = this.spec.nodes[i];
      let outcome: RunResult | undefined;
      try {
        outcome = await this.step(node, i);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return this.fail(node.id, `${node.kind} failed: ${message}`);
      }
      if (outcome) return outcome;
    }
    // A chain always ends in a receipt node, which finishes the run; this is a
    // safety net for specs that slipped past validation.
    return this.finish("done", `Ran ${this.spec.name}.`);
  }

  private async step(node: Node, index: number): Promise<RunResult | undefined> {
    switch (node.kind) {
      case "trigger":
        return this.trigger(node);
      case "read":
        return this.read(node);
      case "check":
        return this.check(node);
      case "decide":
        return this.decide(node);
      case "gate":
        return this.gate(node, index);
      case "execute":
        return this.execute(node);
      case "receipt":
        return this.receiptNode(node);
    }
  }

  // ----- nodes -----

  private async trigger(node: Extract<Node, { kind: "trigger" }>) {
    const key = renderTemplate(node.dedupKey ?? "{{routine.id}}:{{today}}", this.ctx);
    this.run = await this.store.updateRun(this.run.id, { dedupKey: key });
    if (this.ctx.mode === "live" && this.ctx.triggeredBy !== "manual") {
      const dupes = (await this.store.listRuns(this.ctx.account.accountId, { dedupKey: key, mode: "live", since: startOfDayUtc(this.ctx.startedAt) })).filter(
        (r) => r.id !== this.run.id && r.status !== "failed",
      );
      if (dupes.length) {
        await this.receipt("notification", `Already ran today (dedup key ${key}); skipping.`, { dedupKey: key, priorRunId: dupes[0].id });
        return this.finish("skipped", `Already ran today (${dupes[0].id}).`);
      }
    }
    return undefined;
  }

  private async read(node: Extract<Node, { kind: "read" }>) {
    const result = await this.adapters.reader.read(node.source, node.query, this.ctx);
    if (node.freshnessMinutes !== undefined) {
      const ageMin = (this.now().getTime() - new Date(result.fetchedAt).getTime()) / 60_000;
      if (ageMin > node.freshnessMinutes) {
        return this.fail(node.id, `certified input from ${node.source} is ${Math.round(ageMin)} min old (limit ${node.freshnessMinutes})`, {
          platform: node.source,
          fetchedAt: result.fetchedAt,
        });
      }
    }
    this.ctx.reads[node.as] = result;
    await this.receipt(
      "read",
      `Read ${node.source} ${node.query.resource}${node.query.window ? ` over ${node.query.window}` : ""}: ${result.rows.length} rows.`,
      { as: node.as, query: node.query, rowCount: result.rows.length, metrics: result.metrics, fetchedAt: result.fetchedAt, provenance: result.provenance ?? "ok" },
      { platform: node.source },
    );
    return undefined;
  }

  private async check(node: Extract<Node, { kind: "check" }>) {
    const pass = evaluatePredicate(node.predicate, this.ctx);
    this.ctx.checks[node.id] = pass;
    const described = describePredicate(node.predicate, this.ctx);
    if (pass) {
      await this.receipt("notification", `Check passed: ${described}.`, { node: node.id, predicate: node.predicate, pass });
      return undefined;
    }
    const reason = node.reason ? renderTemplate(node.reason, this.ctx) : `Check did not pass: ${described}.`;
    if ((node.onFail ?? "skip") === "fail") return this.fail(node.id, reason, { predicate: node.predicate });
    await this.receipt("notification", reason, { node: node.id, predicate: node.predicate, pass });
    return this.finish("skipped", reason);
  }

  private async decide(node: Extract<Node, { kind: "decide" }>) {
    const decision = await this.adapters.decider.decide(node, this.ctx);
    if (!node.options.some((o) => o.id === decision.optionId)) {
      return this.fail(node.id, `decision provider returned unknown option "${decision.optionId}"`);
    }
    this.ctx.decision = decision;
    await this.receipt("draft", `Decided: ${decision.label}. ${decision.reasoning}`, {
      node: node.id,
      question: node.question,
      optionId: decision.optionId,
      reasoning: decision.reasoning,
      spend: decision.spend ?? null,
      params: decision.params ?? null,
    });
    if (decision.terminal) return this.finish("done", `${decision.label} — nothing to change today.`);
    return undefined;
  }

  private approvalDraft(node: GateNode): Omit<ApprovalRecord, "id" | "status" | "createdAt" | "expiresAt"> {
    return {
      accountId: this.ctx.account.accountId,
      runId: this.ctx.runId,
      routineId: this.ctx.routineId,
      title: renderTemplate(node.title, this.ctx),
      detail: node.detail ? renderTemplate(node.detail, this.ctx) : undefined,
      beforeState: node.before ? renderTemplate(node.before, this.ctx) : undefined,
      afterState: node.after ? renderTemplate(node.after, this.ctx) : undefined,
      reasoning: node.reasoning ? renderTemplate(node.reasoning, this.ctx) : this.ctx.decision?.reasoning,
    };
  }

  private async gate(node: GateNode, index: number) {
    const draft = this.approvalDraft(node);
    if (this.dry) {
      await this.receipt("draft", `Would ask ${node.approver ?? this.ctx.account.approver ?? "the founder"}: ${draft.title}`, {
        node: node.id,
        approvalPreview: { ...draft, expiryHours: node.expiryHours },
      });
      return undefined;
    }
    const createdAt = this.nowIso();
    const approval: ApprovalRecord = { ...draft, id: this.idGen(), status: "pending", createdAt, expiresAt: addHours(createdAt, node.expiryHours) };
    await this.store.createApproval(approval);
    this.ctx.approval = approval;
    await this.receipt("notification", `Waiting for approval: ${approval.title}`, { node: node.id, approvalId: approval.id, expiresAt: approval.expiresAt }, { approvalId: approval.id });
    const snapshot: RunSnapshot = { spec: this.spec, ctx: this.ctx, nextNodeIndex: index + 1 };
    this.run = await this.store.updateRun(this.run.id, { status: "waiting_approval", approvalId: approval.id, snapshot });
    return this.result("waiting_approval", `Waiting for approval: ${approval.title}`);
  }

  private async capsCheck(spend: SpendAmount | undefined): Promise<{ ok: boolean; reason?: string; dayUsed: number; monthUsed: number }> {
    const accountId = this.ctx.account.accountId;
    const now = this.nowIso();
    const [dayUsed, monthUsed] = await Promise.all([
      this.store.sumSpend(accountId, startOfDayUtc(now), now),
      this.store.sumSpend(accountId, startOfMonthUtc(now), now),
    ]);
    if (!spend || spend.amount <= 0) return { ok: true, dayUsed, monthUsed };
    const { perDay, perMonth, currency } = this.ctx.caps;
    if (spend.currency !== currency) return { ok: false, reason: `spend is in ${spend.currency} but caps are in ${currency}`, dayUsed, monthUsed };
    if (dayUsed + spend.amount > perDay) {
      return { ok: false, reason: `would take today's spend to ${currency} ${(dayUsed + spend.amount).toFixed(2)}, over the ${currency} ${perDay.toFixed(2)}/day cap`, dayUsed, monthUsed };
    }
    if (monthUsed + spend.amount > perMonth) {
      return { ok: false, reason: `would take this month's spend to ${currency} ${(monthUsed + spend.amount).toFixed(2)}, over the ${currency} ${perMonth.toFixed(2)}/month cap`, dayUsed, monthUsed };
    }
    return { ok: true, dayUsed, monthUsed };
  }

  /** The approval must exist in the Store, belong to this run, be approved and unexpired. */
  private async approvedGate(): Promise<{ ok: true; approval: ApprovalRecord } | { ok: false; reason: string }> {
    const id = this.ctx.approval?.id ?? this.run.approvalId;
    if (!id) return { ok: false, reason: "no approval exists for this run" };
    const approval = await this.store.getApproval(id);
    if (!approval) return { ok: false, reason: `approval ${id} not found` };
    if (approval.runId !== this.ctx.runId) return { ok: false, reason: `approval ${id} belongs to run ${approval.runId}, not ${this.ctx.runId}` };
    if (approval.status !== "approved") return { ok: false, reason: `approval ${id} is ${approval.status}, not approved` };
    if (approval.expiresAt < this.nowIso() && !approval.decidedAt) return { ok: false, reason: `approval ${id} expired at ${approval.expiresAt}` };
    return { ok: true, approval };
  }

  private async execute(node: ExecuteNode) {
    const mutation = { action: node.mutation.action, target: renderParams(node.mutation.target, this.ctx), params: renderParams(node.mutation.params, this.ctx) };
    const spend = this.ctx.decision?.spend ?? resolveSpend(node.spend, this.ctx);
    const base = { node: node.id, platform: node.platform, mutation, spend: spend ?? null };

    if (this.dry) {
      const caps = await this.capsCheck(spend);
      await this.receipt(
        "draft",
        `Would ${mutation.action} on ${node.platform}${spend ? ` (${spend.currency} ${spend.amount.toFixed(2)})` : ""}${caps.ok ? "" : ` — but caps would block it: ${caps.reason}`}.`,
        { ...base, dryRun: true, capsCheck: caps },
        { platform: node.platform },
      );
      return undefined;
    }

    // Hard rule 1: live only (belt and braces — dry handled above).
    if (this.ctx.mode !== "live") return this.fail(node.id, "execute is only possible in live mode", base);

    // Hard rule 2: approved gate on this run, re-read from the store.
    const gate = await this.approvedGate();
    if (!gate.ok) return this.fail(node.id, `Execution blocked — ${gate.reason}.`, base);

    // Hard rule 3: spend caps, counting spend already receipted.
    const caps = await this.capsCheck(spend);
    if (!caps.ok) {
      return this.fail(node.id, `Execution blocked — ${caps.reason}.`, { ...base, capsCheck: caps });
    }

    const result = await this.adapters.executor.execute(node, mutation, this.ctx);
    this.ctx.execution = result;
    if (!result.ok) {
      await this.receipt("notification", `${mutation.action} on ${node.platform} failed: ${result.error ?? "unknown error"}`, { ...base, result }, { platform: node.platform, approvalId: gate.approval.id });
      return this.finish("failed", result.error ?? "execution failed", result.error ?? "execution failed");
    }
    await this.receipt(
      "mutation",
      `${mutation.action} on ${node.platform}${spend ? ` — ${spend.currency} ${spend.amount.toFixed(2)} committed` : ""}${result.externalRef ? ` (${result.externalRef})` : ""}.`,
      { ...base, readback: result.readback ?? null, externalRef: result.externalRef ?? null, rollback: node.rollback ?? null },
      { platform: node.platform, approvalId: gate.approval.id, spend },
    );
    return undefined;
  }

  private async receiptNode(node: Extract<Node, { kind: "receipt" }>) {
    const summary = node.summary ? renderTemplate(node.summary, this.ctx) : this.dry ? `Dry run of ${this.spec.name} complete.` : `${this.spec.name} complete.`;
    await this.receipt(this.dry ? "draft" : "notification", summary, {
      node: node.id,
      measurementWindowDays: node.measurementWindowDays ?? null,
      reads: Object.keys(this.ctx.reads),
      decision: this.ctx.decision?.optionId ?? null,
      approval: this.ctx.approval?.id ?? null,
      executed: this.ctx.execution?.ok ?? false,
    });
    return this.finish("done", summary);
  }
}

// ---------- public API ----------

export async function runRoutine(spec: RoutineSpec, input: RunInput, adapters: Adapters, opts: RunOptions): Promise<RunResult> {
  assertValidSpec(spec);
  const now = adapters.now ?? (() => new Date());
  const idGen = adapters.idGen ?? newId;
  const startedAt = now().toISOString();
  const ctx: RunContext = {
    runId: idGen(),
    routineId: spec.id,
    version: spec.version,
    mode: opts.mode,
    startedAt,
    account: input.account,
    caps: capsFor(input.account),
    triggeredBy: input.triggeredBy ?? "schedule",
    vars: input.vars ?? {},
    reads: {},
    checks: {},
  };
  const run = await adapters.store.createRun({
    id: ctx.runId,
    accountId: input.account.accountId,
    routineId: spec.id,
    version: spec.version,
    mode: opts.mode,
    status: "running",
    startedAt,
    specHash: stableHash(spec),
  });
  return new RunSession(spec, ctx, run, adapters).runFrom(0);
}

export async function resumeRun(runId: string, decision: "approved" | "held", adapters: Adapters, opts: ResumeOptions = {}): Promise<RunResult> {
  const store = adapters.store;
  const now = adapters.now ?? (() => new Date());
  const idGen = adapters.idGen ?? newId;
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "waiting_approval") throw new Error(`run ${runId} is ${run.status}, not waiting_approval`);
  if (!run.snapshot || !run.approvalId) throw new Error(`run ${runId} has no resumable snapshot`);
  const approval = await store.getApproval(run.approvalId);
  if (!approval) throw new Error(`approval ${run.approvalId} not found`);
  if (approval.status !== "pending") throw new Error(`approval ${approval.id} already ${approval.status}`);

  const { spec, ctx, nextNodeIndex } = run.snapshot;
  const nowIso = now().toISOString();
  const session = new RunSession(spec, ctx, run, adapters);

  if (approval.expiresAt < nowIso) {
    const expired = await store.updateApproval(approval.id, { status: "expired" });
    ctx.approval = expired;
    await session.receipt("notification", `Approval expired at ${approval.expiresAt} — nothing was changed.`, { approvalId: approval.id }, { approvalId: approval.id });
    await store.updateRun(run.id, { status: "skipped", summary: "Approval expired.", finishedAt: nowIso, snapshot: undefined });
    return { runId: run.id, routineId: run.routineId, version: run.version, mode: run.mode, status: "skipped", summary: "Approval expired.", receipts: session.receipts, approval: expired };
  }

  const decided = await store.updateApproval(approval.id, { status: decision, decidedAt: nowIso, decidedBy: opts.decidedBy });
  ctx.approval = decided;
  await store.appendTasteEvent({
    id: idGen(),
    accountId: run.accountId,
    approvalId: decided.id,
    routineId: run.routineId,
    action: decision,
    context: { runId: run.id, title: decided.title, decidedBy: opts.decidedBy ?? null },
    createdAt: nowIso,
  });

  if (decision === "held") {
    await session.receipt("notification", `Held: ${decided.title} — nothing was changed.`, { approvalId: decided.id }, { approvalId: decided.id });
    await store.updateRun(run.id, { status: "skipped", summary: `Held: ${decided.title}`, finishedAt: nowIso, snapshot: undefined });
    return { runId: run.id, routineId: run.routineId, version: run.version, mode: run.mode, status: "skipped", summary: `Held: ${decided.title}`, receipts: session.receipts, approval: decided };
  }

  await session.receipt("notification", `Approved: ${decided.title}`, { approvalId: decided.id }, { approvalId: decided.id });
  await store.updateRun(run.id, { status: "running", snapshot: undefined });
  return session.runFrom(nextNodeIndex);
}

