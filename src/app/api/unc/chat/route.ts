/* POST /api/unc/chat — the live Unc reply endpoint.

   Body: { messages: [{ role: "user"|"assistant", content: string }...],
           context: <compact account state from src/lib/unc/context.ts>,
           surface?: "corner" | "onboarding" }

   The pipeline itself lives in src/lib/unc/respond.ts (respondAsUnc) and is shared with the
   channels layer, so a founder's Telegram / WhatsApp / Slack / SMS message gets the same
   prompt, brain and memory hook as the corner chat. Model: the "chat" task through
   src/lib/llm/router.ts (account setting → LLM_MODEL_CHAT → Sonnet 5, see docs/MODELS.md).
   With no provider configured it returns { fallback: true } and the client keeps its canned
   behaviour. Keys never reach the client and are never logged.

   Client Brain (accounts mode only — demo mode never touches the database): before the call,
   what Unc remembers about this founder and how they like to work are attached to the
   context; after a live reply, afterChatReply runs fire-and-forget.

   The app's own turns reach the one thread (chat_messages, channel 'app') through the
   client autosave (src/lib/db/accountState.ts), not here — persisting them twice would
   duplicate them. Channel turns are written by src/lib/channels/thread.ts. */

import { requireModelAccountContext } from "@/lib/llm/accountContext";
import type { LlmMessage } from "@/lib/llm/types";
import type { UncSurface } from "@/lib/unc/prompt";
import { buildServerContext, buildServerHistory, MAX_TURN_CHARS, respondAsUnc } from "@/lib/unc/respond";
import { contextStillCurrent, CONTEXT_CHANGED_MESSAGE } from "@/lib/db/contextGeneration";
import { withErrorCapture } from "@/lib/observability/errors";
import { routeCommand } from "@/lib/commands/message";
import { getStore } from "@/lib/runtime/store";

export const runtime = "nodejs";

type WireMsg = { role: "user" | "assistant"; content: string };
const MAX_BODY_CHARS = 64_000;
const MAX_MESSAGES = 50;

/** Shape-check the wire thread (the window + first-user rule are applied in respond.ts). */
function sanitizeMessages(raw: unknown): LlmMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const msgs: WireMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.slice(0, MAX_TURN_CHARS).trim();
    if (text) msgs.push({ role, content: text });
  }
  return msgs.length ? msgs : null;
}

const fallback = () => Response.json({ fallback: true });

async function handlePOST(req: Request) {
  const account = await requireModelAccountContext(req);
  if (account instanceof Response) return account;

  let body: { messages?: unknown; context?: unknown; surface?: unknown; requestId?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return Response.json({ error: "body too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let history = sanitizeMessages(body.messages);
  if (!history) return Response.json({ error: "invalid messages" }, { status: 400 });
  if (history[history.length - 1].role !== "user") return Response.json({ error: "last message must be from the user" }, { status: 400 });
  const surface: UncSurface = body.surface === "onboarding" ? "onboarding" : "corner";

  if (account && surface === "corner") {
    const command = await routeCommand(account.db, getStore(), { accountId: account.accountId, userId: account.userId ?? "", channel: "app", requestId: typeof body.requestId === "string" ? body.requestId : "" }, history[history.length - 1].content);
    if (command) return Response.json(command);
  }

  // Once signed in, ordinary chat uses persisted account facts, not a stale or
  // fabricated browser context. Onboarding may still discuss unsaved draft inputs;
  // it cannot dispatch commands and never grants runtime permissions.
  let context = body.context;
  if (account && surface === "corner") {
    try {
      context = await buildServerContext(account.db, account.accountId);
      history = await buildServerHistory(account.db, account.accountId, history[history.length - 1]);
    } catch {
      return Response.json({ error: "Couldn't load your business context. Please try again." }, { status: 503 });
    }
  }
  const result = await respondAsUnc({ history, context, surface, account });
  if (account?.contextGeneration !== undefined) {
    try {
      if (!await contextStillCurrent(account.db, account.accountId, account.contextGeneration))
        return Response.json({ error: CONTEXT_CHANGED_MESSAGE, code: "context_changed" }, { status: 409 });
    } catch { return Response.json({ error: "Couldn't verify business context." }, { status: 503 }); }
  }
  if (!result.ok) return result.reason === "invalid_history" ? Response.json({ error: "invalid messages" }, { status: 400 }) : fallback();
  return Response.json({ reply: result.reply });
}

export const POST = withErrorCapture("api/unc/chat", handlePOST);
