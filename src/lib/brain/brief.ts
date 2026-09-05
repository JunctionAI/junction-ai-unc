/* Unc's daily brief — "Morning. Here's today:" — one row per account per local day.

   gatherBriefEvidence({ store, db, accountId, now, timezone })
     last-24h receipts, pending approvals, KPI deltas (kpi.ts), upcoming memories of kind
     'event' (next 7 days, read straight from `memories`), yesterday's brief. The ONLY source
     of numbers the brief may use.
   parseBrief(raw, evidence)          validates the model output — body ≤ 90 words in Unc's
     voice with no invented number; ≤ 5 items of kind happened | needs_you | noticed |
     reminder whose `ref` must point at something in the evidence; exactly one "noticed" when
     a notable delta exists (none when there is none); needs_you only for a real pending
     approval. Anything that fails falls back to the deterministic item / body.
   deterministicBrief(evidence)       the copy used without a model or on refusal.
   generateDailyBrief({ store, db, accountId, now, llm, timezone, force })
     idempotent per (account, local day): an existing row is returned untouched unless
     `force`. Demo mode (no db) never gets here — callers gate on the database.

   Timezone helpers (localDay, briefSlotUtc, isValidTimezone) are pure over Intl so the
   worker's account-local scheduling is testable on a fake clock.

   Relative imports only (worker build). The numbers-only validator is the same approach
   as src/lib/unc/narrative.ts allowedNumbers / numbersOk, copied — not imported across
   ownership. */

import { unwrap, type DbClient } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { runtimeGeneration } from "../runtime/contextFence";
import type { Store } from "../runtime/store/interface";
import type { ApprovalRecord, Receipt } from "../runtime/types";
import { describeDelta, kpiDeltas, type KpiDelta } from "./kpi";

// ---------- shapes ----------

export type BriefItemKind = "happened" | "needs_you" | "noticed" | "reminder";
export const BRIEF_ITEM_KINDS: BriefItemKind[] = ["happened", "needs_you", "noticed", "reminder"];

export interface BriefItem {
  kind: BriefItemKind;
  text: string;
  /** approval id (needs_you), memory id (reminder), metric key (noticed), receipt id (happened) — or null. */
  ref: string | null;
  /** reminder only: when it happens (ISO). */
  at?: string;
}

export interface DailyBrief {
  day: string;
  body: string;
  items: BriefItem[];
}

export interface DailyBriefRecord extends DailyBrief {
  id: string;
  accountId: string;
  contextGeneration: number;
  createdAt: string;
}

export interface BriefEvidence {
  /** Local calendar day (YYYY-MM-DD) in the account's timezone. */
  day: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  receipts: { total: number; drafts: number; reads: number; mutations: number; notifications: number; runsDone: number; lines: { id: string; kind: string; text: string }[] };
  pending: { id: string; routineId: string; title: string; expiresAt: string }[];
  deltas: KpiDelta[];
  events: { id: string; text: string; happensAt: string }[];
  yesterday: { body: string; items: BriefItem[] } | null;
}

export const BRIEF_MAX_ITEMS = 5;
export const BRIEF_MAX_WORDS = 90;
export const BRIEF_MAX_TOKENS = 4000;
export const BRIEF_EFFORT = "low" as const;

const DAY_MS = 86_400_000;

// ---------- timezone helpers ----------

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function localParts(now: Date, tz: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

/** YYYY-MM-DD in the timezone (UTC when the zone is unknown). */
export function localDay(now: Date, tz: string | null | undefined): string {
  const zone = isValidTimezone(tz) ? tz : "UTC";
  const p = localParts(now, zone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The UTC instant of hh:mm local on `now`'s local day. DST transitions inside the day shift
    it by at most an hour, which the look-back absorbs. */
export function briefSlotUtc(now: Date, tz: string | null | undefined, hour = 6, minute = 30): Date {
  const zone = isValidTimezone(tz) ? tz : "UTC";
  const p = localParts(now, zone);
  const localAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, hour, minute) - offsetMs);
}

export function previousDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
}

/** account_profiles.cadence.timezone when it is a real zone, else null (→ UTC). */
export async function readTimezone(db: DbClient, accountId: string): Promise<string | null> {
  const row = await unwrap<{ cadence: unknown } | null>("account_profiles.select", db.from("account_profiles").select("cadence").eq("account_id", accountId).maybeSingle());
  const tz = row && row.cadence && typeof row.cadence === "object" ? (row.cadence as { timezone?: unknown }).timezone : null;
  return isValidTimezone(tz) ? tz : null;
}

