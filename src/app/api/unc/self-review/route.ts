/* Unc's weekly self-review for the caller's account.

   GET  → { review: HomeReviewView | null }          the latest stored review
   POST → { review: HomeReviewView, author, liveFields, rejected }   owner-only generate (or regenerate)
          this week's review now — session-bound, idempotent per ISO week (one row per
          account + week_start; a POST rewrites this week's row)
   or   { fallback: true }   demo mode (no database) — the UI keeps its demo bubble
   or   401 | 403 | 503 { error }

   Model: the "self_review" task through src/lib/llm/router.ts (account setting →
   LLM_MODEL_SELF_REVIEW → Sonnet 5; max_tokens 4000, effort low) writes the review and
   every field is validated against the evidence (numbers-only, real levers only, one ask);
   with no provider configured — or on refusal / provider error — the deterministic review
   is stored instead. Keys never reach the client. */

import { createTextClient } from "@/lib/llm/router";
import { requireAccountOwnerSession, requireAccountSession, type AccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { homeTelemetryForAccount } from "@/lib/telemetry/home";
import { afterSelfReview } from "@/lib/brain/hooks";
import { generateSelfReview, SELF_REVIEW_EFFORT, SELF_REVIEW_MAX_TOKENS, type SelfReviewLlm } from "@/lib/telemetry/selfReview";
import { withErrorCapture } from "@/lib/observability/errors";
import { automationPauseResponse } from "@/lib/db/automationPause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reviewLlm(accountId: string, db: AccountSession["service"]): SelfReviewLlm | null {
  return createTextClient("self_review", { maxTokens: SELF_REVIEW_MAX_TOKENS, effort: SELF_REVIEW_EFFORT, jsonMode: true }, { accountId, db });
}

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const t = await homeTelemetryForAccount(getStore(), session.accountId);
    return Response.json({ review: t.review });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "review lookup failed" }, { status: 500 });
  }
}

async function handlePOST() {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const paused = await automationPauseResponse(session.service, session.accountId);
  if (paused) return paused;
  try {
    const store = getStore();
    const g = await generateSelfReview({ store, accountId: session.accountId, llm: reviewLlm(session.accountId, session.service) });
    // Client Brain: lessons + change rationale become durable memories (fire-and-forget; never blocks the reply).
    void afterSelfReview(g.record).catch(() => undefined);
    const t = await homeTelemetryForAccount(store, session.accountId);
    return Response.json({ review: t.review, author: g.author, liveFields: g.liveFields, rejected: g.rejected });
  } catch (err) {
    // Never surface provider errors (or anything key-shaped) to the client.
    return Response.json({ error: err instanceof Error && !/api[_ ]?key|anthropic/i.test(err.message) ? err.message : "review generation failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/unc/self-review", handleGET);
export const POST = withErrorCapture("api/unc/self-review", handlePOST);
