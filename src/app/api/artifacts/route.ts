/* GET /api/artifacts[?routineId=D0x-W0y&limit=n] — what Unc drafted, newest first.

   →  { artifacts: ArtifactView[], channels: string[] }   channels = the account's verified
                                                          channel links (for "Send me this on …")
   or { fallback: true } demo mode without an accountId · 401 | 403 | 503 { error }

   DB configured → session-bound (the caller's own account). Demo mode → ?accountId= (default
   "demo") against the process-wide MemoryStore. */

import { listArtifactsForAccount } from "@/lib/artifacts/handlers";
import { verifiedLinks } from "@/lib/channels/links";
import { isDbConfigured } from "@/lib/db/client";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { withErrorCapture } from "@/lib/observability/errors";
import { captureArtifactContext, artifactFailure } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import type { DbClient } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const routineId = url.searchParams.get("routineId") ?? undefined;
  if (routineId && !ROUTINE_ID_RE.test(routineId)) return Response.json({ error: "routineId must look like D0x-W0y" }, { status: 400 });
  const limitRaw = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(50, limitRaw) : undefined;

  let accountId = (url.searchParams.get("accountId") ?? "demo").trim().slice(0, 128);
  let channels: string[] = [];
  let contextGeneration: number | undefined;
  let db: DbClient | undefined;
  try {
    if (isDbConfigured()) {
      const session = await requireAccountSession(req);
      if (session instanceof Response) return session;
      accountId = session.accountId;
      db = session.service;
      const identity = await captureArtifactContext(db, accountId, req);
      if (identity instanceof Response) return identity;
      contextGeneration = identity.contextGeneration;
      try {
        channels = [...new Set((await verifiedLinks(session.service, accountId)).filter(l => l.userId === session.userId && l.channel !== "apple").map((l) => l.channel))];
      } catch {
        channels = [];
      }
    }
    const artifacts = await listArtifactsForAccount({ store: getStore(), contextGeneration }, accountId, { routineId, limit });
    if (db) await assertRuntimeContext(db, { accountId, contextGeneration }, { allowPaused: true });
    return Response.json({ accountId, contextGeneration, artifacts, channels }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return artifactFailure(err);
  }
}

export const GET = withErrorCapture("api/artifacts", handleGET);
