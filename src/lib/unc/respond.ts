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

import { afterChatReply } from "@/lib/brain/hooks";
import { getProfile, renderProfileForPrompt } from "@/lib/brain/profile";
import { recallForContext } from "@/lib/brain/retrieve";
import { loadAccountState } from "@/lib/db/accountState";
import type { DbClient } from "@/lib/db/types";
import { BUDGET_EXHAUSTED_LINE, isBudgetExceeded } from "@/lib/llm/budget";
import { complete, resolveModel } from "@/lib/llm/router";
import type { LlmMessage } from "@/lib/llm/types";
import { enforceConcision } from "@/lib/unc/concision";
import { attachBrain, buildUncContext, type BrainContext } from "@/lib/unc/context";
import { buildUncSystemPrompt, recallPlaybookNotes, type UncSurface } from "@/lib/unc/prompt";

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
  if (!resolveModel("chat")) return { ok: false, reason: "not_configured" };
  const messages = windowHistory(input.history);
  if (!messages) return { ok: false, reason: "invalid_history" };
  const { account, surface } = input;
  try {
    const question = messages[messages.length - 1].content;
    // Playbook notes ride beside the brain: ≤ 3 of Junction's method cards for this question,
    // env-gated (no database → none; no embeddings → keyword recall). Never a source of numbers.
    const [brain, notes] = await Promise.all([brainFor(account, question), recallPlaybookNotes(question, input.context, account?.db ? { db: account.db } : {})]);
    const withNotes: BrainContext | null = notes ? { memories: brain?.memories ?? [], profile: brain?.profile ?? "", playbooks: notes } : brain;
    const system = buildUncSystemPrompt(attachBrain(input.context, withNotes), surface);
    const llmCtx = { accountId: account?.accountId ?? null, db: account?.db };
    const response = await complete("chat", { system, messages, maxTokens: MAX_REPLY_TOKENS, effort: "low" }, llmCtx);
    if (!response) return { ok: false, reason: "error" };
    // Over the month's cap (src/lib/llm/budget.ts): one honest line, no canned fallback, no learning hook.
    if (isBudgetExceeded(response)) return { ok: true, reply: BUDGET_EXHAUSTED_LINE };
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
        const again = await complete("chat", { system, messages: [...messages, { role: "assistant", content: first }, { role: "user", content: instruction }], maxTokens: MAX_REPLY_TOKENS, effort: "low" }, llmCtx);
        return again && again.stopReason !== "refusal" && again.stopReason !== "error" ? again.text.trim() : null;
      },
    });
    if (account?.db) {
      // Fire-and-forget: Unc learns from the exchange; the reply never waits on it.
      void afterChatReply({ accountId: account.accountId, surface, history: input.history, reply }, { db: account.db }).catch(() => {});
    }
    return { ok: true, reply };
  } catch {
    // Never surface provider errors (or anything key-shaped) to the caller.
    return { ok: false, reason: "error" };
  }
}

/** The account's persisted state as the compact context — the same shape the browser sends. */
export async function buildServerContext(db: DbClient, accountId: string): Promise<Record<string, unknown>> {
  const { state } = await loadAccountState(db, accountId);
  // A real account: the hydrated state only — never the demo approvals / signals / levers.
  return buildUncContext(state, { mode: "account" }) as unknown as Record<string, unknown>;
}
