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

   Personalisation (src/lib/brain/taste.ts): the prompt carries a FOUNDER block — the
   account's tone / decision style (account_profiles) and 2–4 taste lines derived from the
   approvals ledger ("held 3 of 4 budget shifts above NZ$50/day…"). After ANY decision (llm
   or deterministic) the taste-derived spend ceiling shrinks a proposal that exceeds it —
   never expands one — and the reasoning says so ("Kept under your usual NZ$50/day"), which
   is what lands on the approval. A personalisation lookup that fails is a warning: the
   decision proceeds without it.

   The production client comes from the model-provider layer
   (src/lib/llm/router.ts, task "routine_decision": account setting →
   LLM_MODEL_ROUTINE_DECISION → the first configured provider's fast tier).
   Keys are read there from process.env, never by us, never logged. Tests
   inject a fake LlmClient — no live calls. */

import { recallPlaybooks, renderPlaybooksForPrompt, type Playbook, type PlaybookDomain } from "../../lib/brain/playbooks";
import { applySpendCeiling, readAccountProfile, renderProfileForDecision, renderTasteForDecision, suggestedSpendCeiling, tastePatterns } from "../../lib/brain/taste";
import type { DbClient } from "../../lib/db/types";
import { createTextClient, describeLlm, type CompleteContext } from "../../lib/llm/router";
import { ALL_SYSTEMS, type CategoryName } from "../../lib/platform/catalog";
import { describeActionsForPrompt, isActionId } from "../../lib/actions";
import { renderParams, renderTemplate, resolveSpend } from "../../lib/runtime/context";
import { DeterministicDecisionProvider } from "../../lib/runtime/providers";
import type { Store } from "../../lib/runtime/store/interface";
import type { DecideNode, Decision, DecisionOption, DecisionProvider, RunContext } from "../../lib/runtime/types";
import type { Logger } from "../log";

export const LLM_MAX_TOKENS = 4000; // adaptive thinking counts against max_tokens; effort pinned low below
export const LLM_EFFORT = "low" as const;
export const MAX_REASONING_CHARS = 600;

/* Playbooks in the DECIDE prompt (docs/PRODUCT-EXPERIENCE.md "Playbooks in the answers"): ≤ 2 of
   Junction's method cards for the routine's domain, recalled by routine name + question. They
   inform the choice, never the numbers — the SYSTEM prompt says so. Env-gated through
   recallPlaybooks: no database → no cards; no embeddings → keyword recall. */
export const PLAYBOOKS_PER_DECISION = 2;
export const PLAYBOOK_BLOCK_MAX_CHARS = 700;
export const PLAYBOOK_BLOCK_HEADER = "JUNCTION PLAYBOOK NOTES (Junction's methods for this kind of decision — use when relevant, never a source of numbers):";

const CATEGORY_DOMAIN: Record<CategoryName, PlaybookDomain> = { Content: "content", "Paid ads": "paid", SEO: "seo", Sales: "sales", "Email & SMS": "email" };
const ROUTINE_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s]));

/** The playbook domain a routine belongs to (its catalog category), or null for an unknown id. */
export function routineDomain(routineId: string): PlaybookDomain | null {
  const r = ROUTINE_BY_ID.get(routineId);
  return r ? (CATEGORY_DOMAIN[r.cat] ?? null) : null;
}

/** The recall query for a decide node: routine name + the question (+ the rule's guidance). */
export function playbookQuery(routineId: string, node: Pick<DecideNode, "question" | "rule">): string {
  const name = ROUTINE_BY_ID.get(routineId)?.name ?? routineId;
  const guidance = node.rule.kind === "llm" && node.rule.prompt ? ` ${node.rule.prompt}` : "";
  return `${name}: ${node.question}${guidance}`.slice(0, 500);
}

export interface PlaybookSource {
  /** ≤ `limit` cards for the query within `domains` (null = any). Must not throw for "nothing". */
  recall(query: string, domains: PlaybookDomain[] | null, limit: number): Promise<Playbook[]>;
}

/** The env-gated default: src/lib/brain/playbooks.ts recallPlaybooks (service-role db when configured, else []). */
export const defaultPlaybookSource: PlaybookSource = {
  recall: (query, domains, limit) => recallPlaybooks(query, domains, limit),
};

export function renderPlaybookBlock(cards: Playbook[]): string {
  return renderPlaybooksForPrompt(cards.slice(0, PLAYBOOKS_PER_DECISION), { header: PLAYBOOK_BLOCK_HEADER, maxChars: PLAYBOOK_BLOCK_MAX_CHARS, perPlaybookChars: 280 });
}

