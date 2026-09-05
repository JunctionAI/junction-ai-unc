/* The Unc reply pipeline, server-side — ONE implementation shared by POST /api/unc/chat (the
   corner / onboarding chat) and the channels layer (src/lib/channels/inbound.ts: a message
   from Telegram / WhatsApp / Slack / SMS gets the same prompt, the same brain, the same
   memory hook).

     respondAsUnc({ history, context, surface, account })
       history  the whole thread, oldest first, ending with the founder's turn (windowed here
                to the last 24 turns for the model; the brain's rolling summaries see all)
       context  the compact account state (the browser builds it with buildUncContext; a
                channel builds it server-side with buildServerContext)
       account  { accountId, db } in accounts mode — recall + profile land in the prompt and
                afterChatReply fires after a live reply; null in demo mode (no database)
       → { ok: true, reply } or { ok: false, reason } — the caller keeps its canned behaviour.

     buildServerContext(db, accountId)  the account's persisted state → buildUncContext, for
                callers with no browser in the loop.

   Concision is enforced in code (src/lib/unc/concision.ts): a reply past three sentences to a
   founder who did not ask for depth is re-asked ONCE ("Same answer in at most three sentences,
   answer first") and the shorter one stands only when it validates — never a truncation.

   Nothing here logs a key or surfaces a provider error. The system prompt is built by
   src/lib/unc/prompt.ts (buildUncSystemPrompt) — never duplicated. */

import { afterChatReply } from "../brain/hooks";
import { getProfile, renderProfileForPrompt } from "../brain/profile";
import { recallForContext } from "../brain/retrieve";
import { loadAccountState } from "../db/accountState";
import type { DbClient } from "../db/types";
import { listThread } from "../channels/thread";
import { BUDGET_EXHAUSTED_LINE, BUDGET_UNAVAILABLE_LINE, isBudgetExceeded, isBudgetUnavailable } from "../llm/budget";
import { loadAccountFacts } from "./loadAccountFacts";
import { complete, resolveModel } from "../llm/router";
import type { LlmMessage } from "../llm/types";
import { getMetrics, renderCertifiedMetrics } from "../metrics/catalog";
import { enforceConcision } from "./concision";
import { attachBrain, buildUncContext, type BrainContext } from "./context";
import { buildUncSystemPrompt, recallPlaybookNotes, type UncSurface } from "./prompt";
import type { UncVoice } from "./voice";
import { RuntimeContextError } from "../runtime/contextFence";
import { assertRuntimeContext } from "../db/runtimeContext";

export const MAX_REPLY_TOKENS = 2000; // Sonnet 5 adaptive thinking counts against max_tokens; effort pinned low
export const MAX_TURNS = 24; // most recent turns the model sees
export const MAX_TURN_CHARS = 4000;

export interface RespondAccount {
  accountId: string;
  db: DbClient;
}

export interface RespondInput {
  history: LlmMessage[];
  context: unknown;
  surface: UncSurface;
  account: RespondAccount | null;
  /** Selected by the trusted channel adapter, never by account context text. */
  voice?: UncVoice;
  /** Server-owned captured identity. A failed guard must not become a fallback. */
  guard?: () => Promise<void>;
}

export type RespondFailure = "not_configured" | "invalid_history" | "refusal" | "error" | "empty";
export type RespondResult = { ok: true; reply: string } | { ok: false; reason: RespondFailure };

/** The last 24 turns, starting on a user turn and ending on one (the API's shape). null when
    there is no usable founder turn. */
export function windowHistory(all: LlmMessage[]): LlmMessage[] | null {
  const msgs = all.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS).trim() })).filter((m) => m.content);
  const recent = msgs.slice(-MAX_TURNS);
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (!recent.length || recent[recent.length - 1].role !== "user") return null;
  return recent;
}

/** Certified catalog snapshots for the prompt. Never throws; null in demo (no db). An empty
    catalog still renders the honest "no metrics on file" line so a missing key cannot be 0. */
export async function certifiedMetricsFor(account: RespondAccount | null): Promise<string | null> {
  if (!account?.db) return null;
  try {
    return renderCertifiedMetrics(await getMetrics(account.db, account.accountId));
  } catch {
    return renderCertifiedMetrics([]);
  }
}

/** What Unc remembers, for the prompt. Never throws; null when there is no account (demo). */
export async function brainFor(account: RespondAccount | null, query: string): Promise<BrainContext | null> {
  if (!account?.db) return null;
  try {
    const [recall, profile] = await Promise.all([recallForContext(account.db, account.accountId, { query }), getProfile(account.db, account.accountId)]);
    const rendered = renderProfileForPrompt(profile);
    return recall.lines.length || rendered ? { memories: recall.lines, profile: rendered } : null;
  } catch {
    return null;
  }
}

