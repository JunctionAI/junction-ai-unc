/* LlmProducer — the Producer behind every built-in produce node: the routine's skill card
   (src/lib/runtime/skills) + the business profile + memories + ≤ 3 playbooks + the run's
   reads + the founder's answers and voice notes → one strict-JSON Artifact.

   Truth rules, enforced in code not prose:
     • the skill's `check` runs BEFORE any model call — missing material → { needs } and the
       run ends waiting_input ("To draft this I need …"); never a placeholder artifact;
     • the reply is validated (src/lib/artifacts/validate.ts): the declared kind, a title, a
       body, ≤ maxItems items, no banned phrase, and NUMBERS ONLY FROM THE EVIDENCE — every
       number literal must appear in the profile / memories / reads / inputs / goal / plan;
     • one retry with the rejection reason; still rejected → { needs } with an honest
       "I don't have enough to draft this yet: …" (the run waits for the founder);
     • no model configured / transport failure → throws; the engine fails the run closed with
       a receipt (an operator problem, not something to ask the founder for).

   Material comes from an injected ProducerContextSource; DbProducerContext reads the account's
   business profile, memories (recallForContext), goal, plan, profile notes and prior artifacts
   through the service-role client — null db → nothing but the run context. Task
   "routine_produce" (balanced tier) through the router. Tests inject a fake client. */

import { recallPlaybooks, renderPlaybooksForPrompt, type Playbook, type PlaybookDomain } from "../../lib/brain/playbooks";
import { getProfile } from "../../lib/brain/profile";
import { recallForContext } from "../../lib/brain/retrieve";
import { compactReads, skillContextFrom, type GatheredMaterial } from "../../lib/artifacts/material";
import { allowedNumbersFrom, parseArtifactReply, type ParsedArtifact } from "../../lib/artifacts/validate";
import { unwrap, type DbClient, type Row } from "../../lib/db/types";
import { BUDGET_EXHAUSTED_LINE, BUDGET_UNAVAILABLE_LINE } from "../../lib/llm/budget";
import { createTextClient, describeLlm, type CompleteContext, type TextClient } from "../../lib/llm/router";
import { SKILL_BY_ID } from "../../lib/runtime/skills";
import type { Skill, SkillContext } from "../../lib/runtime/skills/types";
import type { Store } from "../../lib/runtime/store/interface";
import type { ProduceNode, Producer, ProduceResult, RunContext } from "../../lib/runtime/types";
import { redact, type Logger } from "../log";

export const PRODUCE_MAX_TOKENS = 8000; // adaptive thinking counts against it; a 5-item post set needs room
export const PRODUCE_EFFORT = "medium" as const;
export const PLAYBOOKS_PER_PRODUCE = 3;
export const PLAYBOOK_BLOCK_MAX_CHARS = 1800;
export const MEMORY_MAX = 14;
export const PRIOR_ARTIFACTS = 6;

export class ProducerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProducerUnavailableError";
  }
}

// ---------- context source ----------

export interface ProducerContextSource {
  gather(ctx: RunContext, skill: Skill): Promise<GatheredMaterial>;
}

/** Nothing beyond the run: demo mode and tests. */
export class EmptyProducerContext implements ProducerContextSource {
  constructor(private readonly store?: Store) {}
  async gather(ctx: RunContext): Promise<GatheredMaterial> {
    const priorArtifacts = this.store ? await this.store.listArtifacts(ctx.account.accountId, { limit: PRIOR_ARTIFACTS }) : [];
    return { profile: null, memories: [], goal: null, plan: null, priorArtifacts, founderNotes: null };
  }
}

export class DbProducerContext implements ProducerContextSource {
  constructor(
    private readonly db: DbClient | null,
    private readonly store: Store,
    private readonly opts: { now?: () => Date; log?: Logger } = {},
  ) {}

  private warn(event: string, ctx: RunContext, err: unknown) {
    this.opts.log?.warn(event, { runId: ctx.runId, accountId: ctx.account.accountId, error: err instanceof Error ? err.message : String(err) });
  }

