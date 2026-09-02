/* LLM DecisionProvider for `rule: { kind: "llm" }` decide nodes.

   Threshold / first rules are delegated to DeterministicDecisionProvider
   unchanged. For llm rules the model is offered the node's options and a
   compact view of the run context and must answer with strict JSON
   {"optionId", "reasoning"} naming one of the offered option ids. Anything
   else — no client, refusal, malformed JSON, unknown option, empty reasoning,
   network failure — resolves to the node's declared fallback (or the first
   option) exactly the way DeterministicDecisionProvider does, with a
   reasoning line that says so. The model never gets to invent an option and
   its reasoning is capped and trimmed before it reaches a receipt/approval.

   The Anthropic client is env-gated on ANTHROPIC_API_KEY the same way
   src/app/api/unc/chat/route.ts is; the key is read by the SDK, never by us,
   and never logged. Tests inject a fake LlmClient — no live calls. */

import Anthropic from "@anthropic-ai/sdk";
import { renderParams, renderTemplate, resolveSpend } from "../../lib/runtime/context";
import { DeterministicDecisionProvider } from "../../lib/runtime/providers";
import type { DecideNode, Decision, DecisionOption, DecisionProvider, RunContext } from "../../lib/runtime/types";
import type { Logger } from "../log";

export const LLM_MODEL = "claude-sonnet-5";
export const LLM_MAX_TOKENS = 4000; // adaptive thinking counts against max_tokens; effort pinned low below
export const MAX_REASONING_CHARS = 600;

export interface LlmPrompt {
  system: string;
  user: string;
}

export interface LlmClient {
  /** Returns the model's text. Throws on any transport/refusal failure. */
  complete(prompt: LlmPrompt): Promise<string>;
}

// ---------- prompt ----------

const SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner."

Voice rules (non-negotiable): first person, present tense; numbers over adjectives; you propose and show your working, you never command; never overclaim; warm, direct, concrete; no hype, no exclamation marks.

Product guardrails (absolute): you propose, the founder approves — nothing publishes, sends or spends without their explicit okay. No invented numbers: the ONLY numbers you may use are the ones in the CONTEXT below. If a number you need is not there, say so in the reasoning rather than estimating.

Task: a routine has reached a decision node. Choose exactly one of the OFFERED OPTIONS by id.

Output format (strict): reply with ONLY a JSON object, no prose, no markdown fences:
{"optionId": "<one of the offered ids>", "reasoning": "<1-3 short sentences in your voice explaining the choice, citing the numbers you used>"}`;

function compactContext(ctx: RunContext): Record<string, unknown> {
  const reads: Record<string, unknown> = {};
  for (const [as, r] of Object.entries(ctx.reads)) reads[as] = { count: r.rows.length, metrics: r.metrics, provenance: r.provenance ?? "ok", sample: r.rows.slice(0, 3) };
  return {
    routine: { id: ctx.routineId, version: ctx.version, mode: ctx.mode },
    account: { currency: ctx.account.currency, budgetMonthly: ctx.account.budgetMonthly, approver: ctx.account.approver ?? null },
    caps: ctx.caps,
    reads,
    checks: ctx.checks,
    vars: ctx.vars,
  };
}

export function buildDecisionPrompt(node: DecideNode, ctx: RunContext): LlmPrompt {
  const rule = node.rule.kind === "llm" ? node.rule : null;
  const options = node.options.map((o) => ({
    id: o.id,
    label: renderTemplate(o.label, ctx),
    terminal: !!o.terminal,
    spend: resolveSpend(o.spend, ctx) ?? null,
    params: o.params ? renderParams(o.params, ctx) : null,
  }));
  const user = [
    `QUESTION: ${node.question}`,
    rule?.prompt ? `GUIDANCE: ${renderTemplate(rule.prompt, ctx)}` : "",
    `OFFERED OPTIONS (choose one id): ${JSON.stringify(options)}`,
    `CONTEXT (your only source of numbers): ${JSON.stringify(compactContext(ctx))}`,
    `Reply with the JSON object only.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: SYSTEM, user };
}

// ---------- validation ----------

export type ParsedDecision = { ok: true; optionId: string; reasoning: string } | { ok: false; reason: string };

/** Strict parse of the model's reply against the offered options. */
export function parseLlmDecision(text: string, options: DecisionOption[]): ParsedDecision {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty reply" };
  let body = text.trim();
  // tolerate a ```json fence around an otherwise-valid object
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "reply is not a JSON object" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "reply is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "reply is not a JSON object" };
  const { optionId, reasoning } = parsed as { optionId?: unknown; reasoning?: unknown };
  if (typeof optionId !== "string") return { ok: false, reason: "optionId missing" };
  if (!options.some((o) => o.id === optionId)) return { ok: false, reason: `optionId "${optionId.slice(0, 40)}" is not an offered option` };
  if (typeof reasoning !== "string" || !reasoning.trim()) return { ok: false, reason: "reasoning missing" };
  const clean = reasoning.replace(/\s+/g, " ").trim().slice(0, MAX_REASONING_CHARS);
  return { ok: true, optionId, reasoning: clean };
}

// ---------- provider ----------

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

export interface LlmDecisionProviderOptions {
  log?: Logger;
}

export class LlmDecisionProvider implements DecisionProvider {
  private readonly deterministic = new DeterministicDecisionProvider();

  /** `client` null = no key configured → every llm rule takes its fallback. */
  constructor(
    private readonly client: LlmClient | null,
    private readonly opts: LlmDecisionProviderOptions = {},
  ) {}

  async decide(node: DecideNode, ctx: RunContext): Promise<Decision> {
    if (node.rule.kind !== "llm") return this.deterministic.decide(node, ctx);
    const byId = new Map(node.options.map((o) => [o.id, o]));
    const fallback = (node.rule.fallback && byId.get(node.rule.fallback)) || node.options[0];
    const fallbackWith = (why: string) => toDecision(fallback, `${why}; deterministic fallback → ${renderTemplate(fallback.label, ctx)}.`, ctx);

    if (!this.client) return fallbackWith("No LLM decision provider configured");

    let text: string;
    try {
      text = await this.client.complete(buildDecisionPrompt(node, ctx));
    } catch (err) {
      // Log the failure class only — never the error body (it could echo request details).
      this.opts.log?.warn("decision.llm_failed", { runId: ctx.runId, routineId: ctx.routineId, node: node.id, error: err instanceof Error ? err.name : "unknown" });
      return fallbackWith("LLM decision unavailable (request failed)");
    }
    const parsed = parseLlmDecision(text, node.options);
    if (!parsed.ok) {
      this.opts.log?.warn("decision.llm_rejected", { runId: ctx.runId, routineId: ctx.routineId, node: node.id, reason: parsed.reason });
      return fallbackWith(`LLM reply rejected (${parsed.reason})`);
    }
    this.opts.log?.info("decision.llm_ok", { runId: ctx.runId, routineId: ctx.routineId, node: node.id, optionId: parsed.optionId });
    return toDecision(byId.get(parsed.optionId)!, parsed.reasoning, ctx);
  }
}

// ---------- Anthropic client (env-gated) ----------

/** null when ANTHROPIC_API_KEY is absent — the provider then always falls
    back. The SDK reads the key itself; this module never touches its value. */
export function createAnthropicLlmClient(): LlmClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ maxRetries: 1 });
  return {
    async complete({ system, user }) {
      const response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: LLM_MAX_TOKENS,
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (response.stop_reason === "refusal") throw new Error("refusal");
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    },
  };
}