export interface LlmPrompt {
  system: string;
  user: string;
  /** Set by the provider so a shared client can honour the account's model setting. */
  accountId?: string;
}

export interface LlmClient {
  /** Returns the model's text. Throws on any transport/refusal failure. */
  complete(prompt: LlmPrompt): Promise<string>;
}

// ---------- prompt ----------

const SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner."

Voice rules (non-negotiable): first person, present tense; numbers over adjectives; you propose and show your working, you never command; never overclaim; warm, direct, concrete; no hype, no exclamation marks.

Product guardrails (absolute): you propose, the founder approves — nothing publishes, sends or spends without their explicit okay. No invented numbers: the ONLY numbers you may use are the ones in the CONTEXT below. If a number you need is not there, say so in the reasoning rather than estimating.

Personalisation: when a FOUNDER block is present it tells you how this founder likes to work and what they have approved or held before. Propose within their comfort — or explain in the reasoning why this time is different. When a taste line shaped your choice, say so in the reasoning in their terms (e.g. "kept under your usual NZ$50/day").

Playbooks: when a JUNCTION PLAYBOOK NOTES block is present, it holds Junction's methods for this kind of decision — not facts about the founder's business. Let them inform the choice and name the method in the reasoning when it did; never take a number from them and never present a playbook line as something that happened in this account.

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

/** What the decider knows about this founder (taste.ts) — empty lines = nothing known yet. */
export interface Personalisation {
  /** From account_profiles: tone, decision style, founder notes. */
  profileLines: string[];
  /** From the approvals ledger: approval rates, hold reasons, spend comfort. */
  tasteLines: string[];
  /** Per-day spend the evidence says to stay under; null = no pattern. */
  spendCeiling: number | null;
  currency: string;
}

