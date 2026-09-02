/* POST /api/unc/narrative — Unc writes the prose for the onboarding plan card.

   Body: NarrativeRequest (src/lib/unc/narrative.ts) —
         { plan, profile | null, resources, goal }
   →     { title, mathLine, phaseNotes: string[], footnote, live: number }
   or    { fallback: true }   (no ANTHROPIC_API_KEY, provider error, unparseable output)

   The plan's phases/weeks/channels are never changed here — the model writes words
   around the deterministic plan and every field is validated against it (numbers must
   come from the input, one note per phase, spans stripped). The key never reaches the
   client and is never logged. */

import Anthropic from "@anthropic-ai/sdk";
import { NARRATIVE_EFFORT, NARRATIVE_MAX_TOKENS, NARRATIVE_SYSTEM, buildNarrativeUserMessage, coerceNarrativeRequest, extractJsonObject, parseNarrative } from "@/lib/unc/narrative";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-5";
const MAX_BODY_CHARS = 40_000;

const fallback = () => Response.json({ fallback: true });

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return fallback();

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return Response.json({ error: "body too large" }, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const request = coerceNarrativeRequest(raw);
  if (!request) return Response.json({ error: "invalid plan" }, { status: 400 });

  const client = new Anthropic({ maxRetries: 1 });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: NARRATIVE_MAX_TOKENS,
      output_config: { effort: NARRATIVE_EFFORT },
      system: NARRATIVE_SYSTEM,
      messages: [{ role: "user", content: buildNarrativeUserMessage(request) }],
    });
    if (response.stop_reason === "refusal") return fallback();
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseNarrative(extractJsonObject(text), request);
    if (!parsed || parsed.liveFields === 0) return fallback();
    return Response.json({ ...parsed.narrative, live: parsed.liveFields });
  } catch {
    // Never surface provider errors (or anything key-shaped) to the client.
    return fallback();
  }
}
