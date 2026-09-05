import { requireAccountSession } from "@/lib/db/session";
import { captureArtifactContext, artifactFailure } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { unwrap } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { readWorkspace } from "@/lib/workspace/read";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  try {
    const identity = await captureArtifactContext(session.service, session.accountId, req);
    if (identity instanceof Response) return identity;
    const data = await readWorkspace(getStore(), identity.accountId, identity.contextGeneration);
    const membership = await unwrap<{ role: string } | null>("workspace.membership", session.service.from("account_members").select("role").eq("account_id", identity.accountId).eq("user_id", session.userId).maybeSingle());
    if (!membership) return Response.json({ error: "Account access changed. Sign in again." }, { status: 403 });
    const account = await unwrap<{ automation_paused: boolean }>("workspace.pause", session.service.from("accounts").select("automation_paused").eq("id", identity.accountId).single());
    await assertRuntimeContext(session.service, identity, { allowPaused: true });
    return Response.json({ ...data, canReview: membership.role === "owner" && !account.automation_paused, paused: account.automation_paused }, { headers: { "cache-control": "no-store" } });
  } catch (e) { return artifactFailure(e); }
}

export const GET = withErrorCapture("api/workspace", handleGET);
