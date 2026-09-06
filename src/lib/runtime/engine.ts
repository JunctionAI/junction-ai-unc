/* The routines engine.

   runRoutine(spec, input, adapters, { mode })
     Executes the node chain in order. dry_run never calls Executor.execute:
     it records what WOULD happen as kind:'draft' receipts (the gate becomes a
     draft approval preview, the execute a draft mutation — shaped through
     Executor.dryRun when the mutation names a typed action). live pauses at
     the gate with status 'waiting_approval' and returns.

   resumeRun(runId, 'approved' | 'held', adapters)
     Continues a paused run from its snapshot. 'held' terminates it. Approval
     status is re-read from the Store at execute time, so a forged context
     cannot unlock an execute.

   resumeRunWithInput(runId, answers, adapters)
     A run that ended waiting_input (the producer asked for something) takes
     the founder's answers into ctx.inputs and re-runs its produce step.

   completeExternalArtifact(runId, result, adapters)
     A run handed to an n8n workflow (202 accepted) receives the artifact — or
     a `needs` list — through POST /api/routines/artifacts and carries on.

   The produce step (produce / n8n nodes) is where a routine makes real work:
   the artifact is stored (Store.putArtifact), linked from a `draft` receipt,
   and shown in the gate preview. Producing is never outward: dry_run and live
   both produce. A producer that lacks what the skill needs answers `needs` and
   the run ends waiting_input with a receipt "To draft this I need …" — never a
   silent skip. Optional reads that cannot be answered land as "unavailable"
   with a receipt and the chain carries on.

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
  Artifact,
  ArtifactDraft,
  ConnectorReader,
  DecisionProvider,
  ExecuteNode,
  Executor,
  GateNode,
  Mutation,
  N8nBridge,
  N8nNode,
  Node,
  ProduceNeed,
  ProduceNode,
  Producer,
  ReadResult,
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
import { assertSameRuntimeContext, runtimeGeneration, RuntimeContextError, type RuntimeContextIdentity } from "./contextFence";
import { MemoryStore } from "./store/memory";
import { assertProtocolRequest as assertShadowRequest, shadowKind, type ShadowKind } from "../n8n/shadowProtocols";
import { isPaidShadowRoutine } from "../n8n/paidShadowContract";

const UNSAFE_PROPOSAL_STATUSES = new Set(["BLOCKED", "HOLD", "PARTIAL"]);

function unsafeStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase();
  return UNSAFE_PROPOSAL_STATUSES.has(status) ? status : null;
}

/** Only explicit machine-readable (or leading STATUS line) refusal signals count here.
    Generic artifacts stay compatible; the engine does not try to judge their prose. */