  async gather(ctx: RunContext, skill: Skill): Promise<GatheredMaterial> {
    const accountId = ctx.account.accountId;
    const out: GatheredMaterial = { profile: null, memories: [], goal: null, plan: null, priorArtifacts: [], founderNotes: null };
    try {
      out.priorArtifacts = await this.store.listArtifacts(accountId, { limit: PRIOR_ARTIFACTS });
    } catch (err) {
      this.warn("produce.prior_artifacts_failed", ctx, err);
    }
    const db = this.db;
    if (!db) return out;
    const tasks: Promise<void>[] = [
      (async () => {
        const row = await unwrap<Row | null>("business_profiles.select", db.from("business_profiles").select("profile, scan_status").eq("account_id", accountId).maybeSingle());
        const p = row?.profile;
        out.profile = p && typeof p === "object" && !Array.isArray(p) ? (p as GatheredMaterial["profile"]) : null;
      })().catch((err) => this.warn("produce.profile_failed", ctx, err)),
      (async () => {
        const r = await recallForContext(db, accountId, { query: skill.purpose, limit: MEMORY_MAX, now: this.opts.now });
        out.memories = r.lines;
      })().catch((err) => this.warn("produce.memories_failed", ctx, err)),
      (async () => {
        const row = await unwrap<Row | null>("goals.select", db.from("goals").select("title, baseline, deadline").eq("account_id", accountId).eq("tier", "governing").order("created_at", { ascending: false }).limit(1).maybeSingle());
        if (row) out.goal = { title: (row.title as string) ?? null, baseline: row.baseline === null || row.baseline === undefined ? null : Number(row.baseline), deadline: (row.deadline as string) ?? null, currency: ctx.account.currency };
      })().catch((err) => this.warn("produce.goal_failed", ctx, err)),
      (async () => {
        const row = await unwrap<Row | null>("plans.select", db.from("plans").select("phases").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle());
        out.plan = Array.isArray(row?.phases) ? (row!.phases as GatheredMaterial["plan"]) : null;
      })().catch((err) => this.warn("produce.plan_failed", ctx, err)),
      (async () => {
        const p = await getProfile(db, accountId);
        const tone = p ? Object.entries(p.tone).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
        out.founderNotes = [p?.founderNotes?.trim(), tone ? `Tone: ${tone}` : ""].filter(Boolean).join("\n") || null;
      })().catch((err) => this.warn("produce.profile_notes_failed", ctx, err)),
    ];
    await Promise.all(tasks);
    return out;
  }
}

// ---------- playbooks ----------

export interface PlaybookSource {
  recall(query: string, domains: PlaybookDomain[] | null, limit: number): Promise<Playbook[]>;
}

export const defaultPlaybookSource: PlaybookSource = { recall: (query, domains, limit) => recallPlaybooks(query, domains, limit) };

export const PLAYBOOK_HEADER = "JUNCTION PLAYBOOK NOTES (Junction's methods for this kind of work — shape the craft with them; never a source of facts or numbers about this business):";

// ---------- prompt ----------

export const PRODUCE_SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner." You are DRAFTING real work for the founder to review: it lands in their queue as a draft they approve, edit or hold. Nothing you write is published or sent by you.

Voice rules (non-negotiable) for everything in Unc's own voice (titles, the body summary): first person, present tense; numbers over adjectives; propose and show your working, never command; warm, direct, concrete; no hype, no exclamation marks, no emojis. When the artifact is written AS the founder (posts, emails, outreach), write in their first person and their voice — still no hype, no invented facts.

