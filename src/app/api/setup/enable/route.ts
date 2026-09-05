/* POST /api/setup/enable — turn a routine on for the caller's account (spine step 3).

   Body: { routineId: "D0x-W0y" }
   →     { routineId, enabled: true, version }   idempotent
   or    { fallback: true }   demo mode (no database) — the client keeps its local toggle
   or    400 | 401 | 403 | 404 | 503 { error }

   Writes routine_states through the runtime Store (the same record the worker reads), so
   the dry run the client fires next (POST /api/routines/run) sees an enabled routine. This
   owner-only API is the sole browser-facing write path; client autosave never writes it. */

import { requireAccountOwnerSession } from "@/lib/db/session";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import type { RoutineId } from "@/lib/runtime/types";
import { withErrorCapture } from "@/lib/observability/errors";
import { automationPauseResponse } from "@/lib/db/automationPause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  let body: { routineId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  if (!ROUTINE_ID_RE.test(routineId)) return Response.json({ error: "routineId must look like D0x-W0y" }, { status: 400 });
  if (!CATALOG_SPEC_BY_ID[routineId as RoutineId]) return Response.json({ error: `unknown routine ${routineId}` }, { status: 404 });
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const paused = await automationPauseResponse(session.service, session.accountId);
  if (paused) return paused;
  try {
    const store = getStore();
    const now = new Date().toISOString();
    const existing = await store.getRoutineState(session.accountId, routineId as RoutineId);
    const record = existing
      ? { ...existing, enabled: true, updatedAt: now }
      : { accountId: session.accountId, routineId: routineId as RoutineId, enabled: true, version: 1, draftSpec: null, liveSpec: null, updatedAt: now };
    const saved = existing?.enabled ? existing : await store.putRoutineState(record);
    return Response.json({ routineId: saved.routineId, enabled: saved.enabled, version: saved.version });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "enable failed" }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/setup/enable", handlePOST);