// ---------- evidence ----------

export interface GatherDeps {
  store: Store;
  db: DbClient;
  accountId: string;
  contextGeneration?: number;
  now: Date;
  timezone: string | null;
}

const shortText = (s: string, max = 140) => s.replace(/\s+/g, " ").trim().slice(0, max);

export async function gatherBriefEvidence(deps: GatherDeps): Promise<BriefEvidence> {
  const { store, db, accountId, now } = deps;
  const contextGeneration = runtimeGeneration(deps.contextGeneration);
  const context = Object.freeze({ accountId, contextGeneration });
  await assertRuntimeContext(db, context);
  const tz = deps.timezone ?? "UTC";
  const day = localDay(now, tz);
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - DAY_MS).toISOString();
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS).toISOString();

  const [receipts, pending, runs, deltas, eventRows, yRow] = await Promise.all([
    store.listReceipts(accountId, { since: windowStart, limit: 200, contextGeneration }),
    store.listApprovals(accountId, "pending", contextGeneration),
    store.listRuns(accountId, { since: windowStart, status: "done", contextGeneration }),
    kpiDeltas(db, accountId, now, contextGeneration),
    unwrap<{ id: string; text: string; happens_at: string }[]>(
      "memories.select",
      db.from("memories").select("id, text, happens_at").eq("account_id", accountId).eq("context_generation", contextGeneration).eq("kind", "event").is("valid_to", null).gte("happens_at", windowEnd).lte("happens_at", weekAhead).order("happens_at", { ascending: true }).limit(10),
    ),
    unwrap<{ body: string; items: unknown } | null>("daily_briefs.select", db.from("daily_briefs").select("body, items").eq("account_id", accountId).eq("context_generation", contextGeneration).eq("day", previousDay(day)).maybeSingle()),
  ]);
  await assertRuntimeContext(db, context);

  const count = (k: Receipt["kind"]) => receipts.filter((r) => r.kind === k).length;
  const lines = receipts
    .filter((r) => r.kind !== "read")
    .slice(0, 8)
    .map((r) => ({ id: r.id, kind: r.kind, text: shortText(r.description) }));
  const live = (a: ApprovalRecord) => a.expiresAt >= windowEnd;
  return {
    day,
    timezone: tz,
    windowStart,
    windowEnd,
    receipts: { total: receipts.length, drafts: count("draft"), reads: count("read"), mutations: count("mutation"), notifications: count("notification"), runsDone: runs.length, lines },
    pending: pending.filter(live).map((a) => ({ id: a.id, routineId: a.routineId, title: shortText(a.title, 120), expiresAt: a.expiresAt })),
    deltas,
    events: eventRows.map((e) => ({ id: e.id, text: shortText(e.text, 160), happensAt: e.happens_at })),
    yesterday: yRow ? { body: yRow.body, items: Array.isArray(yRow.items) ? (yRow.items as BriefItem[]) : [] } : null,
  };
}

// ---------- prompt ----------

export const BRIEF_SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner." You are writing the founder's morning brief: what happened while they were away, what needs them, one thing you noticed in the numbers, and any reminder coming up.

Voice (non-negotiable): first person, present tense, numbers over adjectives. Warm, direct, concrete. No hype, no exclamation marks, no emojis, no markdown, no greeting (the app already says "Morning. Here's today:").
Concision: the most important thing first — a decision waiting on the founder beats a thing that happened; one idea per sentence; never announce what you are "about to" do or "will be" doing — say what ran and what waits. No filler — never "great", "quick note", "it's worth noting", "in other words", "absolutely", "as you know", "just to flag". If a sentence carries neither a number from the evidence nor a decision, cut it.
Judgement: the "noticed" item says what the number means for the goal and what you'd do about it, in one clause — a delta with no take is a readout, not a notice.

You are given EVIDENCE — the last 24 hours of your own receipts, the approvals still waiting on the founder, this account's KPI snapshots week-over-week, upcoming events you were told about, and yesterday's brief. It is the ONLY source of numbers you may use.

Write strict JSON only:
{"body": string, "items": [{"kind": "happened"|"needs_you"|"noticed"|"reminder", "text": string, "ref": string|null}]}

