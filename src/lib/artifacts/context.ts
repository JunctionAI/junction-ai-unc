import { accountContextGeneration, contextChangedResponse } from "../db/contextGeneration";
import { assertRuntimeContext } from "../db/runtimeContext";
import type { DbClient } from "../db/types";
import { RuntimeContextError } from "../runtime/contextFence";

export async function captureArtifactContext(db: DbClient, accountId: string, req: Request) {
  const contextGeneration = await accountContextGeneration(db, accountId);
  // These routes ship with their callers; no implicit current-account fallback.
  if (req.headers.get("x-unc-account-id") !== accountId ||
    req.headers.get("x-unc-context-generation") !== String(contextGeneration)) return contextChangedResponse();
  await assertRuntimeContext(db, { accountId, contextGeneration }, { allowPaused: true });
  return Object.freeze({ accountId, contextGeneration });
}

export function artifactFailure(err: unknown): Response {
  if (err instanceof RuntimeContextError) return Response.json({ error: err.message, code: err.code },
    { status: err.code === "context_unavailable" ? 503 : 409 });
  return Response.json({ error: "Couldn't verify this draft operation. Reload to check its state." }, { status: 503 });
}