export function renderFounderBlock(p: Personalisation | null | undefined): string {
  if (!p) return "";
  const lines = [...p.profileLines, ...p.tasteLines];
  return lines.length ? `FOUNDER (how they like to work; what they have approved or held):\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

export function buildDecisionPrompt(node: DecideNode, ctx: RunContext, personal?: Personalisation | null, playbookBlock = ""): LlmPrompt {
  const rule = node.rule.kind === "llm" ? node.rule : null;
  const options = node.options.map((o) => ({
    id: o.id,
    label: renderTemplate(o.label, ctx),
    terminal: !!o.terminal,
    spend: resolveSpend(o.spend, ctx) ?? null,
    params: o.params ? renderParams(o.params, ctx) : null,
  }));
  // Options that name a typed action get the library's description of what it does and risks.
  const actionIds = [...new Set(node.options.map((o) => o.params?.actionId).filter(isActionId))];
  const user = [
    `QUESTION: ${node.question}`,
    rule?.prompt ? `GUIDANCE: ${renderTemplate(rule.prompt, ctx)}` : "",
    `OFFERED OPTIONS (choose one id): ${JSON.stringify(options)}`,
    actionIds.length ? describeActionsForPrompt(actionIds) : "",
    renderFounderBlock(personal),
    playbookBlock.trim(),
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

export interface PersonalisationSource {
  /** null = nothing known (demo, no ledger yet). Must not throw for "no data". */
  forAccount(accountId: string, currency: string): Promise<Personalisation | null>;
}

/** Store-backed source with a short per-account cache (a run has several decide nodes; a
    tick has several runs). `db` null → no profile block, taste lines only. */
export class StorePersonalisation implements PersonalisationSource {
  private readonly cache = new Map<string, { at: number; value: Personalisation | null }>();
  private readonly now: () => Date;
  private readonly ttlMs: number;
  constructor(
    private readonly store: Store,
    private readonly db: DbClient | null,
    opts: { now?: () => Date; ttlMs?: number } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
  }
  async forAccount(accountId: string, currency: string): Promise<Personalisation | null> {
    const hit = this.cache.get(accountId);
    const t = this.now().getTime();
    if (hit && t - hit.at < this.ttlMs) return hit.value;
    const patterns = await tastePatterns(this.store, accountId, { now: this.now, currency });
    const profile = this.db ? await readAccountProfile(this.db, accountId) : null;
    const value: Personalisation = { profileLines: renderProfileForDecision(profile), tasteLines: renderTasteForDecision(patterns, null, currency), spendCeiling: suggestedSpendCeiling(patterns), currency };
    const out = value.profileLines.length || value.tasteLines.length || value.spendCeiling !== null ? value : null;
    this.cache.set(accountId, { at: t, value: out });
    return out;
  }
}

export interface LlmDecisionProviderOptions {
  log?: Logger;
  /** Taste + profile for the FOUNDER block and the spend ceiling. Absent = impersonal. */
  personalisation?: PersonalisationSource | null;
  /** Junction's playbooks for the PLAYBOOK NOTES block. undefined = the env-gated default
      (recallPlaybooks); null = never. */
  playbooks?: PlaybookSource | null;
  /** Playbook cache TTL per (routine, node) — a tick has several runs of the same routine. */
  playbookTtlMs?: number;
  now?: () => Date;
}

export class LlmDecisionProvider implements DecisionProvider {
  private readonly deterministic = new DeterministicDecisionProvider();
  private readonly playbookCache = new Map<string, { at: number; block: string }>();

  /** `client` null = no key configured → every llm rule takes its fallback. */
  constructor(
    private readonly client: LlmClient | null,
    private readonly opts: LlmDecisionProviderOptions = {},
  ) {}

  private async personal(ctx: RunContext): Promise<Personalisation | null> {
    const src = this.opts.personalisation;
    if (!src) return null;
    try {
      return await src.forAccount(ctx.account.accountId, ctx.account.currency);
    } catch (err) {
      this.opts.log?.warn("decision.personalisation_failed", { runId: ctx.runId, accountId: ctx.account.accountId, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** The rendered PLAYBOOK NOTES block for this routine's node ("" when none / disabled / failed). */
  private async playbooksFor(node: DecideNode, ctx: RunContext): Promise<string> {
    const src = this.opts.playbooks === undefined ? defaultPlaybookSource : this.opts.playbooks;
    if (!src) return "";
    const key = `${ctx.routineId}:${node.id}`;
    const t = (this.opts.now ?? (() => new Date()))().getTime();
    const hit = this.playbookCache.get(key);
    if (hit && t - hit.at < (this.opts.playbookTtlMs ?? 10 * 60_000)) return hit.block;
    let block = "";
    try {
      const domain = routineDomain(ctx.routineId);
      const cards = await src.recall(playbookQuery(ctx.routineId, node), domain ? [domain] : null, PLAYBOOKS_PER_DECISION);
      block = renderPlaybookBlock(cards);
    } catch (err) {
      // A missing table, a network blip: the decision proceeds without notes.
      this.opts.log?.warn("decision.playbooks_failed", { runId: ctx.runId, routineId: ctx.routineId, node: node.id, error: err instanceof Error ? err.name : "unknown" });
      block = "";
    }
    this.playbookCache.set(key, { at: t, block });
    return block;
  }

  /** Every decision — llm or deterministic — passes the taste-derived spend ceiling on its way
      to the gate. The ceiling can only lower a proposal. */
  async decide(node: DecideNode, ctx: RunContext): Promise<Decision> {
    const personal = await this.personal(ctx);
    const decision = await this.choose(node, ctx, personal);
    return applySpendCeiling(decision, personal?.spendCeiling ?? null, personal?.currency ?? ctx.account.currency);
  }

  private async choose(node: DecideNode, ctx: RunContext, personal: Personalisation | null): Promise<Decision> {
    if (node.rule.kind !== "llm") return this.deterministic.decide(node, ctx);
    const byId = new Map(node.options.map((o) => [o.id, o]));
    const fallback = (node.rule.fallback && byId.get(node.rule.fallback)) || node.options[0];
    const fallbackWith = (why: string) => toDecision(fallback, `${why}; deterministic fallback → ${renderTemplate(fallback.label, ctx)}.`, ctx);

    if (!this.client) return fallbackWith("No LLM decision provider configured");

    const playbookBlock = await this.playbooksFor(node, ctx);
    let text: string;
    try {
      text = await this.client.complete({ ...buildDecisionPrompt(node, ctx, personal, playbookBlock), accountId: ctx.account.accountId });
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

// ---------- router-backed client (env-gated) ----------

/** null when no provider is configured — the provider then always falls back.
    The router reads the keys itself; this module never touches a value. */
export function createLlmClient(ctx: CompleteContext = {}): LlmClient | null {
  return createTextClient("routine_decision", { maxTokens: LLM_MAX_TOKENS, effort: LLM_EFFORT, jsonMode: true }, ctx);
}

/** For the boot log. */
export const describeLlmClient = describeLlm;