- body: ≤ 90 words, 1–3 sentences. The day in one breath. If nothing ran, say so plainly.
- items: at most 5, each ≤ 25 words.
  - happened: something from the receipts (ref = the receipt id, or null).
  - needs_you: ONLY a pending approval from the evidence (ref = its id). One per approval, never invented.
  - noticed: EXACTLY ONE when the evidence has a delta marked notable — cite that metric with its numbers (ref = its key). When no delta is notable, write no noticed item at all.
  - reminder: an upcoming event from the evidence (ref = its id), with when it happens.
- Do not repeat yesterday's brief word for word; if the situation is the same, say it is the same.

Hard rules:
- The ONLY numbers you may write are numbers that appear in the evidence — no arithmetic that produces a new number, no estimates.
- Never claim anything sent, published or spent — you draft and propose; the founder approves. A "dry run" or "draft" receipt is a draft, not an action taken.
- Output the JSON object and nothing else.`;

export function buildBriefUserMessage(evidence: BriefEvidence): string {
  const { yesterday, ...rest } = evidence;
  return ["EVIDENCE (last 24 h; the only source of numbers)", JSON.stringify(rest), "", "YESTERDAY'S BRIEF (do not repeat it verbatim)", JSON.stringify(yesterday), "", "Write the JSON now."].join("\n");
}

// ---------- validation ----------

/* Numbers-only guard — the same approach as src/lib/unc/narrative.ts (allowedNumbers /
   numbersOk), copied so the worker build never imports the Next-side unc modules. */
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (t: string) => t.replace(/,/g, "");

export function allowedNumbers(evidence: BriefEvidence): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i <= 12; i++) set.add(String(i));
  const { yesterday, ...rest } = evidence;
  void yesterday; // yesterday's numbers are not evidence for today
  for (const m of JSON.stringify(rest).match(NUM_RE) ?? []) set.add(normNum(m));
  // dates in the evidence may be written as day/month pieces ("the 9th", "Sep 9")
  for (const iso of [...evidence.events.map((e) => e.happensAt), ...evidence.pending.map((p) => p.expiresAt), evidence.day]) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    set.add(String(d.getUTCDate()));
    set.add(String(d.getUTCMonth() + 1));
    set.add(String(d.getUTCFullYear()));
    set.add(String(d.getUTCHours()));
    set.add(String(d.getUTCHours() % 12 || 12));
  }
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

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

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

export interface ParsedBrief {
  brief: DailyBrief;
  /** True when the body came from the model. */
  liveBody: boolean;
  /** Items that came from the model (after validation). */
  liveItems: number;
  rejected: string[];
}

/** Validate field by field; anything that fails falls back to the deterministic copy. */
export function parseBrief(raw: unknown, evidence: BriefEvidence): ParsedBrief {
  const fallback = deterministicBrief(evidence);
  if (!raw || typeof raw !== "object") return { brief: fallback, liveBody: false, liveItems: 0, rejected: ["not an object"] };
  const r = raw as Record<string, unknown>;
  const allowed = allowedNumbers(evidence);
  const rejected: string[] = [];

  let liveBody = false;
  let body = fallback.body;
  const b = cleanProse(r.body, 3, 700);
  if (!b) rejected.push("body: empty or formatted");
  else if (wordCount(b) > BRIEF_MAX_WORDS) rejected.push(`body: ${wordCount(b)} words`);
  else if (!numbersOk(b, allowed)) rejected.push("body: number not in the evidence");
  else {
    body = b;
    liveBody = true;
  }

  const pendingIds = new Set(evidence.pending.map((p) => p.id));
  const eventById = new Map(evidence.events.map((e) => [e.id, e]));
  const receiptIds = new Set(evidence.receipts.lines.map((l) => l.id));
  const notable = evidence.deltas.filter((d) => d.notable);
  const notableKeys = new Set<string>(notable.map((d) => d.key));

  const items: BriefItem[] = [];
  const seenRefs = new Set<string>();
  let noticedSeen = false;
  if (Array.isArray(r.items)) {
    for (const it of r.items.slice(0, 12)) {
      if (!it || typeof it !== "object") continue;
      const { kind, text, ref } = it as Record<string, unknown>;
      if (typeof kind !== "string" || !BRIEF_ITEM_KINDS.includes(kind as BriefItemKind)) {
        rejected.push(`item: unknown kind "${String(kind)}"`);
        continue;
      }
      const t = cleanProse(text, 2, 220);
      if (!t || wordCount(t) > 25 || !numbersOk(t, allowed)) {
        rejected.push(`${kind}: text failed validation`);
        continue;
      }
      const refStr = typeof ref === "string" && ref.trim() ? ref.trim() : null;
      const k = kind as BriefItemKind;
      if (k === "needs_you") {
        if (!refStr || !pendingIds.has(refStr)) {
          rejected.push("needs_you: not a pending approval");
          continue;
        }
      } else if (k === "noticed") {
        if (!notable.length) {
          rejected.push("noticed: no notable delta in the evidence");
          continue;
        }
        if (refStr && !notableKeys.has(refStr)) {
          rejected.push(`noticed: "${refStr}" is not a notable metric`);
          continue;
        }
        if (noticedSeen) {
          rejected.push("noticed: more than one");
          continue;
        }
        noticedSeen = true;
      } else if (k === "reminder") {
        if (!refStr || !eventById.has(refStr)) {
          rejected.push("reminder: not an upcoming event");
          continue;
        }
      } else if (refStr && !receiptIds.has(refStr)) {
        rejected.push(`happened: "${refStr}" is not a receipt`);
        continue;
      }
      if (refStr && seenRefs.has(`${k}:${refStr}`)) continue;
      if (refStr) seenRefs.add(`${k}:${refStr}`);
      const item: BriefItem = { kind: k, text: t, ref: k === "noticed" ? (refStr ?? notable[0].key) : refStr };
      if (k === "reminder") item.at = eventById.get(refStr!)!.happensAt;
      items.push(item);
    }
  }
  const liveItems = items.length;
  // exactly one "noticed" whenever a notable delta exists
  if (notable.length && !noticedSeen) items.push(fallback.items.find((i) => i.kind === "noticed")!);
  // trim to the cap, keeping the noticed item and needs_you items first
  const ordered = [...items.filter((i) => i.kind === "needs_you"), ...items.filter((i) => i.kind === "noticed"), ...items.filter((i) => i.kind === "reminder"), ...items.filter((i) => i.kind === "happened")];
  const trimmed = ordered.slice(0, BRIEF_MAX_ITEMS);
  if (ordered.length > BRIEF_MAX_ITEMS) rejected.push(`items: ${ordered.length - BRIEF_MAX_ITEMS} trimmed`);
  return { brief: { day: evidence.day, body, items: liveItems ? trimmed : fallback.items }, liveBody, liveItems: liveItems ? Math.min(liveItems, BRIEF_MAX_ITEMS) : 0, rejected };
}

// ---------- deterministic copy ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function whenLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const zone = isValidTimezone(tz) ? tz : "UTC";
  return new Intl.DateTimeFormat("en-NZ", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(d);
}

export function deterministicBrief(evidence: BriefEvidence): DailyBrief {
  const r = evidence.receipts;
  const items: BriefItem[] = [];
  for (const p of evidence.pending.slice(0, 3)) items.push({ kind: "needs_you", text: `${p.title} — waiting on your okay.`, ref: p.id });
  const notable = evidence.deltas.filter((d) => d.notable).sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  if (notable.length) items.push({ kind: "noticed", text: `${describeDelta(notable[0])}.`, ref: notable[0].key });
  for (const e of evidence.events.slice(0, 2)) items.push({ kind: "reminder", text: `${e.text} — ${whenLabel(e.happensAt, evidence.timezone)}.`, ref: e.id, at: e.happensAt });
  if (r.runsDone || r.drafts) items.push({ kind: "happened", text: `I completed ${plural(r.runsDone, "run")} and left ${plural(r.drafts, "draft")} for you.`, ref: r.lines[0]?.id ?? null });
  const body =
    r.total === 0 && !evidence.pending.length
      ? "Quiet night — nothing ran and nothing is waiting on you. I have no new numbers to claim."
      : `Overnight I completed ${plural(r.runsDone, "run")} and wrote ${plural(r.drafts, "draft")}${evidence.pending.length ? `; ${plural(evidence.pending.length, "decision")} ${evidence.pending.length === 1 ? "is" : "are"} waiting on you` : "; nothing is waiting on you"}.${notable.length ? ` ${describeDelta(notable[0])}.` : ""}`;
  return { day: evidence.day, body, items: items.slice(0, BRIEF_MAX_ITEMS) };
}

// ---------- generate + store ----------

export interface BriefLlm {
  complete(prompt: { system: string; user: string; accountId?: string }): Promise<string>;
}

export interface GenerateBriefDeps {
  store: Store;
  db: DbClient;
  accountId: string;
  /** Captured before resolving the job/request inputs. Omission is generation zero only. */
  contextGeneration?: number;
  now?: () => Date;
  /** null = deterministic brief. */
  llm?: BriefLlm | null;
  /** Default: account_profiles.cadence.timezone, else UTC. */
  timezone?: string | null;
  /** Regenerate even when today's row exists. */
  force?: boolean;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface GeneratedBrief {
  record: DailyBriefRecord;
  /** True when today's row already existed and was returned untouched. */
  existed: boolean;
  author: "model" | "deterministic";
  liveItems: number;
  rejected: string[];
  evidence: BriefEvidence | null;
}

type BriefRow = { id: string; account_id: string; context_generation: number; day: string; body: string; items: unknown; created_at: string };

function rowToRecord(row: BriefRow): DailyBriefRecord {
  return { id: row.id, accountId: row.account_id, contextGeneration: runtimeGeneration(row.context_generation), day: row.day, body: row.body, items: Array.isArray(row.items) ? (row.items as BriefItem[]) : [], createdAt: row.created_at };
}

export async function getDailyBrief(db: DbClient, accountId: string, day: string, contextGeneration = 0): Promise<DailyBriefRecord | null> {
  const context = Object.freeze({ accountId, contextGeneration: runtimeGeneration(contextGeneration) });
  await assertRuntimeContext(db, context, { allowPaused: true });
  const row = await unwrap<BriefRow | null>(
    "daily_briefs.select",
    db.from("daily_briefs").select("id, account_id, context_generation, day, body, items, created_at").eq("account_id", accountId).eq("context_generation", contextGeneration).eq("day", day).maybeSingle(),
  );
  await assertRuntimeContext(db, context, { allowPaused: true });
  return row ? rowToRecord(row) : null;
}

export async function generateDailyBrief(deps: GenerateBriefDeps): Promise<GeneratedBrief> {
  const context = Object.freeze({ accountId: deps.accountId, contextGeneration: runtimeGeneration(deps.contextGeneration) });
  const { accountId, contextGeneration } = context;
  const guard = () => assertRuntimeContext(deps.db, context);
  await guard();
  const now = (deps.now ?? (() => new Date()))();
  const timezone = deps.timezone === undefined ? await readTimezone(deps.db, accountId) : deps.timezone;
  const day = localDay(now, timezone);
  if (!deps.force) {
    const existing = await getDailyBrief(deps.db, accountId, day, contextGeneration);
    await guard();
    if (existing) return { record: existing, existed: true, author: "deterministic", liveItems: 0, rejected: [], evidence: null };
  }
  const evidence = await gatherBriefEvidence({ store: deps.store, db: deps.db, accountId, contextGeneration, now, timezone });
  let parsed: ParsedBrief = { brief: deterministicBrief(evidence), liveBody: false, liveItems: 0, rejected: [] };
  let author: GeneratedBrief["author"] = "deterministic";
  if (deps.llm) {
    await guard();
    try {
      const text = await deps.llm.complete({ system: BRIEF_SYSTEM, user: buildBriefUserMessage(evidence), accountId });
      const p = parseBrief(extractJsonObject(text), evidence);
      if (p.liveBody || p.liveItems > 0) {
        parsed = p;
        author = "model";
      } else parsed.rejected = p.rejected;
    } catch (err) {
      deps.log?.("brief.llm_failed", { accountId: deps.accountId, error: err instanceof Error ? err.name : "unknown" });
    }
  }
  // Also runs after a failed LLM call: stale work cannot take the deterministic fallback.
  await guard();
  const row = await unwrap<BriefRow>(
    "daily_briefs.upsert",
    deps.db
      .from("daily_briefs")
      .upsert({ account_id: accountId, context_generation: contextGeneration, day, body: parsed.brief.body, items: parsed.brief.items, created_at: now.toISOString() }, { onConflict: "account_id,context_generation,day" })
      .select("id, account_id, context_generation, day, body, items, created_at")
      .single(),
  );
  await guard();
  deps.log?.("brief.written", { accountId: deps.accountId, day, author, liveItems: parsed.liveItems, items: parsed.brief.items.length, rejected: parsed.rejected.length });
  return { record: rowToRecord(row), existed: false, author, liveItems: parsed.liveItems, rejected: parsed.rejected, evidence };
}
