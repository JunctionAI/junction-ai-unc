/* Unc's weekly self-review — "what worked, what I'm changing, one ask".

   gatherSelfReviewEvidence(store, accountId, now)   the last 7 days: receipts, runs,
     approvals (approved/held + which routines), outcomes vs their KPI contracts, taste
     patterns. Everything the review may cite; the ONLY source of numbers.
   parseSelfReview(raw, evidence)                     validates the model output:
     - numbers: every number in the prose must exist in the evidence (or be a small
       count 1–12) — a field with an invented number falls back to the deterministic copy;
     - changes: only real levers — enable / disable / reprioritise a catalog routine id,
       adjust_cadence to "manual" or a 5-field cron. Anything else is dropped (rejected);
     - ask: exactly one question; missing → the deterministic ask.
   deterministicSelfReview(evidence)                  the copy used when there is no model
     (no ANTHROPIC_API_KEY), the model refused, or a field failed validation.
   generateSelfReview({ store, accountId, now, llm }) gather → write → validate → store
     (idempotent per ISO week; the Monday (UTC) is the key).

   SDK-free and relative-imports-only so it compiles into the worker; the API route and the
   worker inject the model client (same shape as src/worker/providers/llmDecision.ts LlmClient;
   production wiring is src/lib/llm/router.ts createTextClient("self_review", …)). */

import { ALL_SYSTEMS } from "../platform/catalog";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { newId } from "../runtime/context";
import type { SelfReviewChange, SelfReviewChangeAction, SelfReviewRecord, Store } from "../runtime/store/interface";
import { isValidCadence } from "../runtime/validate";
import { latestByRoutine, meetsTarget, isMeasured } from "./outcomes";

// ---------- evidence ----------

export interface RoutineEvidence {
  id: string;
  name: string;
  enabled: boolean;
  cadence: string;
  runsDone: number;
  runsFailed: number;
  runsSkipped: number;
  drafts: number;
  approved: number;
  held: number;
  kpi: { key: string; label: string; unit: string; target: number; actual: number | null; hit: boolean | null; provenance: string } | null;
}

export interface SelfReviewEvidence {
  /** Monday (UTC) of the reviewed week, YYYY-MM-DD. */
  weekStart: string;
  windowStart: string;
  windowEnd: string;
  totals: { receipts: number; runsDone: number; runsFailed: number; drafts: number; approved: number; held: number; pending: number; routinesOn: number };
  routines: RoutineEvidence[];
  taste: { approvedRatePct: number | null; heldRoutines: string[]; whyOpened: number; edited: number };
  outcomes: { hit: number; miss: number; unmeasured: number };
}

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the ISO week containing `d`. */
export function weekStartUtc(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return monday.toISOString().slice(0, 10);
}

const NAME_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.name]));