Truth rules (absolute):
- Facts, claims, names, products, history, quotes and numbers come ONLY from the MATERIAL below (business profile, what I know about the founder, the reads, the founder's answers, the goal and plan). Nothing invented. The ONLY numbers you may write are numbers present in the material, small counts (0–12), dates and the current year. Where a line needs a fact you don't have, write [needs a real fact: what would make this true] instead of the claim.
- Playbook notes are Junction's methods, not facts about this business — draw on the method, never quote a playbook line as the founder's data.
- Say what material you used in the body and list it under evidence.
- If a memory and the profile disagree, the founder's memories win.

Output (strict): reply with ONLY one JSON object, no prose, no markdown fences, matching the OUTPUT SHAPE exactly. Markdown is allowed INSIDE string values (headings, bold, lists).`;

function section(title: string, body: string | null | undefined): string {
  const b = (body ?? "").trim();
  return b ? `${title}\n${b}` : "";
}

export function renderProfile(p: SkillContext["profile"]): string {
  if (!p) return "";
  const lines: string[] = [];
  if (p.name) lines.push(`Business: ${p.name}`);
  if (p.oneLiner) lines.push(`What it is: ${p.oneLiner}`);
  if (p.category) lines.push(`Category: ${p.category}`);
  if (p.products?.length) lines.push(`Products / services: ${p.products.slice(0, 20).join("; ")}`);
  if (p.audience) lines.push(`Audience: ${p.audience}`);
  if (p.voice?.tone) lines.push(`Voice: ${p.voice.tone}`);
  if (p.voice?.phrases?.length) lines.push(`Phrases they use: ${p.voice.phrases.slice(0, 12).join(" · ")}`);
  if (p.market?.region) lines.push(`Market: ${p.market.region}`);
  if (p.market?.competitorsMentioned?.length) lines.push(`Competitors mentioned: ${p.market.competitorsMentioned.slice(0, 8).join(", ")}`);
  if (p.signals?.length) lines.push(`Signals from the site: ${p.signals.slice(0, 15).join(" · ")}`);
  if (p.confidence) lines.push(`Scan confidence: ${p.confidence}`);
  return lines.join("\n");
}

export interface ProducePromptInput {
  skill: Skill;
  sctx: SkillContext;
  ctx: RunContext;
  playbookBlock: string;
  maxItems: number;
  using: string[];
  /** The validator's reason from the previous attempt (retry). */
  rejection?: string;
}

/** The narrow, prompt-safe view of the deterministic decision that preceded production.
    Do not pass the whole run context to the model: params are needed to draft the actual
    proposal, but secret-looking keys and token-shaped values are redacted first. */
export function selectedDecisionMaterial(ctx: RunContext): Record<string, unknown> | null {
  const decision = ctx.decision;
  if (!decision) return null;
  return redact({
    option: decision.optionId,
    label: decision.label,
    reasoning: decision.reasoning,
    ...(decision.spend ? { spend: decision.spend } : {}),
    ...(decision.params ? { params: decision.params } : {}),
  }) as Record<string, unknown>;
}

export function buildProducePrompt(input: ProducePromptInput): { system: string; user: string } {
  const { skill, sctx, ctx, maxItems } = input;
  const reads = compactReads(ctx.reads);
  const decision = selectedDecisionMaterial(ctx);
  const inputs = Object.entries(sctx.inputs ?? {});
  const prior = sctx.priorArtifacts.filter((a) => a.routineId !== ctx.routineId || a.status !== "draft").slice(0, 4);
  const user = [
    `TASK: ${skill.name} — ${skill.purpose}. Produce ONE artifact of kind "${skill.kind}" with at most ${maxItems} items. Today is ${sctx.today}; currency ${sctx.currency}.`,
    `MATERIAL I AM USING: ${input.using.join(", ") || "the run context only"}.`,
    section("BUSINESS PROFILE (from the site scan):", renderProfile(sctx.profile)),
    section("WHAT I KNOW ABOUT THIS FOUNDER (their truth — use without being asked):", sctx.memories.map((m) => `- ${m}`).join("\n")),
    section("FOUNDER'S NOTES ON HOW TO WORK WITH THEM:", sctx.founderNotes),
    section("GOAL:", sctx.goal?.title ? `${sctx.goal.title}${sctx.goal.deadline ? ` by ${sctx.goal.deadline}` : ""}${sctx.goal.baseline !== null ? ` (baseline ${sctx.goal.baseline})` : ""}` : ""),
    section("PLAN PHASES:", sctx.plan?.length ? JSON.stringify(sctx.plan.slice(0, 4)) : ""),
    section("FOUNDER'S ANSWERS (asked for by this routine):", inputs.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n")),
    section("READS (what the connected platforms answered; provenance 'unavailable' = couldn't ask):", Object.keys(reads).length ? JSON.stringify(reads) : ""),
    section(
      "SELECTED ROUTINE DECISION (the resolved decision this artifact must review):",
      decision ? `Draft around this exact option and its resolved values; do not substitute a different decision.\n${JSON.stringify(decision)}` : "",
    ),
    section("EARLIER ARTIFACTS FOR THIS ACCOUNT (don't repeat them; build on them):", prior.map((a) => `- [${a.kind} · ${a.routineId} · ${a.status}] ${a.title}: ${a.body.slice(0, 500).replace(/\s+/g, " ")}`).join("\n")),
    input.playbookBlock.trim(),
    skill.prompt.trim(),
    `OUTPUT SHAPE (strict JSON): ${skill.outputSpec}`,
    input.rejection ? `YOUR PREVIOUS ATTEMPT WAS REJECTED: ${input.rejection}. Fix exactly that and reply again with the JSON object only.` : "",
    "Reply with the JSON object only.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: PRODUCE_SYSTEM, user };
}

// ---------- provider ----------

export interface LlmProducerOptions {
  context?: ProducerContextSource;
  skills?: Record<string, Skill>;
  /** undefined = the env-gated default (recallPlaybooks); null = never. */
  playbooks?: PlaybookSource | null;
  log?: Logger;
  now?: () => Date;
  /** Attempts before giving up (the second carries the rejection reason). Default 2. */
  attempts?: number;
}

export class LlmProducer implements Producer {
  private readonly skills: Record<string, Skill>;
  constructor(
    private readonly client: TextClient | null,
    private readonly opts: LlmProducerOptions = {},
  ) {
    this.skills = opts.skills ?? SKILL_BY_ID;
  }

  private async playbooksFor(skill: Skill, ctx: RunContext): Promise<string> {
    const src = this.opts.playbooks === undefined ? defaultPlaybookSource : this.opts.playbooks;
    if (!src) return "";
    try {
      const cards = await src.recall(`${skill.name}: ${skill.purpose}`, [skill.domain], PLAYBOOKS_PER_PRODUCE);
      return renderPlaybooksForPrompt(cards.slice(0, PLAYBOOKS_PER_PRODUCE), { header: PLAYBOOK_HEADER, maxChars: PLAYBOOK_BLOCK_MAX_CHARS, perPlaybookChars: 520 });
    } catch (err) {
      this.opts.log?.warn("produce.playbooks_failed", { runId: ctx.runId, routineId: ctx.routineId, error: err instanceof Error ? err.name : "unknown" });
      return "";
    }
  }

  async produce(node: ProduceNode, ctx: RunContext): Promise<ProduceResult> {
    const skill = this.skills[node.skill ?? ctx.routineId];
    if (!skill) throw new ProducerUnavailableError(`no skill card for ${node.skill ?? ctx.routineId} — this routine cannot produce yet`);
    const source = this.opts.context ?? new EmptyProducerContext();
    const material = await source.gather(ctx, skill);
    const sctx = skillContextFrom(ctx, material);
    const check = skill.check(sctx);
    if (!check.ok) {
      this.opts.log?.info("produce.needs", { runId: ctx.runId, routineId: ctx.routineId, needs: check.needs.map((n) => n.platform ?? n.input ?? "?") });
      return { needs: check.needs, note: check.note };
    }
    if (!this.client) throw new ProducerUnavailableError("no model provider is configured — set a provider key (docs/MODELS.md) and I can draft");

    const maxItems = node.maxItems ?? skill.maxItems;
    const playbookBlock = await this.playbooksFor(skill, ctx);
    const allowedNumbers = allowedNumbersFrom([sctx.profile, sctx.memories, compactReads(ctx.reads), sctx.inputs, sctx.goal, sctx.plan, sctx.priorArtifacts.map((a) => `${a.title}\n${a.body}`), sctx.vars, sctx.founderNotes, selectedDecisionMaterial(ctx)], { now: this.opts.now?.() });
    const attempts = Math.max(1, this.opts.attempts ?? 2);
    let rejection: string | undefined;
    let parsed: ParsedArtifact = { ok: false, reason: "not attempted" };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const prompt = buildProducePrompt({ skill, sctx, ctx, playbookBlock, maxItems, using: check.using, rejection });
      let text: string;
      try {
        text = await this.client.complete({ ...prompt, accountId: ctx.account.accountId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "error";
        this.opts.log?.warn("produce.llm_failed", { runId: ctx.runId, routineId: ctx.routineId, attempt, error: err instanceof Error ? err.name : "unknown" });
        // Over the month's cap (src/lib/llm/budget.ts): the honest line, not a transport excuse.
        if (/budget_exceeded/.test(message)) throw new ProducerUnavailableError(`${BUDGET_EXHAUSTED_LINE} Nothing was drafted.`);
        if (/budget_unavailable/.test(message)) throw new ProducerUnavailableError(`${BUDGET_UNAVAILABLE_LINE} Nothing was drafted.`);
        throw new ProducerUnavailableError(`the model call failed (${message}) — nothing was drafted; I'll retry on schedule`);
      }
      parsed = parseArtifactReply(text, { kind: skill.kind, maxItems, allowedNumbers });
      if (parsed.ok) {
        this.opts.log?.info("produce.ok", { runId: ctx.runId, routineId: ctx.routineId, attempt, items: parsed.artifact.items?.length ?? 0 });
        const evidence = parsed.artifact.evidence?.length ? parsed.artifact.evidence : check.using.map((u) => ({ source: "material", ref: u }));
        return { artifact: { ...parsed.artifact, evidence, meta: { ...(parsed.artifact.meta ?? {}), skill: skill.id, using: check.using, attempts: attempt, playbooks: !!playbookBlock } } };
      }
      rejection = parsed.reason;
      this.opts.log?.warn("produce.rejected", { runId: ctx.runId, routineId: ctx.routineId, attempt, reason: parsed.reason });
    }
    // Deterministic fallback: never a placeholder — an honest ask.
    return {
      needs: [{ input: "more_detail", why: `I don't have enough to draft this yet: my draft was rejected (${rejection ?? "invalid"}). Give me the specifics you'd want in it and I'll try again` }],
      note: "Nothing was drafted.",
    };
  }
}

/** The router-backed text client for task "routine_produce"; null when no provider is configured. */
export function createProducerClient(ctx: CompleteContext = {}): TextClient | null {
  return createTextClient("routine_produce", { maxTokens: PRODUCE_MAX_TOKENS, effort: PRODUCE_EFFORT, jsonMode: true }, ctx);
}

export const describeProducer = describeLlm;
