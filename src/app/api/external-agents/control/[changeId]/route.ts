import { asDb } from "@/lib/db/client";
import { getServiceSupabase } from "@/lib/db/server";
import { requireAccountSession } from "@/lib/db/session";
import { readGrokChange, receiveGrokAck } from "@/lib/agents/grokControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ changeId: string }> };
export async function POST(request: Request, context: Context) {
  return receiveGrokAck(request, (await context.params).changeId, {
    db: () => asDb(getServiceSupabase()), secret: process.env.JUNCTION_GROK_CONTROL_SECRET ?? "",
    enabled: process.env.JUNCTION_GROK_CONTROL_ENABLED === "true",
  });
}
export async function GET(request: Request, context: Context) {
  const session = await requireAccountSession(request);
  if (session instanceof Response) return session.status === 200
    ? Response.json({ error: "Account storage unavailable" }, { status: 503 }) : session;
  try {
    const result = await readGrokChange(session.service, (await context.params).changeId, session.accountId);
    return Response.json(result ?? { error: "Change not found" }, { status: result ? 200 : 404,
      headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: "Could not verify agent status" }, { status: 503,
    headers: { "cache-control": "private, no-store" } }); }
}
