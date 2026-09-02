/* Unc's weekly self-review for the caller's account.

   GET  → { review: HomeReviewView | null }          the latest stored review
   POST → { review: HomeReviewView, author, liveFields, rejected }   generate (or regenerate)
          this week's review now — session-bound, idempotent per ISO week (one row per
          account + week_start; a POST rewrites this week's row)
   or   { fallback: true }   demo mode (no database) — the UI keeps its demo bubble
   or   401 | 403 | 503 { error }

   Env-gated model: with ANTHROPIC_API_KEY, Sonnet (claude-sonnet-5, max_tokens 4000,
   effort low) writes the review and every field is validated against the evidence
   (numbers-only, real levers only, one ask); without it — or on refusal / provider error —
   the deterministic review is stored instead. The key never reaches the client. */

import Anthropic from "@anthropic-ai/sdk";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { homeTelemetryForAccount } from "@/lib/telemetry/home";
import { generateSelfReview, SELF_REVIEW_EFFORT, SELF_REVIEW_MAX_TOKENS, type SelfReviewLlm } from "@/lib/telemetry/selfReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";

function sonnet(): SelfReviewLlm | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ maxRetries: 1 });
  return {
    async complete({ system, user }) {
      const response = await client.messages.create({ model: MODEL, max_tokens: SELF_REVIEW_MAX_TOKENS, output_config: { effort: SELF_REVIEW_EFFORT }, system, messages: [{ role: "user", content: user }] });
      if (response.stop_reason === "refusal") throw new Error("refusal");
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    },
  };
}

export async function GET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const t = await homeTelemetryForAccount(getStore(), session.accountId);
    return Response.json({ review: t.review });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "review lookup failed" }, { status: 500 });
  }
}

export async function POST() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const store = getStore();
    const g = await generateSelfReview({ store, accountId: session.accountId, llm: sonnet() });
    const t = await homeTelemetryForAccount(store, session.accountId);
    return Response.json({ review: t.review, author: g.author, liveFields: g.liveFields, rejected: g.rejected });
  } catch (err) {
    // Never surface provider errors (or anything key-shaped) to the client.
    return Response.json({ error: err instanceof Error && !/api[_ ]?key|anthropic/i.test(err.message) ? err.message : "review generation failed" }, { status: 500 });
  }
}
