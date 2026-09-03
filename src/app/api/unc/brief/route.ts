/* Unc's daily brief for the caller's account (docs/PROACTIVE.md).

   GET  → { brief: DailyBriefRecord | null, day }        today's brief (account-local day)
   POST → { brief: DailyBriefRecord, author, existed }   generate today's brief now — idempotent
          per local day (an existing row is returned untouched; body { force: true } regenerates)
   or   { fallback: true }   demo mode (no database) — Home renders nothing for the brief
   or   401 | 403 | 503 { error }

   Model: the "daily_brief" task through src/lib/llm/router.ts (balanced tier by default,
   LLM_MODEL_DAILY_BRIEF to override; max_tokens 4000, effort low), every field validated
   against the gathered evidence (numbers-only, real refs only, ≤ 5 items, one "noticed");
   without a provider — or on refusal / provider error — the deterministic brief is stored.
   Keys never reach the client. */

import { BRIEF_EFFORT, BRIEF_MAX_TOKENS, generateDailyBrief, getDailyBrief, localDay, readTimezone, type BriefLlm } from "@/lib/brain/brief";
import { createTextClient } from "@/lib/llm/router";
import { requireAccountSession, type AccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function briefLlm(accountId: string, db: AccountSession["service"]): BriefLlm | null {
  return createTextClient("daily_brief", { maxTokens: BRIEF_MAX_TOKENS, effort: BRIEF_EFFORT, jsonMode: true }, { accountId, db });
}

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const timezone = await readTimezone(session.service, session.accountId);
    const day = localDay(new Date(), timezone);
    const brief = await getDailyBrief(session.service, session.accountId, day);
    return Response.json({ brief, day });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "brief lookup failed" }, { status: 500 });
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  let force = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: unknown };
    force = body?.force === true;
  } catch {
    force = false;
  }
  try {
    const g = await generateDailyBrief({ store: getStore(), db: session.service, accountId: session.accountId, llm: briefLlm(session.accountId, session.service), force });
    return Response.json({ brief: g.record, author: g.author, existed: g.existed, liveItems: g.liveItems, rejected: g.rejected });
  } catch (err) {
    // Never surface provider errors (or anything key-shaped) to the client.
    return Response.json({ error: err instanceof Error && !/api[_ ]?key|anthropic/i.test(err.message) ? err.message : "brief generation failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/unc/brief", handleGET);
export const POST = withErrorCapture("api/unc/brief", handlePOST);
