/* POST /api/unc/chat — the live Unc reply endpoint.

   Body: { messages: [{ role: "user"|"assistant", content: string }...],
           context: <compact account state from src/lib/unc/context.ts>,
           surface?: "corner" | "onboarding" }

   Model: the "chat" task through src/lib/llm/router.ts (account setting →
   LLM_MODEL_CHAT → Sonnet 5, see docs/MODELS.md). With no provider configured it returns
   { fallback: true } and the client keeps its canned behaviour. Keys never reach the
   client and are never logged. */

import { optionalAccountContext } from "@/lib/llm/accountContext";
import { complete, resolveModel } from "@/lib/llm/router";
import type { LlmMessage } from "@/lib/llm/types";
import { buildUncSystemPrompt, type UncSurface } from "@/lib/unc/prompt";

export const runtime = "nodejs";

const MAX_REPLY_TOKENS = 2000; // Sonnet 5 adaptive thinking counts against max_tokens; effort pinned low below
const MAX_TURNS = 24; // most recent turns kept
const MAX_TURN_CHARS = 4000;

type WireMsg = { role: "user" | "assistant"; content: string };

function sanitizeMessages(raw: unknown): LlmMessage[] | null {
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
  return recent;
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

  const messages = sanitizeMessages(body.messages);
  if (!messages) return Response.json({ error: "invalid messages" }, { status: 400 });
  const surface: UncSurface = body.surface === "onboarding" ? "onboarding" : "corner";

  try {
    const account = await optionalAccountContext();
    const response = await complete(
      "chat",
      { system: buildUncSystemPrompt(body.context, surface), messages, maxTokens: MAX_REPLY_TOKENS, effort: "low" },
      { accountId: account?.accountId ?? null, db: account?.db },
    );
    // A provider error, a refusal or nothing configured all keep the canned behaviour.
    if (!response || response.stopReason === "refusal" || response.stopReason === "error") return fallback();
    const reply = response.text.trim();
    if (!reply) return fallback();
    return Response.json({ reply });
  } catch {
    // Never surface provider errors (or anything key-shaped) to the client.
    return fallback();
  }
}
