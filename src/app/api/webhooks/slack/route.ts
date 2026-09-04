/* POST /api/webhooks/slack — ONE URL for the Events API (message.im, app_mention) and
   Interactivity (block_actions). Register it as both the Event Subscriptions Request URL and
   the Interactivity Request URL (docs/CHANNELS.md §Slack). Verified FIRST on
   X-Slack-Signature / X-Slack-Request-Timestamp; url_verification answered inline; 200 at
   once (Slack's 3-second rule); the work runs after. */

import { after } from "next/server";
import { processInbound, receiveDeps, serviceDbOrNull } from "@/lib/channels/server";
import { commandsEnabled } from "@/lib/commands/types";
import { saveInboundEvents } from "@/lib/channels/inbox";
import { receiveSlack, toResponse } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveSlack(receiveDeps(req), { signature: req.headers.get("x-slack-signature"), timestamp: req.headers.get("x-slack-request-timestamp"), contentType: req.headers.get("content-type"), rawBody });
  if (r.events.length && commandsEnabled()) {
    const db = serviceDbOrNull();
    if (!db) return Response.json({ error: "message storage unavailable" }, { status: 503 });
    try { await saveInboundEvents(db, r.events); }
    catch { return Response.json({ error: "message was not acknowledged; retry with the same event ID" }, { status: 503 }); }
  } else if (r.events.length) after(() => processInbound(r.events));
  return toResponse(r);
}

export const POST = withErrorCapture("api/webhooks/slack", handlePOST);
