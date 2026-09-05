/* Artifact validation — the contract every produced artifact passes before it is stored.

     parseArtifactReply(text, spec)   strict parse of a model / n8n reply into an ArtifactDraft:
                                      a JSON object, the declared kind, a non-empty title and
                                      body, ≤ maxItems items of {title, body, meta?}, evidence
                                      lines, then the craft checks below
     allowedNumbersFrom(sources)      every number literal in the evidence/context material
                                      (+ counts 1–12, the current year) — the ONLY numbers the
                                      artifact may state (the narrative / self-review contract)
     findUnsupportedNumbers(text, allowed)
     findBannedPhrases(text)          the brand's forbidden phrases (chat-evals rubric)

   Pure and relative-import only (the worker build and the n8n callback route both use it). */

import { ARTIFACT_KINDS, type ArtifactDraft, type ArtifactEvidence, type ArtifactItem, type ArtifactKind } from "../runtime/types";

export const TITLE_MAX = 160;
export const BODY_MAX = 12_000;
export const ITEM_BODY_MAX = 4_000;
export const BODY_MIN = 40;
export const DEFAULT_MAX_ITEMS = 10;
export const EVIDENCE_MAX = 40;

/** Phrases the brand forbids (design-reference/README.md §Voice; mirrors the chat rubric). */
export const BANNED_PHRASES: readonly string[] = ["fully autonomous", "ai employee", "10x", "overnight success", "set and forget", "set-and-forget", "guarantee", "skyrocket", "game-changer", "game changer", "effortless", "crush it", "hustle", "unlock your potential", "revolutionary"];

export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);
}

// ---------- numbers ----------

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

function norm(raw: string): string {
  const s = raw.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/** Every number literal in a value (deep), normalised. */
export function numbersIn(value: unknown): Set<string> {
  const out = new Set<string>();
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  for (const m of text.matchAll(NUM_RE)) out.add(norm(m[0]));
  return out;
}

/** The numbers an artifact may state: everything in its evidence material, counts 0–12, the
    current year (and next — calendars name it), plus percentages a skill declares. */
export function allowedNumbersFrom(sources: unknown[], opts: { now?: Date; extra?: (string | number)[] } = {}): Set<string> {
  const allowed = new Set<string>();
  for (const s of sources) for (const n of numbersIn(s)) allowed.add(n);
  for (let i = 0; i <= 12; i++) allowed.add(String(i));
  const year = (opts.now ?? new Date()).getUTCFullYear();
  allowed.add(String(year));
  allowed.add(String(year + 1));
  // day-of-month / week numbers a calendar or a plan naturally carries
  for (let i = 13; i <= 31; i++) allowed.add(String(i));
  for (const e of opts.extra ?? []) allowed.add(norm(String(e)));
  return allowed;
}

/** Number literals in `text` that are not allowed. "60k" reads as 60000. Returned as written. */
export function findUnsupportedNumbers(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)(\s*[kK]\b)?/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    let value = norm(raw);
    if (m[2]) {
      const n = Number(value) * 1000;
      value = Number.isFinite(n) ? String(n) : value;
    }
    if (allowed.has(value)) continue;
    bad.push(m[2] ? `${raw}${m[2].trim()}` : raw);
  }
  return [...new Set(bad)];
}

export function findBannedPhrases(text: string): string[] {
  const low = text.toLowerCase();
  return BANNED_PHRASES.filter((p) => low.includes(p));
}

/** Everything a validator reads as prose: title, body, item titles and bodies. */
export function artifactText(a: Pick<ArtifactDraft, "title" | "body" | "items">): string {
  return [a.title, a.body, ...(a.items ?? []).flatMap((i) => [i.title, i.body])].join("\n");
}

// ---------- parse ----------

export interface ArtifactSpec {
  kind: ArtifactKind;
  maxItems?: number;
  /** null = skip the numbers check (n8n replies are trusted for numbers; the model's are not). */
  allowedNumbers?: Set<string> | null;
  /** Items required (a post_set with no posts is not a post set). Default: kinds that are lists. */
  requireItems?: boolean;
}

