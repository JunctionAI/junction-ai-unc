/* Client Brain — the moments Unc learns. Every hook is fire-and-forget safe: it resolves the
   service-role client itself (demo mode ⇒ no client ⇒ no-op), never throws, and returns what
   it did so tests and callers can see it.

     afterChatReply({ accountId, surface, history, reply })   extract from the last turns (skipped
                                                            when the founder's message is under
                                                            40 chars) + rolling thread summaries
     afterScan({ accountId, profile, sourceRef })             facts from a scan profile
     afterSelfReview(review)                                  lessons from the weekly self-review
                                                            (the worker / self-review route call this)
     afterApprovalDecision(approval, decision, { store })     one decision memory + decision-style refresh
     afterOnboarding({ accountId, answers })                  the onboarding answers as memories

   Relative imports only (worker-buildable; ../db/server is the same seam the router uses). */

import { asDb } from "../db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../db/server";
import type { DbClient } from "../db/types";
import { ALL_SYSTEMS } from "../platform/catalog";
import { extractMemories, renderTranscript, routerExtractLlm, traceOverlap, type ExtractLlm, type ExtractOptions, type ExtractResult, type ProfileLike, type TranscriptTurn } from "./extract";
import { addMemory, findBySourceRef, type BrainOptions } from "./memory";
import { onboardingMemories, persistOnboarding, type OnboardingAnswers } from "./onboarding";
import { refreshDecisionStyle, type DecisionSource, type DecisionStyle } from "./profile";

export const CHAT_EXTRACT_MIN_CHARS = 40;
export const CHAT_SUMMARY_THRESHOLD = 24;
export const CHAT_SUMMARY_BLOCK = 12;
export const CHAT_SUMMARY_MAX_CHARS = 500;
export const SUMMARY_MAX_TOKENS = 600;

type Log = (event: string, fields: Record<string, unknown>) => void;
const defaultLog: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

let dbResolver: () => DbClient | null = () => {
  try {
    return isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  } catch {
    return null;
  }
};
/** Tests point the hooks at a FakeSupabase; pass undefined to restore. */
export function setBrainDbForTests(f: (() => DbClient | null) | undefined): void {
  dbResolver = f ?? (() => (isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null));
}

export interface HookOptions extends ExtractOptions {
  /** undefined = the service role when configured; null = none (no-op). */
  db?: DbClient | null;
}

function resolveDb(opts: HookOptions): DbClient | null {
  return opts.db === undefined ? dbResolver() : opts.db;
}

/** FNV-1a, hex — a stable key for "this exact block of turns". */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------- chat ----------

export interface ChatHookInput {
  accountId: string;
  surface: "corner" | "onboarding";
  /** The full sanitised thread the client sent (oldest first, ends with the founder's message). */
  history: TranscriptTurn[];
  /** Unc's live reply to that last message. */
  reply: string;
}

export interface ChatHookResult {
  extracted: ExtractResult | null;
  /** Why extraction was skipped, when it was. */
  skipped?: "no_db" | "short_message";
  summariesWritten: number;
}

export const SUMMARY_SYSTEM = `You keep Unc's memory of a founder's chat. Summarise the CONVERSATION below in at most ${CHAT_SUMMARY_MAX_CHARS} characters of plain text: what the founder said, asked, decided or ruled out, with any numbers exactly as they gave them. Do not present the assistant's suggestions as the founder's decisions. No preamble, no markdown.`;

export function deterministicSummary(turns: TranscriptTurn[]): string {
  const founder = turns.filter((t) => t.role === "user").map((t) => t.content.replace(/\s+/g, " ").trim().slice(0, 140));
  if (!founder.length) return "";
  return `Earlier in this thread the founder said: ${founder.join(" · ")}`.slice(0, CHAT_SUMMARY_MAX_CHARS);
}

/** Blocks of 12 turns that a >24-turn thread has (or is about to) push out of the model's window. */
export function summaryBlocks(turns: TranscriptTurn[]): { index: number; turns: TranscriptTurn[] }[] {
  const n = turns.length;
  if (n <= CHAT_SUMMARY_THRESHOLD) return [];
  const count = Math.floor((n - CHAT_SUMMARY_THRESHOLD) / CHAT_SUMMARY_BLOCK) + 1;
  const out: { index: number; turns: TranscriptTurn[] }[] = [];
  for (let b = 0; b < count; b++) {
    const slice = turns.slice(b * CHAT_SUMMARY_BLOCK, (b + 1) * CHAT_SUMMARY_BLOCK);
    if (slice.length === CHAT_SUMMARY_BLOCK) out.push({ index: b, turns: slice });
  }
  return out;
}