export async function gatherSelfReviewEvidence(store: Store, accountId: string, now: Date): Promise<SelfReviewEvidence> {
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const [runs, receipts, approvedAll, heldAll, pendingAll, taste, outcomes] = await Promise.all([
    store.listRuns(accountId, { since: windowStart }),
    store.listReceipts(accountId, { since: windowStart }),
    store.listApprovals(accountId, "approved"),
    store.listApprovals(accountId, "held"),
    store.listApprovals(accountId, "pending"),
    store.listTasteEvents(accountId, { since: windowStart }),
    store.listOutcomes(accountId, { since: windowStart }),
  ]);
  const inWindow = <T extends { createdAt: string }>(xs: T[]) => xs.filter((x) => x.createdAt >= windowStart && x.createdAt <= windowEnd);
  const approved = inWindow(approvedAll);
  const held = inWindow(heldAll);
  const latestOutcome = latestByRoutine(outcomes);

  const byRoutine = new Map<string, RoutineEvidence>();
  const ensure = (id: string): RoutineEvidence => {
    let r = byRoutine.get(id);
    if (!r) {
      const spec = CATALOG_SPEC_BY_ID[id];
      const trigger = spec?.nodes.find((n) => n.kind === "trigger");
      r = { id, name: NAME_BY_ID.get(id) ?? id, enabled: false, cadence: trigger && trigger.kind === "trigger" ? trigger.cadence : "manual", runsDone: 0, runsFailed: 0, runsSkipped: 0, drafts: 0, approved: 0, held: 0, kpi: null };
      byRoutine.set(id, r);
    }
    return r;
  };
  const runById = new Map(runs.map((r) => [r.id, r]));
  for (const r of runs) {
    const e = ensure(r.routineId);
    if (r.status === "done") e.runsDone++;
    else if (r.status === "failed") e.runsFailed++;
    else if (r.status === "skipped") e.runsSkipped++;
  }
  for (const rc of receipts) {
    if (rc.kind !== "draft") continue;
    const run = runById.get(rc.runId);
    if (run) ensure(run.routineId).drafts++;
  }
  for (const a of approved) ensure(a.routineId).approved++;
  for (const a of held) ensure(a.routineId).held++;
  for (const [id, o] of latestOutcome) {
    const e = ensure(id);
    const contract = CATALOG_SPEC_BY_ID[id]?.kpi;
    e.kpi = { key: o.kpiKey, label: contract?.label ?? o.kpiKey, unit: contract?.unit ?? "", target: o.kpiTarget, actual: o.kpiActual, hit: isMeasured(o) ? meetsTarget(o.kpiOp, o.kpiTarget, o.kpiActual) : null, provenance: o.provenance };
  }
  // enabled flags for everything touched + every enabled routine (so "disable" has a real target)
  for (const spec of Object.values(CATALOG_SPEC_BY_ID)) {
    const state = await store.getRoutineState(accountId, spec.id);
    if (!state) continue;
    if (state.enabled || byRoutine.has(spec.id)) ensure(spec.id).enabled = state.enabled;
  }

  const routines = [...byRoutine.values()].sort((a, b) => a.id.localeCompare(b.id));
  const decided = approved.length + held.length;
  let hit = 0;
  let miss = 0;
  let unmeasured = 0;
  for (const o of latestOutcome.values()) {
    if (!isMeasured(o)) unmeasured++;
    else if (meetsTarget(o.kpiOp, o.kpiTarget, o.kpiActual)) hit++;
    else miss++;
  }
  return {
    weekStart: weekStartUtc(now),
    windowStart,
    windowEnd,
    totals: {
      receipts: receipts.length,
      runsDone: runs.filter((r) => r.status === "done").length,
      runsFailed: runs.filter((r) => r.status === "failed").length,
      drafts: receipts.filter((r) => r.kind === "draft").length,
      approved: approved.length,
      held: held.length,
      pending: pendingAll.length,
      routinesOn: routines.filter((r) => r.enabled).length,
    },
    routines,
    taste: {
      approvedRatePct: decided ? Math.round((approved.length / decided) * 100) : null,
      heldRoutines: [...new Set(held.map((a) => a.routineId))].sort(),
      whyOpened: taste.filter((t) => t.action === "why_opened").length,
      edited: taste.filter((t) => t.action === "edited").length,
    },
    outcomes: { hit, miss, unmeasured },
  };
}

// ---------- the review shape ----------

export interface SelfReview {
  worked: string;
  changing: string;
  ask: string;
  changes: SelfReviewChange[];
}

export const CHANGE_ACTIONS: SelfReviewChangeAction[] = ["enable", "disable", "reprioritise", "adjust_cadence"];

// ---------- prompt ----------

export const SELF_REVIEW_MAX_TOKENS = 4000;
export const SELF_REVIEW_EFFORT = "low" as const;

export const SELF_REVIEW_SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner." You are writing your own weekly self-review for the founder: what worked, what you are changing, and one ask of them.

Voice (non-negotiable): first person, present tense, numbers over adjectives. Warm, direct, concrete. No hype, no exclamation marks, no emojis, no markdown. Never call yourself a "fully autonomous AI employee"; never promise "10x overnight" or "set and forget". Own misses plainly, in one clause — no softening, no excuses.
Concision: lead with the number or the decision; one idea per sentence; never restate what the evidence already labels, never say what you are "about to" do. No filler — never "great", "solid week", "it's worth noting", "in other words", "absolutely", "as you know". If a sentence carries neither a number from the evidence nor a reason, cut it.
Judgement: "changing" takes a position — the one thing you'd change and why the evidence says so. If nothing should change, say that and why; never change something to look busy.