export async function respondAsUnc(input: RespondInput): Promise<RespondResult> {
  await input.guard?.();
  if (!resolveModel("chat")) return { ok: false, reason: "not_configured" };
  const messages = windowHistory(input.history);
  if (!messages) return { ok: false, reason: "invalid_history" };
  const { account, surface } = input;
  try {
    const question = messages[messages.length - 1].content;
    // Playbook notes ride beside the brain: ≤ 3 of Junction's method cards for this question,
    // env-gated (no database → none; no embeddings → keyword recall). Never a source of numbers.
    const [brain, notes, certified] = await Promise.all([
      brainFor(account, question),
      recallPlaybookNotes(question, input.context, account?.db ? { db: account.db } : {}),
      certifiedMetricsFor(account),
    ]);
    await input.guard?.();
    const withNotes: BrainContext | null =
      notes || certified || brain
        ? { memories: brain?.memories ?? [], profile: brain?.profile ?? "", ...(notes ? { playbooks: notes } : {}), ...(certified ? { certifiedMetrics: certified } : {}) }
        : null;
    const system = buildUncSystemPrompt(attachBrain(input.context, withNotes), surface, input.voice);
    const llmCtx = { accountId: account?.accountId ?? null, db: account?.db };
    const response = await complete("chat", { system, messages, maxTokens: MAX_REPLY_TOKENS, effort: "low" }, llmCtx);
    await input.guard?.();
    if (!response) return { ok: false, reason: "error" };
    // Over the month's cap (src/lib/llm/budget.ts): one honest line, no canned fallback, no learning hook.
    if (isBudgetExceeded(response)) return { ok: true, reply: BUDGET_EXHAUSTED_LINE };
    if (isBudgetUnavailable(response)) return { ok: true, reply: BUDGET_UNAVAILABLE_LINE };
    if (response.stopReason === "refusal") return { ok: false, reason: "refusal" };
    if (response.stopReason === "error") return { ok: false, reason: "error" };
    const first = response.text.trim();
    if (!first) return { ok: false, reason: "empty" };
    // The code-enforced cap: one re-ask when the reply ran long without a request for depth;
    // the shorter answer is used only when it validates, else the first stands whole.
    const { reply } = await enforceConcision({
      question,
      reply: first,
      context: input.context,
      reask: async (instruction) => {
        await input.guard?.();
        const again = await complete("chat", { system, messages: [...messages, { role: "assistant", content: first }, { role: "user", content: instruction }], maxTokens: MAX_REPLY_TOKENS, effort: "low" }, llmCtx);
        await input.guard?.();
        return again && again.stopReason !== "refusal" && again.stopReason !== "error" ? again.text.trim() : null;
      },
    });
    await input.guard?.();
    if (account?.db) {
      // Fire-and-forget: Unc learns from the exchange; the reply never waits on it.
      void afterChatReply({ accountId: account.accountId, surface, history: input.history, reply }, { db: account.db }).catch(() => {});
    }
    return { ok: true, reply };
  } catch (error) {
    if (error instanceof RuntimeContextError) throw error;
    await input.guard?.();
    // Never surface provider errors (or anything key-shaped) to the caller.
    return { ok: false, reason: "error" };
  }
}

/** The account's persisted state as the compact context — the same shape the browser sends. */
export async function buildServerContext(db: DbClient, accountId: string): Promise<Record<string, unknown>> {
  const [{ state }, facts] = await Promise.all([loadAccountState(db, accountId), loadAccountFacts(db, accountId)]);
  // A real account: the hydrated state only — never the demo approvals / signals / levers.
  return buildUncContext(state, { mode: "account", facts }) as unknown as Record<string, unknown>;
}

/** Persisted unified history is authoritative; a stale browser cannot replay archived turns
 * into the model or rolling memory summaries. The current explicit user input is retained. */
export async function buildServerHistory(db: DbClient, accountId: string, latest: LlmMessage, contextGeneration = 0): Promise<LlmMessage[]> {
  const identity = { accountId, contextGeneration };
  await assertRuntimeContext(db, identity, { allowPaused: true });
  const rows = await listThread(db, accountId, { contextGeneration, limit: 49 });
  await assertRuntimeContext(db, identity, { allowPaused: true });
  const history: LlmMessage[] = rows.filter(row => (row.sender === "user" || row.sender === "unc") && row.body?.trim())
    .map(row => ({ role: row.sender === "user" ? "user" : "assistant", content: row.body.slice(0, MAX_TURN_CHARS) }));
  const last = history[history.length - 1];
  if (rows.at(-1)?.channel === "app" && last?.role === "user" && last.content.trim() === latest.content.trim()) history.pop();
  return [...history, latest];
}
