/* Client Brain — turning material into memories.

     extractMemories(db, input, opts)
       input.transcript  chat turns → the model proposes memories; ONLY founder turns count as
                         evidence, so anything Unc suggested (and the founder didn't say) fails
                         the traceability check and is dropped
       input.profile     a scan BusinessProfile → deterministic facts (no model call)
       input.review      a self-review → lessons (model when configured; else each change's
                         "why" becomes a lesson deterministically)
       input.approval    an approve/hold decision → one deterministic decision memory

   Model path: task "memory_extract" through the router (fast tier by default, JSON mode,
   2000 tokens). Every candidate passes `validateCandidate`: known kind, sane text, ISO date
   for events, and traceability — content-word overlap ≥ 0.5 with the source text, or an
   explicit `quote` that appears verbatim in it. No provider configured ⇒ the transcript path
   is a deterministic no-op (author "none"). Never throws past the caller's hook.

   Relative imports only (worker-buildable). */

import type { DbClient } from "../db/types";
import { complete as routerComplete, resolveModel } from "../llm/router";
import type { LlmMessage } from "../llm/types";
import { addMemory, contentWords, isMemoryKind, normaliseText, stem, type BrainOptions, type Memory, type MemoryKind, type MemorySource, type NewMemory } from "./memory";

export const EXTRACT_MAX_TOKENS = 2000;
export const EXTRACT_EFFORT = "low" as const;
export const EXTRACT_MAX_CANDIDATES = 12;
export const EXTRACT_MAX_SOURCE_CHARS = 12_000;
export const TRACE_OVERLAP_MIN = 0.5;
export const MIN_QUOTE_CHARS = 12;
const TEXT_MIN = 8;
const TEXT_MAX = 300;

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
}

/** The scan profile shape we read (src/lib/unc/scan.ts BusinessProfile, structurally). */
export interface ProfileLike {
  name?: string | null;
  oneLiner?: string | null;
  category?: string | null;
  products?: string[];
  audience?: string | null;
  voice?: { tone?: string | null; phrases?: string[] };
  market?: { region?: string | null; competitorsMentioned?: string[] };
  signals?: string[];
  confidence?: "low" | "medium" | "high";
  sources?: string[];
}

export interface ReviewLike {
  id?: string;
  weekStart?: string;
  body: string;
  changes?: { action: string; routineId: string; cadence?: string; why: string }[];
}

export interface ApprovalLike {
  id?: string;
  title: string;
  detail?: string | null;
  routineId?: string;
  routineName?: string;
  decision: "approved" | "held";
}

export interface ExtractInput {
  accountId: string;
  source: MemorySource;
  sourceRef?: string | null;
  transcript?: TranscriptTurn[];
  profile?: ProfileLike;
  review?: ReviewLike;
  approval?: ApprovalLike;
}

export interface ExtractLlm {
  /** Returns the raw model text, or null when no provider is configured. Throws on refusal/error. */
  complete(prompt: { system: string; user: string; accountId: string }): Promise<string | null>;
}

export interface ExtractOptions extends BrainOptions {
  /** undefined = the router; null = no model (deterministic paths only). */
  llm?: ExtractLlm | null;
}

export interface Candidate {
  kind: MemoryKind;
  text: string;
  confidence: number;
  importance: number;
  tags: string[];
  happens_at?: string;
  quote?: string;
}

export interface RejectedCandidate {
  text: string;
  reason: "not_object" | "bad_kind" | "bad_text" | "event_without_date" | "bad_date" | "untraceable";
}

export interface ExtractResult {
  author: "llm" | "deterministic" | "none";
  candidates: number;
  accepted: Memory[];
  merged: number;
  rejected: RejectedCandidate[];
}

// ---------- content words + traceability ----------

export { contentWords, stem };

/** Share of the candidate's content words that appear in the source. */
export function traceOverlap(candidateText: string, sourceText: string): number {
  const c = contentWords(candidateText);
  if (!c.length) return 0;
  const src = new Set(contentWords(sourceText));
  let hit = 0;
  for (const w of c) if (src.has(w)) hit++;
  return hit / c.length;
}

