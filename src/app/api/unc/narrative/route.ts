/* POST /api/unc/narrative — Unc writes the prose for the onboarding plan card.

   Body: NarrativeRequest (src/lib/unc/narrative.ts) —
         { plan, profile | null, resources, goal }
   →     { title, mathLine, phaseNotes: string[], footnote, live: number }
   or    { fallback: true }   (no provider configured, provider error, unparseable output)

   Model: the "plan_narrative" task through src/lib/llm/router.ts (account setting →
   LLM_MODEL_PLAN_NARRATIVE → Sonnet 5; max_tokens 4000, effort medium). The plan's
   phases/weeks/channels are never changed here — the model writes words around the
   deterministic plan and every field is validated against it (numbers must come from the
   input, one note per phase, spans stripped). Keys never reach the client. */

import { optionalAccountContext } from "@/lib/llm/accountContext";
import { complete, resolveModel } from "@/lib/llm/router";
import { NARRATIVE_EFFORT, NARRATIVE_MAX_TOKENS, NARRATIVE_SYSTEM, buildNarrativeUserMessage, coerceNarrativeRequest, extractJsonObject, parseNarrative } from "@/lib/unc/narrative";

export const runtime = "nodejs";

const MAX_BODY_CHARS = 40_000;

const fallback = () => Response.json({ fallback: true });

export async function POST(req: Request) {
  if (!resolveModel("plan_narrative")) return fallback();

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

  try {
    const account = await optionalAccountContext();
    const response = await complete(
      "plan_narrative",
      { system: NARRATIVE_SYSTEM, messages: [{ role: "user", content: buildNarrativeUserMessage(request) }], maxTokens: NARRATIVE_MAX_TOKENS, effort: NARRATIVE_EFFORT, jsonMode: true },
      { accountId: account?.accountId ?? null, db: account?.db },
    );
    if (!response || response.stopReason === "refusal" || response.stopReason === "error") return fallback();
    const parsed = parseNarrative(extractJsonObject(response.text), request);
    if (!parsed || parsed.liveFields === 0) return fallback();
    return Response.json({ ...parsed.narrative, live: parsed.liveFields });
  } catch {
    // Never surface provider errors (or anything key-shaped) to the client.
    return fallback();
  }
}