function proposalBlocker(artifact: Artifact, expectedAction: string): string | null {
  const bodyStatus = artifact.body.match(/^\s*(?:#{1,6}\s*)?(?:\*\*)?STATUS(?:\*\*)?\s*:\s*(?:\*\*)?(BLOCKED|HOLD|PARTIAL)\b/im)?.[1];
  const rootStatus = unsafeStatus(artifact.meta.status) ?? unsafeStatus(bodyStatus);
  if (rootStatus) return `artifact status is ${rootStatus}`;
  if (artifact.meta.apply_ready === false) return "artifact explicitly says apply_ready is false";

  const rootAction = artifact.meta.action_id;
  if (typeof rootAction === "string" && rootAction.trim() && rootAction.trim() !== expectedAction) {
    return `artifact action_id ${rootAction.trim()} does not match ${expectedAction}`;
  }

  for (const [index, item] of artifact.items.entries()) {
    const itemStatus = unsafeStatus(item.meta?.status);
    if (itemStatus) return `artifact item ${index + 1} status is ${itemStatus}`;
    if (item.meta?.apply_ready === false) return `artifact item ${index + 1} explicitly says apply_ready is false`;
    const itemAction = item.meta?.action_id;
    if (typeof itemAction === "string" && itemAction.trim() && itemAction.trim() !== expectedAction) {
      return `artifact item ${index + 1} action_id ${itemAction.trim()} does not match ${expectedAction}`;
    }
  }
  return null;
}

export interface Adapters {
  reader: ConnectorReader;
  decider: DecisionProvider;
  executor: Executor;
  store: Store;
  /** Production DB runtimes revalidate the captured generation/pause. SQL separately
   * fences persistence atomically; this guard does not hold a lock over provider calls. */
  assertContext?: (identity: RuntimeContextIdentity) => Promise<void>;
  /** Makes the artifact at a produce node. Absent → a produce node fails the run closed. */
  producer?: Producer;
  /** Hands a produce step to a registered n8n workflow, or runs an explicit n8n node. */
  n8n?: N8nBridge;
  /** Atomic keyword artifact + dry review/receipt completion from the verified ledger.
   * Never accepted from a workflow callback or a model-provided result. */
  completeKeywordShadow?: (run: RunRecord) => Promise<RunResult>;
  completeCalendarShadow?: (run: RunRecord) => Promise<RunResult>;
  /** Paid-ads lanes (AVGAR Meta routines + Google Ads plan) complete from their own verified ledger. */
  completePaidShadow?: (run: RunRecord) => Promise<RunResult>;
  /** Injectable clock (tests, replays). */
  now?: () => Date;
  /** Injectable id generator. */
  idGen?: () => string;
}

export interface RunOptions {
  mode: RunMode;
  /** Authenticated manual admission. Only the durable claim winner executes;
   * a replay returns the original saved result without invoking any nodes. */
  admitManualStart?: (run: RunRecord) => Promise<{ start: true; run: RunRecord } | { start: false; result: RunResult }>;
  /** Trusted queue-assigned identity; never accepted from an unauthenticated request. */
  runId?: string;
  /** Operator-only atomic registration/run/permit issuance. Not wired to chat, routes
   * or schedules. Must throw on a previous/uncertain issuance, never restart it. */
  reserveKeywordShadowRun?: (run: RunRecord) => Promise<RunRecord>;
  /** One durable winner across initial starts and operator recovery. No I/O on false
   * or a lost reply; a possibly committed start must never be automatically retried. */
  claimKeywordShadowStart?: (run: RunRecord) => Promise<boolean>;
  /** A distinct calendar allowance; never alias the keyword ledger or generic manual claim. */
  reserveCalendarShadowRun?: (run: RunRecord) => Promise<RunRecord>;
  claimCalendarShadowStart?: (run: RunRecord) => Promise<boolean>;
  /** A distinct paid-ads allowance per run; never aliases the keyword or calendar ledgers. */
  reservePaidShadowRun?: (run: RunRecord) => Promise<RunRecord>;
  claimPaidShadowStart?: (run: RunRecord) => Promise<boolean>;
}

export interface ResumeOptions {
  /** auth user id of the approver — lands in approvals.decided_by. */
  decidedBy?: string;
}

/** One honest line per need — the receipt copy and the UI's "Needs: X". */
export function describeNeed(need: ProduceNeed): string {
  if (need.platform) return `${need.platform} connected — ${need.why}`;
  if (need.input) return `${need.input.replace(/_/g, " ")} — ${need.why}`;
  return need.why;
}

export function describeNeeds(needs: ProduceNeed[]): string {
  return needs.map(describeNeed).join("; ");
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
  private readonly fencedStore: Store;

  constructor(
    private readonly spec: RoutineSpec,
    private ctx: RunContext,
    private run: RunRecord,
    private readonly adapters: Adapters,
  ) {
    this.now = adapters.now ?? (() => new Date());
    this.idGen = adapters.idGen ?? newId;
    // Keep this identity independent of mutable provider context and run patches.
    const captured = Object.freeze({ accountId: run.accountId, contextGeneration: runtimeGeneration(run.contextGeneration) });
    this.assertContext = async () => {
      assertSameRuntimeContext(captured, this.ctx.account);
      await adapters.assertContext?.(captured);
    };
    this.fencedStore = new Proxy(adapters.store, { get: (target, key) => {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        await this.assertContext();
        return value.apply(target, args);
      };
    } });
  }

  private readonly assertContext: () => Promise<void>;

  get store(): Store {
    return this.fencedStore;
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

  private async finish(status: Exclude<RunStatus, "running" | "waiting_approval" | "waiting_input">, summary: string, error?: string): Promise<RunResult> {
    this.run = await this.store.updateRun(this.run.id, { status, summary, finishedAt: this.nowIso(), snapshot: undefined });
    return this.result(status, summary, error);
  }

  private result(status: RunStatus, summary: string, error?: string, needs?: ProduceNeed[]): RunResult {
    return {
      runId: this.ctx.runId,
      routineId: this.ctx.routineId,
      version: this.ctx.version,
      mode: this.ctx.mode,
      status,
      summary,
      receipts: [...this.receipts],
      approval: this.ctx.approval,
      artifact: this.ctx.artifact,
      needs,
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
        await this.assertContext();
        outcome = await this.step(node, i);
        await this.assertContext();
      } catch (err) {
        // Do not turn a stale result into a new-context failure receipt or retry.
        if (err instanceof RuntimeContextError) throw err;
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
      case "produce":
        return this.produce(node, index);
      case "n8n":
        return this.n8n(node, index);
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
    let result: ReadResult;
    try {
      result = await this.adapters.reader.read(node.source, node.query, this.ctx);
    } catch (err) {
      if (!node.optional) throw err;
      // An optional read that couldn't be asked: say so, land an empty result, carry on.
      const reason = err instanceof Error ? err.message : String(err);
      this.ctx.reads[node.as] = { rows: [], metrics: {}, fetchedAt: this.nowIso(), provenance: "unavailable" };
      await this.receipt(
        "notification",
        `Couldn’t read ${node.source} ${node.query.resource} (${reason.replace(/^couldn't ask [^:]+: /, "")}) — drafting from what I have.`,
        { as: node.as, query: node.query, rowCount: 0, provenance: "unavailable", reason, optional: true },
        { platform: node.source },
      );
      return undefined;
    }
    if (node.freshnessMinutes !== undefined) {
      const ageMin = (this.now().getTime() - new Date(result.fetchedAt).getTime()) / 60_000;
      if (!Number.isFinite(ageMin) || ageMin < -0.5 || ageMin > node.freshnessMinutes) {
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
      { as: node.as, query: node.query, rowCount: result.rows.length, metrics: result.metrics, fetchedAt: result.fetchedAt, provenance: result.provenance ?? "ok", ...(result.dataset ? { dataset: result.dataset } : {}), ...(result.sourceNote ? { sourceNote: result.sourceNote } : {}) },
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

  // ----- produce (the real work) -----

  /** Store the artifact, link it from a draft receipt, land it in the context. */
  private async storeArtifact(node: ProduceNode | N8nNode, draft: ArtifactDraft, via: "producer" | "n8n"): Promise<Artifact> {
    const artifact: Artifact = {
      id: this.idGen(),
      accountId: this.ctx.account.accountId,
      runId: this.ctx.runId,
      routineId: this.ctx.routineId,
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      items: draft.items ?? [],
      meta: { ...(draft.meta ?? {}), via, node: node.id, mode: this.ctx.mode },
      evidence: draft.evidence ?? [],
      status: "draft",
      createdAt: this.nowIso(),
    };
    await this.store.putArtifact(artifact);
    this.ctx.artifact = artifact;
    const n = artifact.items.length;
    await this.receipt("draft", `Drafted: ${artifact.title}${n ? ` (${n} ${n === 1 ? "item" : "items"})` : ""}.`, {
      node: node.id,
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      title: artifact.title,
      items: n,
      evidence: artifact.evidence.length,
      via,
      ...(via === "n8n" && node.kind === "n8n" && node.shadowContract
        ? { externalExecution: artifact.meta.executionReceipt } : {}),
    });
    return artifact;
  }

  /** The producer asked for something: receipt it honestly, hold a snapshot at THIS node so
      resume-input re-runs it with the answers, end waiting_input. */
  private async waitForInput(node: ProduceNode | N8nNode, index: number, needs: ProduceNeed[], note?: string): Promise<RunResult> {
    const line = `To draft this I need: ${describeNeeds(needs)}.${note ? ` ${note}` : ""}`;
    await this.receipt("notification", line, { node: node.id, needs, note: note ?? null });
    const snapshot: RunSnapshot = { spec: this.spec, ctx: this.ctx, nextNodeIndex: index, needs };
    this.run = await this.store.updateRun(this.run.id, { status: "waiting_input", summary: line, snapshot });
    return this.result("waiting_input", line, undefined, needs);
  }

  private async produce(node: ProduceNode, index: number): Promise<RunResult | undefined> {
    // A registered n8n workflow for this routine takes the step over (Tom's workflows as skills).
    // When the workflow cannot answer (unreachable, timeout, a rejected artifact) and a producer
    // exists, the built-in skill drafts instead — with a receipt saying so. An explicit n8n node
    // (the n8n() step) never falls back: the spec asked for that workflow by name.
    let fallbackFrom: string | null = null;
    if (this.adapters.n8n) {
      const workflow = await this.store.findN8nWorkflow(this.ctx.account.accountId, this.ctx.routineId);
      if (workflow) {
        try {
          return await this.callN8n(node, index, workflow);
        } catch (err) {
          if (!this.adapters.producer) throw err;
          const reason = err instanceof Error ? err.message : String(err);
          fallbackFrom = workflow.id;
          await this.receipt("notification", `Your n8n workflow couldn’t answer (${reason}) — drafting with my built-in skill instead.`, { node: node.id, workflowId: workflow.id, fallback: "producer", reason });
        }
      }
    }
    const producer = this.adapters.producer;
    if (!producer) return this.fail(node.id, "no producer is configured — nothing was drafted", { node: node.id });
    const out = await producer.produce(node, this.ctx);
    if ("needs" in out) return this.waitForInput(node, index, out.needs, out.note);
    await this.storeArtifact(node, fallbackFrom ? { ...out.artifact, meta: { ...(out.artifact.meta ?? {}), fallbackFrom: "n8n", workflowId: fallbackFrom } } : out.artifact, "producer");
    return undefined;
  }

  private async n8n(node: N8nNode, index: number): Promise<RunResult | undefined> {
    const workflow = node.webhookUrl || node.webhookUrlEnv ? null : await this.store.findN8nWorkflow(this.ctx.account.accountId, this.ctx.routineId);
    return this.callN8n(node, index, workflow);
  }

  private async callN8n(node: ProduceNode | N8nNode, index: number, workflow: Awaited<ReturnType<Store["findN8nWorkflow"]>>): Promise<RunResult | undefined> {
    const bridge = this.adapters.n8n;
    if (!bridge) return this.fail(node.id, "no n8n bridge is configured — nothing was drafted", { node: node.id });
    if (node.kind === "n8n" && node.shadowContract) {
      const kind = shadowKind(node.shadowContract), label = SHADOW_LABEL[kind];
      const complete = kind === "calendar" ? this.adapters.completeCalendarShadow : kind === "paid" ? this.adapters.completePaidShadow : this.adapters.completeKeywordShadow;
      if (!complete) return this.fail(node.id, `Atomic ${label.toLowerCase()} completion is not configured; nothing was dispatched.`);
      assertShadowTail(this.spec, index, kind);
      const snapshot: RunSnapshot = { spec: this.spec, ctx: this.ctx, nextNodeIndex: index + 1, awaiting: `${kind}_shadow` };
      this.run = await this.store.updateRun(this.run.id, { snapshot,
        summary: `${label} shadow work is awaiting verified completion. Do not repeat this request.` });
      try {
        const out = await bridge.call(node, this.ctx, workflow);
        if (out.kind === "needs" && kind === "keyword") return this.waitForInput(node, index, out.needs);
        if (out.kind !== "artifact") throw new Error(`${label} shadow requires a synchronous verified result`);
        // The completion adapter reads the independently verified durable result;
        // the in-flight return object cannot substitute for that evidence.
        return await complete(this.run);
      } catch (error) {
        if (error instanceof RuntimeContextError) throw error;
        // A commit may have succeeded despite a lost response. Never overwrite it
        // with failed status or clear the pre-dispatch continuation. Recovery uses
        // the same atomic completion key, not another paid dispatch.
        return this.result("running", `${label} shadow completion is unconfirmed. Reconcile the original run; do not repeat it.`,
          `${kind}_shadow_reconciliation_required`);
      }
    }
    const out = await bridge.call(node, this.ctx, workflow);
    if (out.kind === "needs") return this.waitForInput(node, index, out.needs);
    if (out.kind === "artifact") {
      await this.storeArtifact(node, out.artifact, "n8n");
      return undefined;
    }
    // 202 accepted: the workflow will POST the artifact back; hold the run (still running).
    await this.receipt("notification", `Handed to the n8n workflow${workflow ? ` for ${workflow.routineId}` : ""} — waiting for its artifact.`, { node: node.id, workflowId: workflow?.id ?? null });
    const snapshot: RunSnapshot = { spec: this.spec, ctx: this.ctx, nextNodeIndex: index + 1, awaiting: "n8n" };
    this.run = await this.store.updateRun(this.run.id, { status: "running", summary: "Waiting for the n8n workflow's artifact.", snapshot });
    return this.result("running", "Waiting for the n8n workflow's artifact.");
  }

  /** Called by completeExternalArtifact: the artifact arrived; store it and carry on. */
  async deliverExternal(node: ProduceNode | N8nNode, draft: ArtifactDraft, nextNodeIndex: number): Promise<RunResult> {
    await this.storeArtifact(node, draft, "n8n");
    this.run = await this.store.updateRun(this.run.id, { snapshot: undefined });
    return this.runFrom(nextNodeIndex);
  }

  async deliverExternalNeeds(node: ProduceNode | N8nNode, index: number, needs: ProduceNeed[]): Promise<RunResult> {
    return this.waitForInput(node, index, needs);
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

  /** Shared by approval preflight and execute so the founder reviews exactly the
      mutation the executor will receive after approval. */
  private mutationFor(node: ExecuteNode): Mutation {
    const action = renderTemplate(node.mutation.action, this.ctx) || node.mutation.action;
    return { action, target: renderParams(node.mutation.target, this.ctx), params: renderParams(node.mutation.params, this.ctx) };
  }

  private async gate(node: GateNode, index: number) {
    const draft = this.approvalDraft(node);
    const art = this.ctx.artifact;
    const artifactPreview = art ? { artifactId: art.id, artifactKind: art.kind, artifactTitle: art.title, artifactItems: art.items.length, artifactExcerpt: art.body.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n").slice(0, 400) } : {};
    if (this.dry) {
      await this.receipt("draft", `Would ask ${node.approver ?? this.ctx.account.approver ?? "the founder"}: ${draft.title}`, {
        node: node.id,
        approvalPreview: { ...draft, expiryHours: node.expiryHours, ...artifactPreview },
      });
      return undefined;
    }

    const executeNode = this.spec.nodes.slice(index + 1).find((candidate): candidate is ExecuteNode => candidate.kind === "execute");
    // Proposal preflight applies to the production contract introduced by a ProduceNode.
    // Legacy/test specs without an artifact retain the existing approval lifecycle.
    if (executeNode && art) {
      const mutation = this.mutationFor(executeNode);
      if (this.spec.mutates) {
        const blocked = proposalBlocker(art, mutation.action);
        if (blocked) {
          const summary = `Held before approval: ${blocked}. Nothing was changed.`;
          await this.receipt("notification", summary, { node: node.id, executeNode: executeNode.id, artifactId: art.id, mutation, blocked });
          return this.finish("skipped", summary);
        }
      }

      // A capable executor can prove that the exact live request is supportable before
      // we ask a human to approve it. Legacy adapters without dryRun retain their flow.
      if (this.adapters.executor.dryRun) {
        const shaped = await this.adapters.executor.dryRun(executeNode, mutation, this.ctx);
        if (shaped?.blocked) {
          const summary = `Held before approval: ${shaped.blocked}. Nothing was changed.`;
          await this.receipt(
            "notification",
            summary,
            { node: node.id, executeNode: executeNode.id, platform: executeNode.platform, mutation, preview: shaped.preview, action: shaped.payload, blocked: shaped.blocked },
            { platform: executeNode.platform },
          );
          return this.finish("skipped", summary);
        }
      }
    }
    const createdAt = this.nowIso();
    const approval: ApprovalRecord = { ...draft, id: this.idGen(), status: "pending", createdAt, expiresAt: addHours(createdAt, node.expiryHours) };
    await this.store.createApproval(approval);
    this.ctx.approval = approval;
    await this.receipt("notification", `Waiting for approval: ${approval.title}`, { node: node.id, approvalId: approval.id, expiresAt: approval.expiresAt, ...artifactPreview }, { approvalId: approval.id });
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
    // The action may be a template ("{{decision.params.actionId}}") so one execute node can
    // carry whichever action the decision proposed; a plain verb renders to itself.
    const mutation = this.mutationFor(node);
    const spend = this.ctx.decision?.spend ?? resolveSpend(node.spend, this.ctx);
    const base = { node: node.id, platform: node.platform, mutation, spend: spend ?? null };

    if (this.dry) {
      const caps = await this.capsCheck(spend);
      // An executor with a dry-run (the typed action library) shapes the exact request.
      const shaped = this.adapters.executor.dryRun ? await this.adapters.executor.dryRun(node, mutation, this.ctx) : null;
      const blockers = [shaped?.blocked ? `guards would block it: ${shaped.blocked}` : "", caps.ok ? "" : `caps would block it: ${caps.reason}`].filter(Boolean);
      const line = shaped ? `Would ${shaped.preview}` : `Would ${mutation.action} on ${node.platform}${spend ? ` (${spend.currency} ${spend.amount.toFixed(2)})` : ""}`;
      await this.receipt("draft", `${line}${blockers.length ? ` — but ${blockers.join("; ")}` : ""}.`, { ...base, dryRun: true, capsCheck: caps, ...(shaped ? { action: shaped.payload, blocked: shaped.blocked ?? null } : {}) }, { platform: node.platform });
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
      artifactId: this.ctx.artifact?.id ?? null,
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
    runId: opts.runId ?? idGen(),
    routineId: spec.id,
    version: spec.version,
    mode: opts.mode,
    startedAt,
    account: { ...input.account, contextGeneration: runtimeGeneration(input.account.contextGeneration) },
    caps: capsFor(input.account),
    triggeredBy: input.triggeredBy ?? "schedule",
    vars: input.vars ?? {},
    inputs: { ...(input.inputs ?? {}) },
    reads: {},
    checks: {},
  };
  await adapters.assertContext?.(ctx.account);
  const initial: RunRecord = {
    id: ctx.runId,
    accountId: ctx.account.accountId,
    contextGeneration: ctx.account.contextGeneration,
    routineId: spec.id,
    version: spec.version,
    mode: opts.mode,
    status: "running",
    startedAt,
    specHash: stableHash(spec),
  };
  let run: RunRecord;
  const kind = specShadowKind(spec);
  const calendar = kind === "calendar", paid = kind === "paid";
  if (calendar && (!opts.reserveCalendarShadowRun || !opts.claimCalendarShadowStart || !adapters.completeCalendarShadow ||
      opts.reserveKeywordShadowRun || opts.reservePaidShadowRun || opts.claimPaidShadowStart || opts.admitManualStart))
    throw new Error("Calendar shadow requires its own durable reservation, start claim and completion before any work");
  if (paid && (!opts.reservePaidShadowRun || !opts.claimPaidShadowStart || !adapters.completePaidShadow ||
      opts.reserveKeywordShadowRun || opts.reserveCalendarShadowRun || opts.claimCalendarShadowStart || opts.admitManualStart))
    throw new Error("Paid-ads shadow requires its own durable reservation, start claim and completion before any work");
  if (!calendar && (opts.reserveCalendarShadowRun || opts.claimCalendarShadowStart)) throw new Error("Calendar allowance cannot start another routine");
  if (!paid && (opts.reservePaidShadowRun || opts.claimPaidShadowStart)) throw new Error("Paid-ads allowance cannot start another routine");
  const reserveShadow = calendar ? opts.reserveCalendarShadowRun : paid ? opts.reservePaidShadowRun : opts.reserveKeywordShadowRun;
  const claimShadow = calendar ? opts.claimCalendarShadowStart : paid ? opts.claimPaidShadowStart : opts.claimKeywordShadowStart;
  if (opts.admitManualStart) {
    if (opts.reserveKeywordShadowRun || spec.id === "D03-W01" || opts.mode !== "dry_run" || ctx.triggeredBy !== "manual")
      throw new Error("Manual admission cannot start the keyword pilot or live work");
    initial.snapshot = { spec: structuredClone(spec), ctx: structuredClone(ctx), nextNodeIndex: 0, startProtocol: "manual_claim_v1" };
    const admitted = await opts.admitManualStart(structuredClone(initial));
    if (!admitted.start) return admitted.result;
    const original = admitted.run, saved = original.snapshot;
    if (!saved || saved.startProtocol !== "manual_claim_v1" || saved.nextNodeIndex !== 0 || original.status !== "running" ||
      original.mode !== "dry_run" || original.routineId !== spec.id || original.version !== spec.version ||
      original.accountId !== ctx.account.accountId || original.contextGeneration !== ctx.account.contextGeneration ||
      saved.ctx.runId !== original.id || saved.ctx.mode !== "dry_run" || saved.ctx.triggeredBy !== "manual" ||
      saved.spec.id !== original.routineId || saved.spec.version !== original.version || stableHash(saved.spec) !== original.specHash)
      throw new Error("Original manual run identity unavailable; reconcile without restarting");
    assertSameRuntimeContext(original, saved.ctx.account);
    return new RunSession(saved.spec, saved.ctx, original, adapters).runFrom(0);
  } else if (reserveShadow) {
    if (!claimShadow) throw new Error("Shadow pilot requires an atomic start claim before issuance");
    const producers = spec.nodes.filter(node => node.kind === "produce" || node.kind === "n8n");
    const node = producers[0];
    if (producers.length !== 1 || node?.kind !== "n8n" || !node.shadowContract || ctx.triggeredBy !== "manual")
      throw new Error("Pilot issuance requires an explicit manual keyword shadow specification");
    assertShadowRequest(node.shadowContract, { ...initial, runId: initial.id });
    assertShadowTail(spec, spec.nodes.indexOf(node), kind ?? "keyword");
    initial.snapshot = { spec: structuredClone(spec), ctx: structuredClone(ctx), nextNodeIndex: 0,
      awaiting: `${kind ?? "keyword"}_start`, startProtocol: `${kind ?? "keyword"}_claim_v1` };
    run = await reserveShadow(structuredClone(initial));
    if (run.id !== initial.id || run.accountId !== initial.accountId || run.contextGeneration !== initial.contextGeneration ||
        run.status !== "running" || run.mode !== initial.mode || run.version !== initial.version || run.routineId !== initial.routineId ||
        run.startedAt !== initial.startedAt || run.specHash !== initial.specHash || JSON.stringify(run.snapshot) !== JSON.stringify(initial.snapshot))
      throw new Error("Issued keyword run differs from its captured original identity");
    return startPreparedShadow(run, adapters, claimShadow, kind ?? "keyword");
  } else run = await adapters.store.createRun(initial);
  return new RunSession(spec, ctx, run, adapters).runFrom(0);
}

/** A reserved run can be resumed only BEFORE any engine work began. This is not a
 * lease: a lost claim response remains uncertain and is never reclaimed by timeout. */
async function startPreparedShadow(original: RunRecord, adapters: Adapters,
  claim: NonNullable<RunOptions["claimKeywordShadowStart"]>, kind: ShadowKind = "keyword"): Promise<RunResult> {
  const run = structuredClone(original), snapshot = run.snapshot;
  if (!snapshot || snapshot.awaiting !== `${kind}_start` || snapshot.startProtocol !== `${kind}_claim_v1` ||
      snapshot.nextNodeIndex !== 0 || run.status !== "running" || run.mode !== "dry_run" || run.finishedAt || run.approvalId)
    throw new Error("Original unstarted keyword snapshot unavailable; reconcile without redispatch");
  const { spec, ctx } = snapshot;
  assertValidSpec(spec);
  const index = spec.nodes.findIndex(node => node.kind === "n8n");
  assertShadowTail(spec, index, kind);
  assertSameRuntimeContext(run, ctx.account);
  assertShadowRequest((spec.nodes[index] as N8nNode).shadowContract!, {
    accountId: run.accountId, runId: run.id, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt,
  });
  if (run.routineId !== spec.id || run.version !== spec.version || run.specHash !== stableHash(spec) ||
      ctx.runId !== run.id || ctx.routineId !== run.routineId || ctx.version !== run.version ||
      ctx.mode !== "dry_run" || ctx.startedAt !== run.startedAt || ctx.triggeredBy !== "manual" ||
      Object.keys(ctx.reads ?? {}).length || Object.keys(ctx.checks ?? {}).length || Object.keys(ctx.inputs ?? {}).length ||
      ctx.artifact || ctx.execution || ctx.approval || ctx.decision)
    throw new Error("Original keyword start identity mismatch");
  await adapters.assertContext?.(run);
  if (await claim(structuredClone(run)) !== true)
    throw new Error("Keyword start is unavailable or already claimed; reconcile the original run without redispatch");
  snapshot.awaiting = `${kind}_started`;
  return new RunSession(spec, ctx, run, adapters).runFrom(0);
}

/** Operator-only recovery using the original persisted run and its existing allowance.
 * Never calls runRoutine, creates another run, or replenishes provider-call quota. */
export async function resumePreparedKeywordShadowRun(runId: string, adapters: Adapters,
  claim: NonNullable<RunOptions["claimKeywordShadowStart"]>): Promise<RunResult> {
  const run = await adapters.store.getRun(runId);
  if (!run) throw new Error("Original keyword run unavailable");
  return startPreparedShadow(run, adapters, claim);
}

export async function resumePreparedCalendarShadowRun(runId: string, adapters: Adapters,
  claim: NonNullable<RunOptions["claimCalendarShadowStart"]>): Promise<RunResult> {
  const run = await adapters.store.getRun(runId);
  if (!run || !adapters.completeCalendarShadow) throw new Error("Original calendar run or atomic completion unavailable");
  return startPreparedShadow(run, adapters, claim, "calendar");
}
export async function resumePreparedPaidShadowRun(runId: string, adapters: Adapters,
  claim: NonNullable<RunOptions["claimPaidShadowStart"]>): Promise<RunResult> {
  const run = await adapters.store.getRun(runId);
  if (!run || !adapters.completePaidShadow) throw new Error("Original paid-ads run or atomic completion unavailable");
  return startPreparedShadow(run, adapters, claim, "paid");
}

export async function resumeRun(runId: string, decision: "approved" | "held", adapters: Adapters, opts: ResumeOptions = {}): Promise<RunResult> {
  const store = adapters.store;
  const now = adapters.now ?? (() => new Date());
  const idGen = adapters.idGen ?? newId;
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "waiting_approval") throw new Error(`run ${runId} is ${run.status}, not waiting_approval`);
  if (!run.snapshot || !run.approvalId) throw new Error(`run ${runId} has no resumable snapshot`);
  assertSameRuntimeContext(run, run.snapshot.ctx.account);
  await adapters.assertContext?.(run);
  const approval = await store.getApproval(run.approvalId);
  if (!approval) throw new Error(`approval ${run.approvalId} not found`);
  if (approval.status !== "pending") throw new Error(`approval ${approval.id} already ${approval.status}`);

  const { spec, ctx, nextNodeIndex } = run.snapshot;
  const nowIso = now().toISOString();
  const session = new RunSession(spec, ctx, run, adapters);

  if (approval.expiresAt < nowIso) {
    const expired = await store.updateApproval(approval.id, { status: "expired" }, "pending");
    ctx.approval = expired;
    await session.receipt("notification", `Approval expired at ${approval.expiresAt} — nothing was changed.`, { approvalId: approval.id }, { approvalId: approval.id });
    await store.updateRun(run.id, { status: "skipped", summary: "Approval expired.", finishedAt: nowIso, snapshot: undefined });
    return { runId: run.id, routineId: run.routineId, version: run.version, mode: run.mode, status: "skipped", summary: "Approval expired.", receipts: session.receipts, approval: expired };
  }

  const decided = await store.updateApproval(approval.id, { status: decision, decidedAt: nowIso, decidedBy: opts.decidedBy }, "pending");
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

/** Strings only, trimmed and capped — answers become prompt material, never code. */
export function cleanAnswers(answers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers ?? {})) {
    const key = k.trim().slice(0, 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const text = typeof v === "string" ? v.trim().slice(0, 4000) : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    if (text) out[key] = text;
  }
  return out;
}

/** The founder answered what the producer asked for: merge the answers into ctx.inputs and
    re-run the produce step (the snapshot points at it). */
export async function resumeRunWithInput(runId: string, answers: Record<string, unknown>, adapters: Adapters): Promise<RunResult> {
  const store = adapters.store;
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  return resumeCapturedInput(run, answers, adapters);
}

/** A durable manual claim supplies the original waiting snapshot. Claiming changes
 * the stored status atomically before any receipt/provider work takes place. */
export async function resumeCapturedInput(run: RunRecord, answers: Record<string, unknown>, adapters: Adapters): Promise<RunResult> {
  const store = adapters.store;
  const runId = run.id;
  if (run.status !== "waiting_input") throw new Error(`run ${runId} is ${run.status}, not waiting_input`);
  if (!run.snapshot) throw new Error(`run ${runId} has no resumable snapshot`);
  assertSameRuntimeContext(run, run.snapshot.ctx.account);
  await adapters.assertContext?.(run);
  const clean = cleanAnswers(answers);
  if (!Object.keys(clean).length) throw new Error("answers are empty");
  const { spec, ctx, nextNodeIndex } = run.snapshot;
  ctx.inputs = { ...(ctx.inputs ?? {}), ...clean };
  const session = new RunSession(spec, ctx, run, adapters);
  await session.receipt("notification", `You answered: ${Object.keys(clean).map((k) => k.replace(/_/g, " ")).join(", ")}. Drafting again with that.`, { answered: Object.keys(clean) });
  await store.updateRun(run.id, { status: "running", summary: "Resumed with your answers.", snapshot: undefined, finishedAt: undefined });
  return session.runFrom(nextNodeIndex);
}

/** An n8n workflow delivered the artifact (or its needs) for a run it had accepted. */
export async function completeExternalArtifact(runId: string, result: { artifact: ArtifactDraft } | { needs: ProduceNeed[] }, adapters: Adapters): Promise<RunResult> {
  const store = adapters.store;
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "running" || run.snapshot?.awaiting !== "n8n") throw new Error(`run ${runId} is not waiting for an n8n artifact`);
  assertSameRuntimeContext(run, run.snapshot.ctx.account);
  await adapters.assertContext?.(run);
  const { spec, ctx, nextNodeIndex } = run.snapshot;
  const index = nextNodeIndex - 1;
  const node = spec.nodes[index];
  if (!node || (node.kind !== "produce" && node.kind !== "n8n")) throw new Error(`run ${runId} snapshot does not point at a produce step`);
  const session = new RunSession(spec, ctx, run, adapters);
  if ("needs" in result) return session.deliverExternalNeeds(node, index, result.needs);
  return session.deliverExternal(node, result.artifact, nextNodeIndex);
}

const SHADOW_LABEL: Record<ShadowKind, string> = { keyword: "Keyword", calendar: "Calendar", paid: "Paid-ads" };
/** The protocol a spec's explicit n8n node speaks, or null for ordinary specs. */
function specShadowKind(spec: RoutineSpec): ShadowKind | null {
  const node = spec.nodes.find(n => n.kind === "n8n" && n.shadowContract);
  return node?.kind === "n8n" && node.shadowContract ? shadowKind(node.shadowContract) : null;
}
function assertShadowTail(spec: RoutineSpec, index: number, kind: ShadowKind = "keyword"): void {
  const node = spec.nodes[index], tail = spec.nodes.slice(index + 1);
  const label = SHADOW_LABEL[kind];
  if (kind !== "keyword" && (index !== 1 || spec.nodes[0]?.kind !== "trigger" || spec.nodes[0].cadence !== "manual" ||
      spec.mutates || node?.kind !== "n8n" || node.webhookUrl || node.webhookUrlEnv))
    throw new Error(`${label} shadow permits only its manual trigger before the registered producer`);
  const routineFits = kind === "calendar" ? spec.id === "D05-W07" : kind === "paid" ? isPaidShadowRoutine(spec.id) : spec.id === "D03-W01";
  if (!routineFits || !node || node.kind !== "n8n" || !node.shadowContract || shadowKind(node.shadowContract) !== kind ||
      spec.nodes.filter(n => n.kind === "produce" || n.kind === "n8n").length !== 1 || spec.nodes.some(n => n.kind === "execute") ||
      tail.length < 1 || tail.length > 10 || tail.at(-1)?.kind !== "receipt" ||
      tail.slice(0, -1).some(n => n.kind !== "gate")) throw new Error(`${label} shadow continuation must contain only draft review gates and its final receipt`);
}

/** Run the ORIGINAL post-producer semantics into an isolated staging store. This is
 * a deterministic commit plan, not a second execution or synthetic provider output.
 * No caller adapters are available, so no provider/model/executor can be invoked. */
export async function planKeywordShadowCompletion(run: RunRecord, draft: ArtifactDraft,
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<{ result: RunResult; snapshot: RunSnapshot }> {
  return planShadowCompletion(run, draft, opts, "keyword");
}
export async function planCalendarShadowCompletion(run: RunRecord, draft: ArtifactDraft,
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<{ result: RunResult; snapshot: RunSnapshot }> {
  return planShadowCompletion(run, draft, opts, "calendar");
}
export async function planPaidShadowCompletion(run: RunRecord, draft: ArtifactDraft,
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<{ result: RunResult; snapshot: RunSnapshot }> {
  return planShadowCompletion(run, draft, opts, "paid");
}
async function planShadowCompletion(run: RunRecord, draft: ArtifactDraft,
  opts: { now?: () => Date; idGen?: () => string }, kind: ShadowKind | boolean): Promise<{ result: RunResult; snapshot: RunSnapshot }> {
  const shadow: ShadowKind = kind === true ? "calendar" : kind === false ? "keyword" : kind;
  if (!run.snapshot || run.snapshot.awaiting !== `${shadow}_shadow` || !["running", "failed"].includes(run.status) || run.mode !== "dry_run")
    throw new Error(`Original ${SHADOW_LABEL[shadow].toLowerCase()} shadow continuation is unavailable`);
  const snapshot = structuredClone(run.snapshot), { spec, ctx, nextNodeIndex } = snapshot;
  assertValidSpec(spec); assertShadowTail(spec, nextNodeIndex - 1, shadow);
  assertSameRuntimeContext(run, ctx.account);
  assertShadowRequest((spec.nodes[nextNodeIndex - 1] as N8nNode).shadowContract!, {
    accountId: run.accountId, runId: run.id, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt,
  });
  if (run.routineId !== spec.id || run.version !== spec.version || run.specHash !== stableHash(spec) || ctx.runId !== run.id ||
      ctx.routineId !== run.routineId || ctx.version !== run.version || ctx.mode !== "dry_run" || ctx.startedAt !== run.startedAt ||
      ctx.artifact || ctx.execution || ctx.approval) throw new Error("Original keyword continuation identity mismatch");
  const store = new MemoryStore(); await store.createRun(structuredClone(run));
  const unavailable = async (): Promise<never> => { throw new Error("External work is forbidden during keyword completion"); };
  const plannedAt = (opts.now ?? (() => new Date()))();
  const session = new RunSession(spec, ctx, structuredClone(run), { store,
    reader: { read: unavailable }, decider: { decide: unavailable }, executor: { execute: unavailable }, ...opts, now: () => plannedAt });
  const node = spec.nodes[nextNodeIndex - 1] as N8nNode;
  const result = await session.deliverExternal(node, structuredClone(draft), nextNodeIndex);
  if (result.status !== "done" || !result.artifact || result.receipts.some(r => r.kind !== "draft"))
    throw new Error("Keyword completion did not finish its original draft continuation");
  return { result, snapshot: structuredClone(run.snapshot) };
}