You are given EVIDENCE: the last seven days of your own work on this account — runs, drafts, what the founder approved or held, each routine's KPI contract measured against its actual, and taste patterns. It is the ONLY source of numbers you may use.

Write strict JSON only:
{"worked": string, "changing": string, "ask": string, "changes": [{"action": "enable"|"disable"|"reprioritise"|"adjust_cadence", "routineId": string, "cadence"?: string, "why": string}]}

- worked: 1–3 sentences, ≤ 70 words. What moved, with the numbers present in the evidence. If little ran, say so plainly.
- changing: 1–3 sentences, ≤ 70 words. What you are changing and why, tied to a held decision, a missed KPI, or a routine that did nothing.
- ask: exactly ONE question for the founder, ≤ 30 words, ending with a question mark. Something only they can answer or decide.
- changes: 0–4 entries. ONLY real levers: enable a routine that is off, disable a routine that is on, reprioritise a routine, or adjust_cadence (cadence = "manual" or a 5-field cron like "0 7 * * 1"). routineId must be one of the ids in the evidence (or a catalog id like D05-W04 to enable). Never invent an action or an id. Empty list is fine.

Hard rules:
- The ONLY numbers you may write are numbers that appear in the evidence — no arithmetic that produces a new number, no estimates.
- Never claim anything sent, published or spent — you draft and propose; the founder approves.
- Output the JSON object and nothing else.`;

export function buildSelfReviewUserMessage(evidence: SelfReviewEvidence): string {
  return ["EVIDENCE (last 7 days; the only source of numbers)", JSON.stringify(evidence), "", "Write the JSON now."].join("\n");
}

// ---------- validation ----------

/* Numbers-only guard — the same approach as src/lib/unc/narrative.ts allowedNumbers /
   numbersOk, kept local so the worker build stays free of the Next-side unc modules. */
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (t: string) => t.replace(/,/g, "");

export function allowedNumbers(evidence: SelfReviewEvidence): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i <= 12; i++) set.add(String(i));
  for (const m of JSON.stringify(evidence).match(NUM_RE) ?? []) set.add(normNum(m));
  // routine ids carry digits ("D05-W04") — allow them whole so citing a routine is fine
  for (const r of evidence.routines) for (const m of r.id.match(NUM_RE) ?? []) set.add(normNum(m));
  return set;
}

export function numbersOk(text: string, allowed: Set<string>): boolean {
  return (text.match(NUM_RE) ?? []).every((m) => allowed.has(normNum(m)));
}

const NO_MARKDOWN = /[*#_`>]|\[[^\]]*\]\(/;
const EMOJI = /[\u{1F300}-\u{1FAFF}]/u;
const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-Z“"'(])/;

function cleanProse(v: unknown, maxSentences: number, maxChars: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || NO_MARKDOWN.test(t) || EMOJI.test(t) || /!/.test(t)) return null;
  return t.split(SENTENCE_SPLIT).slice(0, maxSentences).join(" ").slice(0, maxChars).trim();
}