export type ParsedArtifact = { ok: true; artifact: ArtifactDraft } | { ok: false; reason: string };

const LIST_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>(["post_set", "hook_list", "keyword_list", "content_gap", "question_list", "calendar", "outreach_draft"]);

export function extractJsonObject(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1].trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(body.slice(a, b + 1));
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

function cleanItems(v: unknown, max: number): { items: ArtifactItem[]; reason?: string } {
  if (v === undefined || v === null) return { items: [] };
  if (!Array.isArray(v)) return { items: [], reason: "items is not an array" };
  if (v.length > max) return { items: [], reason: `${v.length} items, more than the ${max} allowed` };
  const items: ArtifactItem[] = [];
  for (const [i, raw] of v.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { items: [], reason: `items[${i}] is not an object` };
    const r = raw as { title?: unknown; body?: unknown; meta?: unknown };
    const title = str(r.title, TITLE_MAX);
    const body = str(r.body, ITEM_BODY_MAX);
    if (!title && !body) return { items: [], reason: `items[${i}] is empty` };
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : undefined;
    items.push({ title: title || `Item ${i + 1}`, body, ...(meta ? { meta } : {}) });
  }
  return { items };
}

function cleanEvidence(v: unknown): ArtifactEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: ArtifactEvidence[] = [];
  for (const raw of v.slice(0, EVIDENCE_MAX)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { source?: unknown; ref?: unknown };
    const source = str(r.source, 60);
    const ref = str(r.ref, 400);
    if (source && ref) out.push({ source, ref });
  }
  return out;
}

/** Validate an already-parsed object (the n8n route and the producer share it). */
export function validateArtifactObject(parsed: unknown, spec: ArtifactSpec): ParsedArtifact {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "reply is not a JSON object" };
  const o = parsed as { kind?: unknown; title?: unknown; body?: unknown; items?: unknown; meta?: unknown; evidence?: unknown };
  // A misspelled/provider-specific type is a contract failure, not permission to
  // relabel an unrelated payload as the routine's requested deliverable.
  if (!isArtifactKind(o.kind)) return { ok: false, reason: "kind missing or unsupported" };
  const kind = o.kind;
  if (kind !== spec.kind) return { ok: false, reason: `kind "${kind}" is not the expected "${spec.kind}"` };
  const title = str(o.title, TITLE_MAX);
  if (!title) return { ok: false, reason: "title missing" };
  const body = str(o.body, BODY_MAX);
  if (!body) return { ok: false, reason: "body missing" };
  const { items, reason } = cleanItems(o.items, spec.maxItems ?? DEFAULT_MAX_ITEMS);
  if (reason) return { ok: false, reason };
  const requireItems = spec.requireItems ?? LIST_KINDS.has(kind);
  if (requireItems && !items.length) return { ok: false, reason: `a ${kind} needs at least one item` };
  if (body.length < BODY_MIN && !items.length) return { ok: false, reason: `body is too short (${body.length} chars)` };
  const draft: ArtifactDraft = { kind, title, body, items, meta: o.meta && typeof o.meta === "object" && !Array.isArray(o.meta) ? (o.meta as Record<string, unknown>) : {}, evidence: cleanEvidence(o.evidence) };

  const text = artifactText(draft);
  const banned = findBannedPhrases(text);
  if (banned.length) return { ok: false, reason: `banned phrase${banned.length > 1 ? "s" : ""}: ${banned.join(", ")}` };
  if (spec.allowedNumbers) {
    const bad = findUnsupportedNumbers(text, spec.allowedNumbers);
    if (bad.length) return { ok: false, reason: `numbers not in the evidence: ${bad.slice(0, 5).join(", ")}` };
  }
  return { ok: true, artifact: draft };
}

/** Strict parse of a model reply. */
export function parseArtifactReply(text: string, spec: ArtifactSpec): ParsedArtifact {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty reply" };
  const parsed = extractJsonObject(text);
  if (parsed === null) return { ok: false, reason: "reply is not valid JSON" };
  return validateArtifactObject(parsed, spec);
}