export async function rollingSummaries(db: DbClient, accountId: string, surface: ChatHookInput["surface"], turns: TranscriptTurn[], opts: HookOptions = {}): Promise<number> {
  let written = 0;
  const llm: ExtractLlm | null = opts.llm === undefined ? routerExtractLlm(db, { jsonMode: false, maxTokens: SUMMARY_MAX_TOKENS }) : opts.llm;
  const now = opts.now ?? (() => new Date());
  for (const block of summaryBlocks(turns)) {
    const { material } = renderTranscript(block.turns);
    if (!material.trim()) continue;
    const ref = `chat:${surface}:summary:${block.index}:${fnv1a(material)}`;
    if ((await findBySourceRef(db, accountId, ref)).length) continue;
    let text = "";
    if (llm) {
      try {
        const raw = await llm.complete({ system: SUMMARY_SYSTEM, user: `CONVERSATION:\n${material}`, accountId });
        const candidate = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, CHAT_SUMMARY_MAX_CHARS);
        if (candidate && traceOverlap(candidate, material) >= 0.5) text = candidate;
      } catch (err) {
        (opts.log ?? defaultLog)("brain.summary_llm_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!text) text = deterministicSummary(block.turns);
    if (!text) continue;
    await addMemory(db, { accountId, kind: "summary", text, source: "chat", sourceRef: ref, confidence: 0.8, importance: 2, tags: ["chat", surface] }, { now, embed: opts.embed, log: opts.log });
    written++;
  }
  return written;
}

export async function afterChatReply(input: ChatHookInput, opts: HookOptions = {}): Promise<ChatHookResult> {
  const log = opts.log ?? defaultLog;
  const db = resolveDb(opts);
  if (!db) return { extracted: null, skipped: "no_db", summariesWritten: 0 };
  const out: ChatHookResult = { extracted: null, summariesWritten: 0 };
  try {
    const lastUser = [...input.history].reverse().find((t) => t.role === "user");
    if (!lastUser || lastUser.content.trim().length < CHAT_EXTRACT_MIN_CHARS) out.skipped = "short_message";
    else {
      const turns: TranscriptTurn[] = [...input.history.slice(-2), { role: "assistant", content: input.reply }];
      const day = (opts.now ?? (() => new Date()))().toISOString().slice(0, 10);
      out.extracted = await extractMemories(db, { accountId: input.accountId, source: "chat", sourceRef: `chat:${input.surface}:${day}`, transcript: turns }, { ...opts, log });
    }
  } catch (err) {
    log("brain.chat_extract_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
  }
  try {
    out.summariesWritten = await rollingSummaries(db, input.accountId, input.surface, [...input.history, { role: "assistant", content: input.reply }], { ...opts, log });
  } catch (err) {
    log("brain.chat_summary_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
  }
  return out;
}

// ---------- scan ----------

export async function afterScan(input: { accountId: string; profile: ProfileLike; sourceRef?: string | null }, opts: HookOptions = {}): Promise<ExtractResult | null> {
  const log = opts.log ?? defaultLog;
  const db = resolveDb(opts);
  if (!db) return null;
  try {
    return await extractMemories(db, { accountId: input.accountId, source: "scan", sourceRef: input.sourceRef ?? input.profile.sources?.[0] ?? null, profile: input.profile }, { ...opts, log });
  } catch (err) {
    log("brain.scan_extract_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ---------- self-review ----------

export interface SelfReviewLike {
  id: string;
  accountId: string;
  weekStart: string;
  body: string;
  changes: { action: string; routineId: string; cadence?: string; why: string }[];
}

/** Called after a self-review is stored (src/lib/telemetry/selfReview.ts generateSelfReview, or the worker). */
export async function afterSelfReview(review: SelfReviewLike, opts: HookOptions = {}): Promise<ExtractResult | null> {
  const log = opts.log ?? defaultLog;
  const db = resolveDb(opts);
  if (!db) return null;
  try {
    return await extractMemories(db, { accountId: review.accountId, source: "self_review", sourceRef: `self_review:${review.id}`, review: { id: review.id, weekStart: review.weekStart, body: review.body, changes: review.changes } }, { ...opts, log });
  } catch (err) {
    log("brain.review_extract_failed", { accountId: review.accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ---------- approvals ----------

export interface ApprovalDecisionLike {
  id: string;
  accountId: string;
  routineId: string;
  title: string;
  detail?: string | null;
}

export interface ApprovalHookResult {
  extracted: ExtractResult | null;
  decisionStyle: DecisionStyle | null;
}

const NAME_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.name]));

/** Called by src/lib/approvals/handlers.ts decideApproval after the run resumes. */
export async function afterApprovalDecision(approval: ApprovalDecisionLike, decision: "approved" | "held", opts: HookOptions & { store?: DecisionSource | null } = {}): Promise<ApprovalHookResult> {
  const log = opts.log ?? defaultLog;
  const out: ApprovalHookResult = { extracted: null, decisionStyle: null };
  const db = resolveDb(opts);
  if (!db) return out;
  try {
    out.extracted = await extractMemories(db, { accountId: approval.accountId, source: "receipt", sourceRef: `approval:${approval.id}`, approval: { id: approval.id, title: approval.title, detail: approval.detail, routineId: approval.routineId, routineName: NAME_BY_ID.get(approval.routineId), decision } }, { ...opts, log });
  } catch (err) {
    log("brain.approval_memory_failed", { accountId: approval.accountId, error: err instanceof Error ? err.message : String(err) });
  }
  if (opts.store) {
    try {
      out.decisionStyle = await refreshDecisionStyle(db, opts.store, approval.accountId, { now: opts.now });
    } catch (err) {
      log("brain.decision_style_failed", { accountId: approval.accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

// ---------- onboarding ----------

export async function afterOnboarding(input: { accountId: string; answers: OnboardingAnswers }, opts: HookOptions = {}): Promise<{ written: number; merged: number; failed: number } | null> {
  const log = opts.log ?? defaultLog;
  const db = resolveDb(opts);
  if (!db) return null;
  try {
    const r = await persistOnboarding(db, input.accountId, input.answers, { now: opts.now, embed: opts.embed, log });
    return { written: r.results.filter((x) => !x.merged).length, merged: r.results.filter((x) => x.merged).length, failed: r.failed };
  } catch (err) {
    log("brain.onboarding_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export { onboardingMemories };
export type { BrainOptions };
