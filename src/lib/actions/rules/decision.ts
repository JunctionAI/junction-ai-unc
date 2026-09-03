/* RulesDecisionProvider — the deterministic DECIDE for rule-bound routines.

   A binding (RULE_BINDINGS, data) names a routine, the read alias its ad-set rows land under,
   and which decide option each verdict maps to. When a run of that routine reaches its decide
   node, this provider — not the LLM — evaluates every ad set with evaluateAdsets, picks the
   one to act on (money protection first), and returns a Decision whose params carry the
   action id + params the execute node references ({{decision.params.actionId}} …).

   The LLM's only job here is to WRITE the reasoning line (optional ReasoningWriter). Its line
   is accepted only when every number in it appears in the evidence; otherwise the
   deterministic reason stands. Routines without a binding go to the wrapped provider. */

import { renderTemplate } from "../../runtime/context";
import { isActionId } from "../registry";
import type { DecideNode, Decision, DecisionProvider, RunContext } from "../../runtime/types";
import { resolveMetaPreset, type PresetSource } from "../presets";
import { redactId } from "../meta/graph";
import { adsetMetricsFromRow, evaluateAdsets, type AccountEvaluation, type Verdict } from "./meta";

export interface RuleBinding {
  routineId: string;
  /** The decide node id (default "decide"). */
  nodeId?: string;
  ruleset: "meta.adset";
  /** ctx.reads alias holding adset-level insight rows. */
  readAlias: string;
  /** Optional ctx.reads alias holding ad set objects with daily_budget (the adsets resource). */
  budgetsAlias?: string;
  /** Verdict → decide option id. Verdicts without an entry (or without an action) take `noActionOption`. */
  optionByVerdict: Partial<Record<Verdict, string>>;
  noActionOption: string;
}

export const RULE_BINDINGS: readonly RuleBinding[] = [
  { routineId: "D02-W01", ruleset: "meta.adset", readAlias: "spend", budgetsAlias: "adsets", optionByVerdict: { scale: "scale", turn_off: "turn_off" }, noActionOption: "hold" },
];

export function findBinding(routineId: string, nodeId: string, bindings: readonly RuleBinding[] = RULE_BINDINGS): RuleBinding | null {
  return bindings.find((b) => b.routineId === routineId && (b.nodeId ?? "decide") === nodeId) ?? null;
}

/** The worker's LlmClient shape (src/worker/providers/llmDecision.ts) — declared here so this
    tree never imports the worker. */
export interface ReasoningWriter {
  complete(prompt: { system: string; user: string; accountId?: string }): Promise<string>;
}

export const MAX_REASONING_CHARS = 600;

const WRITER_SYSTEM = `You are Unc, the Junction operator. Register: "In your corner." First person, present tense, numbers over adjectives, warm and direct, no hype, no exclamation marks.

The verdict is already decided by the founder's rules — you do not choose or question it. Write the reasoning line for it: 1–2 short sentences that say what the numbers show and what happens next. Use ONLY the numbers in EVIDENCE, exactly as given (same rounding). No other numbers. Reply with the sentences only — no JSON, no quotes, no preamble.`;

/** Every number in the text must appear in the evidence (as given, to 2 dp, or as an integer). */
export function numbersAreGrounded(text: string, evidence: Record<string, unknown>): boolean {
  const allowed = new Set<string>();
  const add = (n: number) => {
    allowed.add(String(n));
    allowed.add(n.toFixed(2));
    allowed.add(n.toFixed(1));
    allowed.add(String(Math.round(n)));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) add(v);
    else if (typeof v === "string") {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n)) add(n);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(evidence);
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return found.every((raw) => {
    const clean = raw.replace(/,/g, "");
    return allowed.has(clean) || allowed.has(Number(clean).toFixed(2)) || allowed.has(String(Number(clean)));
  });
}

export function verdictCounts(a: AccountEvaluation): string {
  const c = a.counts;
  const parts = [c.scale ? `${c.scale} to scale` : "", c.turn_off ? `${c.turn_off} to turn off` : "", c.hold ? `${c.hold} on hold` : "", c.keep ? `${c.keep} in band` : "", c.not_enough_data ? `${c.not_enough_data} with too little spend` : ""].filter(Boolean);
  return parts.join(", ") || "no ad sets";
}

