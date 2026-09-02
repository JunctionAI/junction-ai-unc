/* Shipped adapters: a deterministic DecisionProvider (no LLM) and a static
   ConnectorReader fed from fixtures. Both are used by dry runs against demo
   data and by the tests. A live LLM provider implements the same
   DecisionProvider interface and is injected in its place. */

import { compare, renderParams, renderTemplate, resolvePath, resolveSpend, resolveValue } from "./context";
import type { ConnectorReader, DecideNode, Decision, DecisionOption, DecisionProvider, Platform, ReadQuery, ReadResult, RunContext } from "./types";

// ---------- decisions ----------

/** Option labels and params are templates over the run context; they are
    rendered here so ctx.decision holds concrete values (an execute target of
    "{{decision.params.adsetId}}" must resolve to a real id, never a template). */
function toDecision(opt: DecisionOption, reasoning: string, ctx: RunContext): Decision {
  return {
    optionId: opt.id,
    label: renderTemplate(opt.label, ctx),
    reasoning,
    terminal: opt.terminal,
    spend: resolveSpend(opt.spend, ctx),
    params: opt.params ? renderParams(opt.params, ctx) : undefined,
  };
}

/** Evaluates the node's selection rule literally. `llm` rules resolve to
    their declared fallback (or the first option) with a reasoning line that
    says so — never a guess. */
export class DeterministicDecisionProvider implements DecisionProvider {
  async decide(node: DecideNode, ctx: RunContext): Promise<Decision> {
    const byId = new Map(node.options.map((o) => [o.id, o]));
    const rule = node.rule;
    if (rule.kind === "first") {
      return toDecision(node.options[0], `Rule "first": ${renderTemplate(node.options[0].label, ctx)}.`, ctx);
    }
    if (rule.kind === "threshold") {
      const actual = resolvePath(ctx, rule.metric);
      const expected = resolveValue(rule.value, ctx);
      const pass = compare(actual, rule.op, expected);
      const chosen = byId.get(pass ? rule.ifTrue : rule.ifFalse)!;
      const shown = typeof actual === "number" ? (Number.isInteger(actual) ? actual : actual.toFixed(2)) : String(actual);
      return toDecision(
        chosen,
        `${rule.metric} = ${shown}, which ${pass ? "meets" : "does not meet"} ${rule.op} ${JSON.stringify(expected)} → ${renderTemplate(chosen.label, ctx)}.`,
        ctx,
      );
    }
    const fallback = (rule.fallback && byId.get(rule.fallback)) || node.options[0];
    return toDecision(fallback, `No LLM decision provider configured; deterministic fallback → ${renderTemplate(fallback.label, ctx)}.`, ctx);
  }
}

// ---------- reads ----------

export type FixtureKey = `${Platform}:${string}`;
export type Fixtures = Partial<Record<FixtureKey, Partial<ReadResult> | ((query: ReadQuery, ctx: RunContext) => Partial<ReadResult>)>>;

/** Answers reads from a `${platform}:${resource}` fixture map. Unknown keys
    return an empty result with provenance "empty" — so every catalog spec can
    dry-run against demo data without a connector. */
export class StaticReader implements ConnectorReader {
  constructor(
    private readonly fixtures: Fixtures = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(source: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult> {
    const key: FixtureKey = `${source}:${query.resource}`;
    const fx = this.fixtures[key];
    const partial = typeof fx === "function" ? fx(query, ctx) : fx;
    return {
      rows: partial?.rows ?? [],
      metrics: partial?.metrics ?? {},
      fetchedAt: partial?.fetchedAt ?? this.now().toISOString(),
      provenance: partial?.provenance ?? (partial ? "ok" : "empty"),
    };
  }
}

/** Reader that fails every read — for testing incident paths. */
export class FailingReader implements ConnectorReader {
  constructor(private readonly message = "connector unavailable") {}
  async read(): Promise<ReadResult> {
    throw new Error(this.message);
  }
}
