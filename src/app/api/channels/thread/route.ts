/* GET /api/channels/thread?since=<ISO>&limit=<n> — the ONE conversation: every turn on the
   corner thread from the app and from every linked channel, oldest first.

   → { messages: [{ id, at, sender: "user"|"unc", body, channel: "app"|"telegram"|…, externalMsgId }], now }
   or { fallback: true } in demo mode · 401 / 403 / 503 { error }.

   The corner UI (src/components/platform/CornerBuddy.tsx) renders its own state for 'app'
   turns and merges the non-app rows from here, each with a small chip ("via Telegram") —
   see docs/CHANNELS.md §The chip. Reads under the member's own RLS. */

import { listThread } from "@/lib/channels/thread";
import { requireAccountSession } from "@/lib/db/session";
import { captureMemoryContext, contextChangedResponse } from "@/lib/db/contextGeneration";
import { RuntimeContextError } from "@/lib/runtime/contextFence";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  const requestedAccount = req.headers.get("x-unc-account-id");
  if (requestedAccount && requestedAccount !== session.accountId) return contextChangedResponse();
  const context = await captureMemoryContext(session.db, session.accountId, req);
  if (context instanceof Response) return context;
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;
  try {
    const messages = await listThread(session.db, session.accountId, { since, limit, contextGeneration: context.generation, includeAppAnchor: !since });
    return Response.json({ accountId: session.accountId, contextGeneration: context.generation, messages: messages.map((m) => ({ id: m.id, at: m.at, sender: m.sender, body: m.body, channel: m.channel, externalMsgId: m.externalMsgId, appPosition: m.appPosition })), now: new Date().toISOString() });
  } catch (err) {
    if (err instanceof RuntimeContextError && err.code === "context_changed") return contextChangedResponse();
    return Response.json({ error: "Couldn't verify your conversation. Please try again." }, { status: 503 });
  }
}

export const GET = withErrorCapture("api/channels/thread", async (req: Request) => {
  const response = await handleGET(req);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