export interface RulesDecisionOptions {
  presets?: PresetSource | null;
  writer?: ReasoningWriter | null;
  bindings?: readonly RuleBinding[];
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class RulesDecisionProvider implements DecisionProvider {
  private readonly bindings: readonly RuleBinding[];
  constructor(
    private readonly inner: DecisionProvider,
    private readonly opts: RulesDecisionOptions = {},
  ) {
    this.bindings = opts.bindings ?? RULE_BINDINGS;
  }

  async decide(node: DecideNode, ctx: RunContext): Promise<Decision> {
    const binding = findBinding(ctx.routineId, node.id, this.bindings);
    // A binding applies only to a decide node whose options propose typed actions — a hand-built
    // spec that shares the routine id (tests, an older draft) keeps its own rule.
    if (!binding || !node.options.some((o) => isActionId(o.params?.actionId))) return this.inner.decide(node, ctx);
    const byId = new Map(node.options.map((o) => [o.id, o]));

    const rows = ctx.reads[binding.readAlias]?.rows ?? [];
    const budgets = new Map<string, number | null>();
    if (binding.budgetsAlias) {
      for (const r of ctx.reads[binding.budgetsAlias]?.rows ?? []) {
        const id = String(r.id ?? r.adset_id ?? "");
        if (!id) continue;
        const b = r.daily_budget;
        budgets.set(id, b === undefined || b === null || b === "" ? null : Number(b));
      }
    }
    const metrics = rows.map((r) => adsetMetricsFromRow(r, budgets.size ? budgets : undefined)).filter((m) => m.adsetId);
    const preset = await resolveMetaPreset(ctx.account.accountId, this.opts.presets ?? null, ctx.routineId);
    // The account's per-day cap is the daily budget ceiling: a scale step may not take the total over it.
    const account = evaluateAdsets(metrics, preset, { accountDailyBudgetCap: ctx.caps.perDay > 0 ? ctx.caps.perDay : null });
    const pick = account.pick;

    const optionId = (pick && binding.optionByVerdict[pick.verdict]) || binding.noActionOption;
    const option = byId.get(optionId);
    if (!option) {
      this.opts.log?.("rules.option_missing", { routineId: ctx.routineId, optionId });
      return this.inner.decide(node, ctx);
    }

    const table = account.evaluations.map((e) => ({ adsetId: redactId(e.metrics.adsetId), name: e.metrics.adsetName ?? null, verdict: e.verdict, rule: e.ruleId, reasonCode: e.reasonCode, nextAction: e.nextAction, spend: e.metrics.spend, cpa: e.metrics.cpa, roas: e.metrics.roas, frequency: e.metrics.frequency, dailyBudget: e.metrics.dailyBudget, scaleLine: e.caps.scaleLine, offLine: e.caps.offLine }));
    const counts = verdictCounts(account);
    const deterministic = pick
      ? `${pick.metrics.adsetName ?? `ad set ${redactId(pick.metrics.adsetId)}`}: ${pick.reason}. Across ${metrics.length} ad set${metrics.length === 1 ? "" : "s"}: ${counts}.`
      : metrics.length
        ? `No ad set needs a change today. Across ${metrics.length} ad set${metrics.length === 1 ? "" : "s"}: ${counts}.`
        : "No ad-set rows were read, so there is nothing to judge today.";

    const evidence = pick ? { ...pick.evidence, adsetCount: metrics.length, counts: account.counts } : { adsetCount: metrics.length, counts: account.counts, preset: { targetCpa: preset.targetCpa, maxCpa: preset.maxCpa, roasFloor: preset.roasFloor, minSpendBeforeJudging: preset.minSpendBeforeJudging } };
    const reasoning = await this.writeReasoning(deterministic, pick?.verdict ?? "keep", evidence, ctx);

    const label = pick ? this.labelFor(pick, ctx.account.currency) : renderTemplate(option.label, ctx);
    const spend = pick?.verdict === "scale" && pick.metrics.dailyBudget !== null ? { amount: Math.max(0, Number(pick.proposedAction!.params.dailyBudget) - pick.metrics.dailyBudget), currency: ctx.account.currency, period: "day" as const } : undefined;
    return {
      optionId,
      label,
      reasoning,
      terminal: option.terminal,
      ...(spend ? { spend } : {}),
      params: {
        ...(pick?.proposedAction ? { actionId: pick.proposedAction.actionId, ...pick.proposedAction.params } : {}),
        verdict: pick?.verdict ?? "keep",
        ruleId: pick?.ruleId ?? null,
        reasonCode: pick?.reasonCode ?? null,
        nextAction: pick?.nextAction ?? null,
        adsetName: pick?.metrics.adsetName ?? null,
        preset: preset.industry,
        evaluated: metrics.length,
        counts: account.counts,
        table,
      },
    };
  }

  private labelFor(pick: NonNullable<AccountEvaluation["pick"]>, currency: string): string {
    const name = pick.metrics.adsetName ?? `ad set ${redactId(pick.metrics.adsetId)}`;
    if (pick.verdict === "scale") {
      const next = Number(pick.proposedAction!.params.dailyBudget);
      const cur = pick.metrics.dailyBudget ?? 0;
      const step = cur > 0 ? Math.round(((next - cur) / cur) * 100) : 0;
      return `Scale ${name}: ${currency} ${cur.toFixed(2)} → ${currency} ${next.toFixed(2)}/day (+${step}%)`;
    }
    if (pick.verdict === "turn_off") return `Turn off ${name}`;
    return `Hold ${name}`;
  }

  private async writeReasoning(deterministic: string, verdict: Verdict, evidence: Record<string, unknown>, ctx: RunContext): Promise<string> {
    const writer = this.opts.writer;
    if (!writer) return deterministic;
    try {
      const text = await writer.complete({
        system: WRITER_SYSTEM,
        user: `VERDICT: ${verdict}\nRULE LINE (what the numbers say): ${deterministic}\nEVIDENCE: ${JSON.stringify(evidence)}\nCURRENCY: ${ctx.account.currency}\nWrite the reasoning line now.`,
        accountId: ctx.account.accountId,
      });
      const clean = (text ?? "").replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_REASONING_CHARS);
      if (!clean || /[{}]/.test(clean)) return deterministic;
      if (!numbersAreGrounded(clean, evidence)) {
        this.opts.log?.("rules.reasoning_ungrounded", { routineId: ctx.routineId });
        return deterministic;
      }
      return clean;
    } catch (err) {
      this.opts.log?.("rules.reasoning_failed", { routineId: ctx.routineId, reason: err instanceof Error ? err.message : String(err) });
      return deterministic;
    }
  }
}
