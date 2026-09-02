import type { Adapters } from "../engine";
import { DeterministicDecisionProvider, StaticReader, type Fixtures } from "../providers";
import { MemoryStore } from "../store/memory";
import type { AccountContext, ExecuteNode, ExecutionResult, Executor, Mutation, RoutineSpec, RunContext, RunInput } from "../types";

export const T0 = "2026-09-02T07:00:00.000Z";

/** A controllable clock. */
export function clock(start = T0) {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advanceHours: (h: number) => {
      t += h * 3_600_000;
    },
  };
}

export function account(overrides: Partial<AccountContext> = {}): AccountContext {
  return { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000, approver: "Tom", ...overrides };
}

export function input(overrides: Partial<RunInput> = {}): RunInput {
  return { account: account(), triggeredBy: "schedule", ...overrides };
}

export class RecordingExecutor implements Executor {
  calls: { node: ExecuteNode; mutation: Mutation; ctx: RunContext }[] = [];
  constructor(private readonly result: ExecutionResult = { ok: true, externalRef: "ext-1", readback: { applied: true } }) {}
  async execute(node: ExecuteNode, mutation: Mutation, ctx: RunContext) {
    this.calls.push({ node, mutation, ctx });
    return this.result;
  }
}

export function adapters(opts: { fixtures?: Fixtures; executor?: Executor; store?: MemoryStore; clk?: ReturnType<typeof clock> } = {}) {
  const clk = opts.clk ?? clock();
  const store = opts.store ?? new MemoryStore();
  const executor = opts.executor ?? new RecordingExecutor();
  const a: Adapters = {
    reader: new StaticReader(opts.fixtures ?? {}, clk.now),
    decider: new DeterministicDecisionProvider(),
    executor,
    store,
    now: clk.now,
  };
  return { adapters: a, store, executor: executor as RecordingExecutor, clk };
}

/** A small mutation routine: read Meta spend, check spend > 0, decide to
    move 20% of the top ad set budget if ROAS ≥ 2.5, gate, execute, receipt. */
export function budgetMoveSpec(overrides: Partial<RoutineSpec> = {}): RoutineSpec {
  return {
    id: "D02-W01",
    version: 1,
    name: "Daily paid decisioning",
    wave: 2,
    mutates: true,
    nodes: [
      { kind: "trigger", id: "trigger", cadence: "0 7 * * *" },
      { kind: "read", id: "read_spend", as: "spend", source: "meta_ads", query: { resource: "insights", window: "7d" } },
      { kind: "check", id: "spend_present", predicate: { metric: "reads.spend.spend", op: "gt", value: 0 }, reason: "No spend." },
      {
        kind: "decide",
        id: "decide",
        question: "Where should the budget go?",
        options: [
          { id: "scale", label: "Scale the winner", spend: { amountMetric: "reads.spend.top_budget", multiplier: 0.2, period: "day" }, params: { adsetId: "{{reads.spend.top_id}}" } },
          { id: "hold", label: "Hold", terminal: true },
        ],
        rule: { kind: "threshold", metric: "reads.spend.top_roas", op: "gte", value: 2.5, ifTrue: "scale", ifFalse: "hold" },
      },
      { kind: "gate", id: "gate", title: "Move {{account.currency}} {{decision.spend.amount}}/day to {{reads.spend.top_name}}", before: "{{reads.spend.top_budget}}/day", after: "+{{decision.spend.amount}}/day", expiryHours: 24 },
      { kind: "execute", id: "execute", platform: "meta_ads", mutation: { action: "update_adset_budget", target: { adsetId: "{{decision.params.adsetId}}" }, params: { increase: "{{decision.spend.amount}}" } } },
      { kind: "receipt", id: "receipt", summary: "Done: {{decision.label}}" },
    ],
    ...overrides,
  };
}

export const SPEND_FIXTURE: Fixtures = {
  "meta_ads:insights": {
    rows: [{ adset_id: "as-1", adset_name: "Prospecting NZ", spend: 420, roas: 3.1, daily_budget: 100 }],
    metrics: { spend: 420, top_id: "as-1", top_name: "Prospecting NZ", top_roas: 3.1, top_budget: 100 },
  },
};

/** A draft-only routine: read, check, decide, gate, receipt. */
export function draftSpec(overrides: Partial<RoutineSpec> = {}): RoutineSpec {
  return {
    id: "D01-W01",
    version: 1,
    name: "Founder content engine",
    wave: 1,
    mutates: false,
    nodes: [
      { kind: "trigger", id: "trigger", cadence: "0 7 * * *" },
      { kind: "read", id: "read_q", as: "questions", source: "gorgias", query: { resource: "tickets", window: "7d" } },
      { kind: "check", id: "has_material", predicate: { metric: "reads.questions.count", op: "gte", value: 1 }, reason: "Nothing to draft from." },
      { kind: "decide", id: "decide", question: "Draft?", options: [{ id: "draft", label: "Draft 3 posts" }], rule: { kind: "first" } },
      { kind: "gate", id: "gate", title: "3 posts drafted from {{reads.questions.count}} questions", expiryHours: 48 },
      { kind: "receipt", id: "receipt", summary: "Drafts handed over." },
    ],
    ...overrides,
  };
}

export const QUESTIONS_FIXTURE: Fixtures = {
  "gorgias:tickets": { rows: [{ subject: "Does it ship to AU?" }, { subject: "Is it vegan?" }, { subject: "Refund?" }], metrics: {} },
};