export function quoteInSource(quote: string | undefined, sourceText: string): boolean {
  if (!quote) return false;
  const q = normaliseText(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normaliseText(sourceText).includes(q);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  // Accept YYYY-MM-DD or a full ISO timestamp; reject prose ("next Friday").
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Validate one raw model item against the source text. */
export function validateCandidate(raw: unknown, sourceText: string): { ok: true; candidate: Candidate } | { ok: false; rejected: RejectedCandidate } {
  if (!raw || typeof raw !== "object") return { ok: false, rejected: { text: "", reason: "not_object" } };
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
  if (!isMemoryKind(r.kind)) return { ok: false, rejected: { text, reason: "bad_kind" } };
  if (text.length < TEXT_MIN || text.length > TEXT_MAX) return { ok: false, rejected: { text, reason: "bad_text" } };
  let happens_at: string | undefined;
  if (r.happens_at !== undefined && r.happens_at !== null && r.happens_at !== "") {
    const iso = isoDate(r.happens_at);
    if (!iso) return { ok: false, rejected: { text, reason: "bad_date" } };
    happens_at = iso;
  }
  if (r.kind === "event" && !happens_at) return { ok: false, rejected: { text, reason: "event_without_date" } };
  const quote = typeof r.quote === "string" ? r.quote : undefined;
  if (traceOverlap(text, sourceText) < TRACE_OVERLAP_MIN && !quoteInSource(quote, sourceText)) return { ok: false, rejected: { text, reason: "untraceable" } };
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? clamp(r.confidence, 0, 1) : 0.7;
  const importance = typeof r.importance === "number" && Number.isFinite(r.importance) ? clamp(Math.round(r.importance), 1, 5) : 3;
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string").slice(0, 5) : [];
  return { ok: true, candidate: { kind: r.kind, text, confidence, importance, tags, happens_at, quote } };
}

/** First JSON object/array in the text (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const first = s.search(/[[{]/);
  if (first < 0) return null;
  const closer = s[first] === "{" ? "}" : "]";
  const last = s.lastIndexOf(closer);
  if (last <= first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

export function candidatesFrom(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)) return (parsed as { memories: unknown[] }).memories;
  return [];
}

// ---------- prompts ----------

export const EXTRACT_SYSTEM = `You maintain the long-term memory of Unc, the marketing operator that works beside a founder. From the MATERIAL you extract durable memories about the FOUNDER and their business.

Output strict JSON only: {"memories":[{"kind":"…","text":"…","confidence":0.8,"importance":3,"tags":["…"],"happens_at":"YYYY-MM-DD","quote":"…"}]}

Rules (absolute):
- Record ONLY what the founder stated themselves, or what the material evidences as a done decision or a measured outcome. NEVER record the assistant's (Unc's) suggestions, proposals, plans, guesses or questions as facts — if the founder did not say it or explicitly agree to it, leave it out.
- kinds: fact (about the business or the founder) · preference (how they like things done) · constraint (a hard rule; phrase it as a durable rule, e.g. "Never discounts below 15%") · decision (something the founder decided) · relationship (people, partners, suppliers, agencies) · event (something dated; happens_at REQUIRED as an ISO date) · lesson (what worked or didn't, from reviews and outcomes).
- quote: the founder's exact words that support the memory, copied verbatim from the material.
- confidence 0–1 = how definite the founder was. importance 1–5 = how much this should shape future work (constraints and goals are 5).
- Write each text as a standalone sentence that will still make sense in six months. Keep numbers exactly as the founder gave them.
- tags: up to 5 short lowercase words.
- Nothing durable in the material → {"memories":[]}. At most ${EXTRACT_MAX_CANDIDATES} memories.`;

export function renderTranscript(turns: TranscriptTurn[]): { material: string; founderText: string } {
  const lines: string[] = [];
  const founder: string[] = [];
  for (const t of turns) {
    const text = (t.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`${t.role === "user" ? "FOUNDER" : "UNC (assistant)"}: ${text}`);
    if (t.role === "user") founder.push(text);
  }
  return { material: lines.join("\n").slice(0, EXTRACT_MAX_SOURCE_CHARS), founderText: founder.join("\n").slice(0, EXTRACT_MAX_SOURCE_CHARS) };
}

export function renderReview(review: ReviewLike): string {
  const parts = [review.body.trim()];
  for (const c of review.changes ?? []) parts.push(`Change: ${c.action} ${c.routineId}${c.cadence ? ` (${c.cadence})` : ""} — ${c.why}`);
  return parts.join("\n").slice(0, EXTRACT_MAX_SOURCE_CHARS);
}

export function buildExtractUserMessage(source: MemorySource, material: string, now: Date): string {
  return `SOURCE: ${source}\nTODAY: ${now.toISOString().slice(0, 10)} (resolve relative dates against this)\n\nMATERIAL:\n${material}`;
}

// ---------- deterministic builders ----------

const conf = (c: ProfileLike["confidence"]) => (c === "high" ? 0.85 : c === "medium" ? 0.7 : 0.5);

/** Facts a scan profile states about the business. Nothing invented: empty fields yield nothing. */
export function profileMemories(accountId: string, p: ProfileLike, sourceRef: string | null): NewMemory[] {
  const c = conf(p.confidence);
  const base = { accountId, source: "scan" as const, sourceRef, confidence: c };
  const out: NewMemory[] = [];
  const name = p.name?.trim();
  if (name && p.oneLiner?.trim()) out.push({ ...base, kind: "fact", text: `${name}: ${p.oneLiner.trim()}`, importance: 4, tags: ["business"] });
  else if (name) out.push({ ...base, kind: "fact", text: `The business is called ${name}.`, importance: 4, tags: ["business"] });
  if (p.category?.trim()) out.push({ ...base, kind: "fact", text: `Business category: ${p.category.trim()}.`, importance: 3, tags: ["business"] });
  const products = (p.products ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (products.length) out.push({ ...base, kind: "fact", text: `Products on the site: ${products.join(", ")}.`, importance: 4, tags: ["products"] });
  if (p.audience?.trim()) out.push({ ...base, kind: "fact", text: `Audience the site speaks to: ${p.audience.trim()}.`, importance: 4, tags: ["audience"] });
  const tone = p.voice?.tone?.trim();
  const phrases = (p.voice?.phrases ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (tone || phrases.length) out.push({ ...base, kind: "preference", text: `Brand voice: ${tone ? tone : "as on the site"}${phrases.length ? `; phrases they use: ${phrases.map((s) => `"${s}"`).join(", ")}` : ""}.`, importance: 4, tags: ["voice"] });
  if (p.market?.region?.trim()) out.push({ ...base, kind: "fact", text: `Primary market region: ${p.market.region.trim()}.`, importance: 3, tags: ["market"] });
  const comps = (p.market?.competitorsMentioned ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (comps.length) out.push({ ...base, kind: "relationship", text: `Competitors the site mentions: ${comps.join(", ")}.`, importance: 2, tags: ["competitors"] });
  const signals = (p.signals ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (signals.length) out.push({ ...base, kind: "fact", text: `Signals on the site: ${signals.join("; ")}.`, importance: 2, tags: ["signals"] });
  return out;
}

/** One decision memory per approve/hold. Holds matter more (they are taste). */
export function approvalMemory(accountId: string, a: ApprovalLike, sourceRef: string | null): NewMemory {
  const routine = a.routineName ?? a.routineId ?? "a routine";
  const detail = (a.detail ?? "").replace(/\s+/g, " ").trim();
  const verb = a.decision === "approved" ? "Approved" : "Held";
  const text = `${verb}: "${a.title.trim()}" (${routine})${detail ? ` — ${detail.slice(0, 160)}` : ""}`;
  return { accountId, kind: "decision", text, source: "receipt", sourceRef, confidence: 0.95, importance: a.decision === "held" ? 4 : 3, tags: ["approval", a.decision, ...(a.routineId ? [a.routineId.toLowerCase()] : [])] };
}

/** Without a model, each review change carries its own reason — that IS the lesson. */
export function reviewChangeLessons(accountId: string, review: ReviewLike, sourceRef: string | null): NewMemory[] {
  return (review.changes ?? [])
    .filter((c) => c.why?.trim())
    .map((c) => ({ accountId, kind: "lesson" as const, text: `${c.action} ${c.routineId}${c.cadence ? ` (${c.cadence})` : ""}: ${c.why.trim()}`, source: "self_review" as const, sourceRef, confidence: 0.8, importance: 3, tags: ["self-review", c.action] }));
}

// ---------- the router-backed model ----------

export function routerExtractLlm(db: DbClient | null, opts: { jsonMode?: boolean; maxTokens?: number } = {}): ExtractLlm {
  return {
    async complete({ system, user, accountId }) {
      if (!resolveModel("memory_extract")) return null;
      const messages: LlmMessage[] = [{ role: "user", content: user }];
      const r = await routerComplete("memory_extract", { system, messages, maxTokens: opts.maxTokens ?? EXTRACT_MAX_TOKENS, effort: EXTRACT_EFFORT, jsonMode: opts.jsonMode ?? true }, { accountId, db });
      if (!r) return null;
      if (r.stopReason === "refusal") throw new Error("refusal");
      if (r.stopReason === "error") throw new Error(`llm ${r.errorCode ?? "error"}`);
      return r.text;
    },
  };
}

// ---------- main ----------

async function persist(db: DbClient, items: NewMemory[], opts: BrainOptions, result: ExtractResult): Promise<void> {
  for (const m of items) {
    try {
      const r = await addMemory(db, m, opts);
      result.accepted.push(r.memory);
      if (r.merged) result.merged++;
    } catch (err) {
      opts.log?.("brain.memory_write_failed", { accountId: m.accountId, kind: m.kind, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function extractMemories(db: DbClient, input: ExtractInput, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const now = (opts.now ?? (() => new Date()))();
  const result: ExtractResult = { author: "none", candidates: 0, accepted: [], merged: 0, rejected: [] };
  const sourceRef = input.sourceRef ?? null;

  // Structured inputs → deterministic memories (no model, nothing to validate).
  if (input.approval) {
    result.author = "deterministic";
    result.candidates = 1;
    await persist(db, [approvalMemory(input.accountId, input.approval, sourceRef)], opts, result);
    return result;
  }
  if (input.profile) {
    const items = profileMemories(input.accountId, input.profile, sourceRef);
    result.author = "deterministic";
    result.candidates = items.length;
    await persist(db, items, opts, result);
    return result;
  }

  // Free text → the model, validated against the evidence.
  let material = "";
  let evidence = "";
  if (input.transcript) {
    const t = renderTranscript(input.transcript);
    material = t.material;
    evidence = t.founderText;
  } else if (input.review) {
    material = renderReview(input.review);
    evidence = material;
  }
  if (!evidence.trim()) return result;

  const llm = opts.llm === undefined ? routerExtractLlm(db) : opts.llm;
  let raw: string | null = null;
  if (llm) {
    try {
      raw = await llm.complete({ system: EXTRACT_SYSTEM, user: buildExtractUserMessage(input.source, material, now), accountId: input.accountId });
    } catch (err) {
      opts.log?.("brain.extract_llm_failed", { accountId: input.accountId, source: input.source, error: err instanceof Error ? err.message : String(err) });
      raw = null;
    }
  }

  if (raw === null) {
    // No model (or it failed): reviews still yield their deterministic lessons; transcripts are a no-op.
    if (input.review) {
      const items = reviewChangeLessons(input.accountId, input.review, sourceRef);
      if (items.length) {
        result.author = "deterministic";
        result.candidates = items.length;
        await persist(db, items, opts, result);
      }
    }
    return result;
  }

  result.author = "llm";
  const items = candidatesFrom(extractJson(raw)).slice(0, EXTRACT_MAX_CANDIDATES);
  result.candidates = items.length;
  const accepted: NewMemory[] = [];
  for (const item of items) {
    const v = validateCandidate(item, evidence);
    if (!v.ok) {
      result.rejected.push(v.rejected);
      continue;
    }
    const c = v.candidate;
    accepted.push({ accountId: input.accountId, kind: c.kind, text: c.text, source: input.source, sourceRef, confidence: c.confidence, importance: c.importance, tags: c.tags, happensAt: c.happens_at ?? null });
  }
  await persist(db, accepted, opts, result);
  return result;
}
