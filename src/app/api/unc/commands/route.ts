import { requireAccountOwnerSession } from "@/lib/db/session";
import { DbCommandQueue } from "@/lib/commands/queue";
import { unwrap } from "@/lib/db/types";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    const commands = await unwrap("commands.own", session.service.from("routine_commands").select("id, routine_id, version, status, reply, run_id, created_at").eq("account_id", session.accountId).eq("user_id", session.userId).order("created_at", { ascending: false }).limit(30));
    return Response.json({ commands }, { headers: { "cache-control": "no-store" } });
  }
  if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: "invalid request ID" }, { status: 400 });
  const c = await new DbCommandQueue(session.service).get(session.accountId, id);
  if (!c || c.actor.userId !== session.userId) return Response.json({ error: "request not found" }, { status: 404 });
  return Response.json({ commandId: c.id, routineId: c.routineId, version: c.version, status: c.status, reply: c.reply, runId: c.runId }, { headers: { "cache-control": "no-store" } });
}

export const GET = withErrorCapture("api/unc/commands", handleGET);
