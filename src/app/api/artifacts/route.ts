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
  if (isDbConfigured()) {
    const session = await requireAccountSession();
    if (session instanceof Response) return session;
    accountId = session.accountId;
    try {
      channels = [...new Set((await verifiedLinks(session.service, accountId)).map((l) => l.channel))];
    } catch {
      channels = [];
    }
  }
  try {
    const artifacts = await listArtifactsForAccount({ store: getStore() }, accountId, { routineId, limit });
    return Response.json({ artifacts, channels }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "listing failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/artifacts", handleGET);
