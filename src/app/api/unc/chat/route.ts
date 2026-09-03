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
import { MAX_TURN_CHARS, respondAsUnc } from "@/lib/unc/respond";
import { withErrorCapture } from "@/lib/observability/errors";

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
  const account = await requireModelAccountContext();
  if (account instanceof Response) return account;

  let body: { messages?: unknown; context?: unknown; surface?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return Response.json({ error: "body too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const history = sanitizeMessages(body.messages);
  if (!history) return Response.json({ error: "invalid messages" }, { status: 400 });
  const surface: UncSurface = body.surface === "onboarding" ? "onboarding" : "corner";

  const result = await respondAsUnc({ history, context: body.context, surface, account });
  if (!result.ok) return result.reason === "invalid_history" ? Response.json({ error: "invalid messages" }, { status: 400 }) : fallback();
  return Response.json({ reply: result.reply });
}

export const POST = withErrorCapture("api/unc/chat", handlePOST);
