/* POST /api/unc/chat — the live Unc reply endpoint.

   Body: { messages: [{ role: "user"|"assistant", content: string }...],
           context: <compact account state from src/lib/unc/context.ts>,
           surface?: "corner" | "onboarding" }

   Env-gated: without ANTHROPIC_API_KEY (loaded by scripts/dev.sh from the Junction
   env loader) it returns { fallback: true } and the client keeps its canned
   behaviour. The key never reaches the client and is never logged. */

import Anthropic from "@anthropic-ai/sdk";
import { buildUncSystemPrompt, type UncSurface } from "@/lib/unc/prompt";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-5";
const MAX_REPLY_TOKENS = 500;
const MAX_TURNS = 24; // most recent turns kept
const MAX_TURN_CHARS = 4000;

type WireMsg = { role: "user" | "assistant"; content: string };

function sanitizeMessages(raw: unknown): Anthropic.MessageParam[] | null {
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
  if (!process.env.ANTHROPIC_API_KEY) return fallback();

  let body: { messages?: unknown; context?: unknown; surface?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) return Response.json({ error: "invalid messages" }, { status: 400 });
  const surface: UncSurface = body.surface === "onboarding" ? "onboarding" : "corner";

  // maxRetries: 1 — one retry on transient errors (429/5xx/connection), then fall back.
  const client = new Anthropic({ maxRetries: 1 });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_REPLY_TOKENS,
      system: buildUncSystemPrompt(body.context, surface),
      messages,
    });
    if (response.stop_reason === "refusal") return fallback();
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!reply) return fallback();
    return Response.json({ reply });
  } catch {
    // Never surface provider errors (or anything key-shaped) to the client.
    return fallback();
  }
}
