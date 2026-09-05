/* Unc's daily brief for the caller's account (docs/PROACTIVE.md).

   GET  → { brief: DailyBriefRecord | null, day }        today's brief (account-local day)
   POST → { brief: DailyBriefRecord, author, existed }   owner-only generation — idempotent per
          local day (an existing row is returned untouched; body { force: true } regenerates)
   or   { fallback: true }   demo mode (no database) — Home renders nothing for the brief
   or   401 | 403 | 503 { error }

   Model: the "daily_brief" task through src/lib/llm/router.ts (balanced tier by default,
   LLM_MODEL_DAILY_BRIEF to override; max_tokens 4000, effort low), every field validated
   against the gathered evidence (numbers-only, real refs only, ≤ 5 items, one "noticed");
   without a provider — or on refusal / provider error — the deterministic brief is stored.
   Keys never reach the client. */

import { BRIEF_EFFORT, BRIEF_MAX_TOKENS, generateDailyBrief, getDailyBrief, localDay, readTimezone, type BriefLlm } from "@/lib/brain/brief";
import { createTextClient } from "@/lib/llm/router";
import { requireAccountOwnerSession, requireAccountSession, type AccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { withErrorCapture } from "@/lib/observability/errors";
import { automationPauseResponse } from "@/lib/db/automationPause";
import { accountContextGeneration, contextRequestMatches, contextChangedResponse } from "@/lib/db/contextGeneration";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { RuntimeContextError } from "@/lib/runtime/contextFence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function briefLlm(accountId: string, db: AccountSession["service"]): BriefLlm | null {
  return createTextClient("daily_brief", { maxTokens: BRIEF_MAX_TOKENS, effort: BRIEF_EFFORT, jsonMode: true }, { accountId, db });
}

function briefError(err: unknown, fallback: string) {
  if (err instanceof RuntimeContextError) return Response.json({ error: err.message, code: err.code }, { status: err.code === "context_changed" ? 409 : 503 });
  return Response.json({ error: fallback }, { status: 503 });
}

async function handleGET(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const contextGeneration = await accountContextGeneration(session.service, session.accountId);
    if (!contextRequestMatches(req, contextGeneration)) return contextChangedResponse();
    await assertRuntimeContext(session.service, { accountId: session.accountId, contextGeneration }, { allowPaused: true });
    const timezone = await readTimezone(session.service, session.accountId);
    const day = localDay(new Date(), timezone);
    const brief = await getDailyBrief(session.service, session.accountId, day, contextGeneration);
    return Response.json({ brief, day }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return briefError(err, "Couldn't read today's brief.");
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  let force = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: unknown };
    force = body?.force === true;
  } catch {
    force = false;
  }
  try {
    const contextGeneration = await accountContextGeneration(session.service, session.accountId);
    if (!contextRequestMatches(req, contextGeneration)) return contextChangedResponse();
    const paused = await automationPauseResponse(session.service, session.accountId);
    if (paused) return paused;
    const g = await generateDailyBrief({ store: getStore(), db: session.service, accountId: session.accountId, contextGeneration, llm: briefLlm(session.accountId, session.service), force });
    return Response.json({ brief: g.record, author: g.author, existed: g.existed, liveItems: g.liveItems, rejected: g.rejected });
  } catch (err) {
    // Never surface provider errors (or anything key-shaped) to the client.
    return briefError(err, "Couldn't generate today's brief.");
  }
}

export const GET = withErrorCapture("api/unc/brief", handleGET);
export const POST = withErrorCapture("api/unc/brief", handlePOST);
