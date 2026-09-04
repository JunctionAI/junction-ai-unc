/* POST /api/webhooks/twilio — the number's "A message comes in" webhook (docs/CHANNELS.md
   §SMS). Verified FIRST on X-Twilio-Signature over APP_URL + this path + the form fields;
   answers empty TwiML at once (no auto-reply — Unc replies through the REST API after). */

import { after } from "next/server";
import { processInbound, receiveDeps, serviceDbOrNull } from "@/lib/channels/server";
import { commandsEnabled } from "@/lib/commands/types";
import { saveInboundEvents } from "@/lib/channels/inbox";
import { receiveTwilio, toResponse } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveTwilio(receiveDeps(req), { signature: req.headers.get("x-twilio-signature"), rawBody });
  if (r.events.length && commandsEnabled()) {
    const db = serviceDbOrNull();
    if (!db) return Response.json({ error: "message storage unavailable" }, { status: 503 });
    try { await saveInboundEvents(db, r.events); }
    catch { return Response.json({ error: "message was not acknowledged; retry with the same event ID" }, { status: 503 }); }
  } else if (r.events.length) after(() => processInbound(r.events));
  return toResponse(r);
}

export const POST = withErrorCapture("api/webhooks/twilio", handlePOST);
