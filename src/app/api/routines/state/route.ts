/* GET  /api/routines/state[?routineId=D0x-W0y] — the Routines view's real state.
   →  { routines: [{ routineId, name, category, wave, enabled, version, availability,
                     availabilityCopy, canEnable, recommended, lastRun, lastDraft }],
        recommendedFirst: [ids], planChannel, connected: [platforms],
        lastRunReceipts?: [...] }            (with ?routineId= — the last run's receipt trail)
   or { fallback: true }   demo mode (no database) — the view keeps its demo rows
   or 401 | 403 | 503 { error }

   POST /api/routines/state  { routineId, enabled }  → { routine }   persist the switch
   (the view then dry-runs it through POST /api/routines/run when it was switched on).

   Session-bound (src/lib/db/session.ts): always the caller's own account. Store =
   getStore() (SupabaseStore with the service role); connectors + the plan through the
   session's service client. */

import { requireAccountSession } from "@/lib/db/session";
import { routinesStateForAccount, setRoutineEnabled } from "@/lib/runtime/routinesState";
import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const routineId = new URL(req.url).searchParams.get("routineId") ?? undefined;
  if (routineId && !ROUTINE_ID_RE.test(routineId)) return Response.json({ error: "routineId must look like D0x-W0y" }, { status: 400 });
  try {
    const listing = await routinesStateForAccount({ store: getStore(), db: session.service }, session.accountId, { routineId });
    return Response.json(listing, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "listing failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { routineId?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  if (!ROUTINE_ID_RE.test(routineId)) return Response.json({ error: "routineId must look like D0x-W0y" }, { status: 400 });
  if (typeof body.enabled !== "boolean") return Response.json({ error: "enabled must be true or false" }, { status: 400 });
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const routine = await setRoutineEnabled({ store: getStore(), db: session.service }, session.accountId, routineId, body.enabled);
    return Response.json({ routine });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return Response.json({ error: message }, { status: /not in the catalog/.test(message) ? 404 : 500 });
  }
}
