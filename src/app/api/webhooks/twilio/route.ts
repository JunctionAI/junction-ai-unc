/* POST /api/webhooks/twilio — the number's "A message comes in" webhook (docs/CHANNELS.md
   §SMS). Verified FIRST on X-Twilio-Signature over APP_URL + this path + the form fields;
   persists the verified arrival before answering empty TwiML; replies run separately. */

import { acknowledgeInbound, receiveDeps } from "@/lib/channels/server";
import { receiveTwilio } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveTwilio(receiveDeps(req), { signature: req.headers.get("x-twilio-signature"), rawBody });
  return acknowledgeInbound(r);
}

export const POST = withErrorCapture("api/webhooks/twilio", handlePOST);