export function extractJsonObject(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const CATALOG_IDS = new Set(ALL_SYSTEMS.map((s) => s.id));

/** A change is real only if it names a catalog routine and pulls a lever that exists for
    its current state. Returns the reason it was rejected, or null when it stands. */
export function rejectChange(c: unknown, evidence: SelfReviewEvidence): string | null {
  if (!c || typeof c !== "object") return "not an object";
  const { action, routineId, cadence, why } = c as Record<string, unknown>;
  if (typeof action !== "string" || !CHANGE_ACTIONS.includes(action as SelfReviewChangeAction)) return `unknown action "${String(action)}"`;
  if (typeof routineId !== "string" || !CATALOG_IDS.has(routineId)) return `unknown routine "${String(routineId)}"`;
  const known = evidence.routines.find((r) => r.id === routineId);
  const enabled = known?.enabled ?? false;
  if (action === "enable" && enabled) return `${routineId} is already on`;
  if (action === "disable" && !enabled) return `${routineId} is already off`;
  if (action === "adjust_cadence") {
    if (!enabled) return `${routineId} is off — nothing to re-schedule`;
    if (typeof cadence !== "string" || !isValidCadence(cadence)) return `invalid cadence "${String(cadence)}"`;
  }
  if (typeof why !== "string" || !why.trim()) return "missing why";
  return null;
}

export interface ParsedSelfReview {
  review: SelfReview;
  /** worked / changing / ask that came from the model (0–3). */
  liveFields: number;
  /** Changes the model proposed that were not real levers (kept for the log, never stored). */
  rejected: string[];
}

export function parseSelfReview(raw: unknown, evidence: SelfReviewEvidence): ParsedSelfReview {
  const fallback = deterministicSelfReview(evidence);
  if (!raw || typeof raw !== "object") return { review: fallback, liveFields: 0, rejected: [] };
  const r = raw as Record<string, unknown>;
  const allowed = allowedNumbers(evidence);
  let live = 0;

  const worked = (() => {
    const t = cleanProse(r.worked, 3, 480);
    if (!t || !numbersOk(t, allowed)) return fallback.worked;
    live++;
    return t;
  })();
  const changing = (() => {
    const t = cleanProse(r.changing, 3, 480);
    if (!t || !numbersOk(t, allowed)) return fallback.changing;
    live++;
    return t;
  })();
  const ask = (() => {
    // not clipped to one sentence on purpose: a second question must fail, not be trimmed away
    const t = cleanProse(r.ask, 4, 220);
    if (!t || !numbersOk(t, allowed) || !/\?$/.test(t) || (t.match(/\?/g) ?? []).length !== 1) return fallback.ask;
    live++;
    return t;
  })();

  const rejected: string[] = [];
  const changes: SelfReviewChange[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.changes)) {
    for (const c of r.changes.slice(0, 8)) {
      const reason = rejectChange(c, evidence);
      if (reason) {
        rejected.push(reason);
        continue;
      }
      const { action, routineId, cadence, why } = c as { action: SelfReviewChangeAction; routineId: string; cadence?: string; why: string };
      const key = `${action}:${routineId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cleanWhy = cleanProse(why, 2, 240);
      if (!cleanWhy || !numbersOk(cleanWhy, allowed)) {
        rejected.push(`${key}: why failed validation`);
        continue;
      }
      changes.push({ action, routineId, ...(action === "adjust_cadence" ? { cadence } : {}), why: cleanWhy });
      if (changes.length === 4) break;
    }
  }
  return { review: { worked, changing, ask, changes }, liveFields: live, rejected };
}

// ---------- deterministic copy ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deterministicSelfReview(evidence: SelfReviewEvidence): SelfReview {
  const t = evidence.totals;
  const worked =
    t.runsDone === 0
      ? `Quiet week — nothing completed across ${plural(t.routinesOn, "routine")} on. I have no result to claim.`
      : `I completed ${plural(t.runsDone, "run")} and handed over ${plural(t.drafts, "draft")}${t.approved || t.held ? `; you approved ${t.approved} and held ${t.held}` : ""}. ${evidence.outcomes.hit + evidence.outcomes.miss > 0 ? `${evidence.outcomes.hit} of ${evidence.outcomes.hit + evidence.outcomes.miss} measured KPI contracts hit their target.` : "No KPI contract has a measured actual yet."}`;

  const misses = evidence.routines.filter((r) => r.kpi && r.kpi.hit === false);
  const idle = evidence.routines.filter((r) => r.enabled && r.runsDone === 0 && r.runsFailed === 0);
  const changes: SelfReviewChange[] = [];
  for (const r of misses.slice(0, 2)) changes.push({ action: "reprioritise", routineId: r.id, why: `${r.kpi!.label} came in at ${r.kpi!.actual} against a target of ${r.kpi!.target} ${r.kpi!.unit}.`.replace(/\s+\./g, ".") });
  for (const r of idle.slice(0, 2 - Math.min(2, changes.length))) changes.push({ action: "reprioritise", routineId: r.id, why: `${r.name} is on but completed nothing this week — I am moving it up the queue.` });
  const changing =
    changes.length > 0
      ? `I am reprioritising ${changes.map((c) => NAME_BY_ID.get(c.routineId) ?? c.routineId).join(" and ")}: ${changes[0].why}`
      : evidence.taste.heldRoutines.length
        ? `You held ${plural(evidence.taste.heldRoutines.length, "proposal")} this week (${evidence.taste.heldRoutines.join(", ")}); I am changing nothing until I understand why.`
        : "Nothing is changing this week — the routines that ran did what they promised, so I am holding course.";

  const ask = evidence.taste.heldRoutines.length
    ? `You held ${evidence.taste.heldRoutines.join(", ")} this week — what would have made that proposal an easy yes?`
    : t.pending > 0
      ? `${plural(t.pending, "decision")} still waiting on you — is there one I should stop proposing?`
      : "Is there one routine you want me to run more, or less, next week?";
  return { worked, changing, ask, changes };
}

/** The stored plain-text body (Home renders it as three labelled paragraphs). */
export function composeBody(review: SelfReview): string {
  return `What worked\n${review.worked}\n\nWhat I'm changing\n${review.changing}\n\nOne ask\n${review.ask}`;
}

/** Split a stored body back into its three parts (for rendering; tolerant of older bodies). */
export function splitBody(body: string): { worked: string; changing: string; ask: string } {
  const grab = (label: string) => {
    const m = body.match(new RegExp(`${label}\\n([\\s\\S]*?)(?:\\n\\n|$)`));
    return m ? m[1].trim() : "";
  };
  const worked = grab("What worked");
  const changing = grab("What I'm changing");
  const ask = grab("One ask");
  return worked || changing || ask ? { worked, changing, ask } : { worked: body.trim(), changing: "", ask: "" };
}

// ---------- generate + store ----------

export interface SelfReviewLlm {
  /** accountId lets a shared client (the worker's router-backed one) honour per-account model settings. */
  complete(prompt: { system: string; user: string; accountId?: string }): Promise<string>;
}

export interface GenerateSelfReviewDeps {
  store: Store;
  accountId: string;
  now?: () => Date;
  /** null = deterministic review (no key / worker without a model). */
  llm?: SelfReviewLlm | null;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface GeneratedSelfReview {
  record: SelfReviewRecord;
  evidence: SelfReviewEvidence;
  liveFields: number;
  rejected: string[];
  author: "sonnet" | "deterministic";
}

export async function generateSelfReview(deps: GenerateSelfReviewDeps): Promise<GeneratedSelfReview> {
  const now = (deps.now ?? (() => new Date()))();
  const evidence = await gatherSelfReviewEvidence(deps.store, deps.accountId, now);
  let parsed: ParsedSelfReview = { review: deterministicSelfReview(evidence), liveFields: 0, rejected: [] };
  let author: GeneratedSelfReview["author"] = "deterministic";
  if (deps.llm) {
    try {
      const text = await deps.llm.complete({ system: SELF_REVIEW_SYSTEM, user: buildSelfReviewUserMessage(evidence), accountId: deps.accountId });
      const p = parseSelfReview(extractJsonObject(text), evidence);
      if (p.liveFields > 0) {
        parsed = p;
        author = "sonnet";
      }
    } catch (err) {
      deps.log?.("self_review.llm_failed", { accountId: deps.accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const record = await deps.store.putSelfReview({
    id: newId(),
    accountId: deps.accountId,
    weekStart: evidence.weekStart,
    body: composeBody(parsed.review),
    changes: parsed.review.changes,
    evidence: { ...evidence, ask: parsed.review.ask, author, liveFields: parsed.liveFields, rejectedChanges: parsed.rejected },
    createdAt: now.toISOString(),
  });
  deps.log?.("self_review.written", { accountId: deps.accountId, weekStart: record.weekStart, author, liveFields: parsed.liveFields, changes: record.changes.length, rejected: parsed.rejected.length });
  return { record, evidence, liveFields: parsed.liveFields, rejected: parsed.rejected, author };
}
