/* /api/brain/profile — the founder's own notes on how to work with them (account_profiles.founder_notes).

   GET              → { founderNotes: string | null, tone, cadence, channels }
   PATCH { founderNotes } → { founderNotes }
   Session-bound; account_profiles is member_all under RLS. The learned fields (tone,
   decision_style, cadence) are written by the brain, never by this route. */

import { requireAccountSession } from "@/lib/db/session";
import { unwrap } from "@/lib/db/types";
import { withErrorCapture } from "@/lib/observability/errors";
import { automationPauseResponse } from "@/lib/db/automationPause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status });
const MAX_NOTES = 4000;

interface ProfileRow {
  founder_notes: string | null;
  tone: Record<string, unknown>;
  cadence: Record<string, unknown>;
  channels: Record<string, unknown>;
}

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const row = await unwrap<ProfileRow | null>("account_profiles.get", session.db.from("account_profiles").select("founder_notes, tone, cadence, channels").eq("account_id", session.accountId).maybeSingle());
    return json({ founderNotes: row?.founder_notes ?? null, tone: row?.tone ?? {}, cadence: row?.cadence ?? {}, channels: row?.channels ?? {} }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "profile read failed" }, 500);
  }
}

async function handlePATCH(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const paused = await automationPauseResponse(session.service, session.accountId);
  if (paused) return paused;
  let body: { founderNotes?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (body.founderNotes !== null && typeof body.founderNotes !== "string") return json({ error: "founderNotes must be a string or null" }, 400);
  const founderNotes = typeof body.founderNotes === "string" ? body.founderNotes.trim().slice(0, MAX_NOTES) || null : null;
  try {
    await unwrap("account_profiles.upsert", session.db.from("account_profiles").upsert({ account_id: session.accountId, founder_notes: founderNotes, updated_at: new Date().toISOString() }, { onConflict: "account_id" }));
    return json({ founderNotes }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "profile write failed" }, 500);
  }
}

export const GET = withErrorCapture("api/brain/profile", handleGET);
export const PATCH = withErrorCapture("api/brain/profile", handlePATCH);
