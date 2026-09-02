/* POST /api/unc/chat — the live Unc reply endpoint.

   Body: { messages: [{ role: "user"|"assistant", content: string }...],
           context: <compact account state from src/lib/unc/context.ts>,
           surface?: "corner" | "onboarding" }

   Model: the "chat" task through src/lib/llm/router.ts (account setting →
   LLM_MODEL_CHAT → Sonnet 5, see docs/MODELS.md). With no provider configured it returns
   { fallback: true } and the client keeps its canned behaviour. Keys never reach the
   client and are never logged.

   Client Brain (accounts mode only — demo mode never touches the database): before the call,
   what Unc remembers about this founder (recallForContext, keyed on the latest message) and
   how they like to work (the profile) are attached to the context; after a live reply,
   afterChatReply runs fire-and-forget — memory extraction from the last turns and the
   rolling summaries of a >24-turn thread. */

import { afterChatReply } from "@/lib/brain/hooks";
import { getProfile, renderProfileForPrompt } from "@/lib/brain/profile";
import { recallForContext } from "@/lib/brain/retrieve";
import { optionalAccountContext } from "@/lib/llm/accountContext";
import { complete, resolveModel } from "@/lib/llm/router";
import type { LlmMessage } from "@/lib/llm/types";
import { attachBrain, type BrainContext } from "@/lib/unc/context";
import { buildUncSystemPrompt, type UncSurface } from "@/lib/unc/prompt";

export const runtime = "nodejs";

const MAX_REPLY_TOKENS = 2000; // Sonnet 5 adaptive thinking counts against max_tokens; effort pinned low below
const MAX_TURNS = 24; // most recent turns kept
const MAX_TURN_CHARS = 4000;

type WireMsg = { role: "user" | "assistant"; content: string };

/** `recent` = the window the model sees (last 24 turns); `all` = the whole thread (the brain's
    rolling summaries need the turns that fell out of the window). */
function sanitizeMessages(raw: unknown): { recent: LlmMessage[]; all: LlmMessage[] } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const msgs: WireMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.slice(0, MAX_TURN_CHARS).trim();
    if (text) msgs.push({ role, content: text });
  }
  const recent = msgs.slice(-MAX_TURNS);
  // The API requires the first message to be a user turn.
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (!recent.length || recent[recent.length - 1].role !== "user") return null;
  return { recent, all: msgs };
}

/** What Unc remembers, for the prompt. Never throws; null when there is no account (demo). */
async function brainFor(account: { accountId: string; db: import("@/lib/db/types").DbClient } | null, query: string): Promise<BrainContext | null> {
  if (!account?.db) return null;
  try {
    const [recall, profile] = await Promise.all([recallForContext(account.db, account.accountId, { query }), getProfile(account.db, account.accountId)]);
    const rendered = renderProfileForPrompt(profile);
    return recall.lines.length || rendered ? { memories: recall.lines, profile: rendered } : null;
  } catch {
    return null;
  }
}

const fallback = () => Response.json({ fallback: true });

export async function POST(req: Request) {
  if (!resolveModel("chat")) return fallback();

  let body: { messages?: unknown; context?: unknown; surface?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sanitized = sanitizeMessages(body.messages);
  if (!sanitized) return Response.json({ error: "invalid messages" }, { status: 400 });
  const { recent: messages, all } = sanitized;
  const surface: UncSurface = body.surface === "onboarding" ? "onboarding" : "corner";

  try {
    const account = await optionalAccountContext();
    const brain = await brainFor(account, messages[messages.length - 1].content);
    const response = await complete(
      "chat",
      { system: buildUncSystemPrompt(attachBrain(body.context, brain), surface), messages, maxTokens: MAX_REPLY_TOKENS, effort: "low" },
      { accountId: account?.accountId ?? null, db: account?.db },
    );
    // A provider error, a refusal or nothing configured all keep the canned behaviour.
    if (!response || response.stopReason === "refusal" || response.stopReason === "error") return fallback();
    const reply = response.text.trim();
    if (!reply) return fallback();
    if (account?.db) {
      // Fire-and-forget: Unc learns from the exchange; the reply never waits on it.
      void afterChatReply({ accountId: account.accountId, surface, history: all, reply }, { db: account.db }).catch(() => {});
    }
    return Response.json({ reply });
  } catch {
    // Never surface provider errors (or anything key-shaped) to the client.
    return fallback();
  }
}
