/* GET /api/channels/thread?since=<ISO>&limit=<n> — the ONE conversation: every turn on the
   corner thread from the app and from every linked channel, oldest first.

   → { messages: [{ id, at, sender: "user"|"unc", body, channel: "app"|"telegram"|…, externalMsgId }], now }
   or { fallback: true } in demo mode · 401 / 403 / 503 { error }.

   The corner UI (src/components/platform/CornerBuddy.tsx) renders its own state for 'app'
   turns and merges the non-app rows from here, each with a small chip ("via Telegram") —
   see docs/CHANNELS.md §The chip. Reads under the member's own RLS. */

import { listThread } from "@/lib/channels/thread";
import { requireAccountSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;
  try {
    const messages = await listThread(session.db, session.accountId, { since, limit });
    return Response.json({ messages: messages.map((m) => ({ id: m.id, at: m.at, sender: m.sender, body: m.body, channel: m.channel, externalMsgId: m.externalMsgId })), now: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "thread read failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/channels/thread", handleGET);
