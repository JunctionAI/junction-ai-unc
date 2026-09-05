import { requireAccountSession } from "@/lib/db/session";
import { captureArtifactContext, artifactFailure } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { unwrap } from "@/lib/db/types";
import { readWorkspaceHistory, HistoryCursorError } from "@/lib/workspace/history";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateResponse = (r: Response) => { r.headers.set("cache-control", "private, no-store"); r.headers.set("vary", "Cookie, Authorization"); return r; };
async function handleGET(req: Request) {
  try {
    const session = await requireAccountSession();
    if (session instanceof Response) return privateResponse(session);
    const identity = await captureArtifactContext(session.service, session.accountId, req);
    if (identity instanceof Response) return privateResponse(identity);
    const params = new URL(req.url).searchParams;
    if ([...params.keys()].some(k => k !== "cursor") || params.getAll("cursor").length > 1) throw new HistoryCursorError("Invalid history request.");
    const page = await readWorkspaceHistory(session.service, session.accountId, session.userId, identity.contextGeneration, params.get("cursor"));
    const member = await unwrap<{ role: string } | null>("history.membership", session.service.from("account_members")
      .select("role").eq("account_id", session.accountId).eq("user_id", session.userId).maybeSingle());
    if (!member || !["owner", "member"].includes(member.role)) return privateResponse(Response.json({ error: "Account access changed. Sign in again." }, { status: 403 }));
    await assertRuntimeContext(session.service, identity, { allowPaused: true });
    return privateResponse(Response.json(page));
  } catch (error) {
    return privateResponse(error instanceof HistoryCursorError ? Response.json({ error: error.message }, { status: 400 }) : artifactFailure(error));
  }
}
export const GET = withErrorCapture("api/workspace/history", handleGET);
