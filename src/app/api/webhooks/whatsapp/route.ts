/* /api/webhooks/whatsapp — Meta Cloud API (docs/CHANNELS.md §WhatsApp).
     GET   the subscription handshake (hub.mode / hub.verify_token / hub.challenge)
     POST  verify X-Hub-Signature-256 over the RAW body, persist the arrival, then acknowledge. */

import { acknowledgeInbound, receiveDeps } from "@/lib/channels/server";
import { receiveWhatsApp, receiveWhatsAppVerify, toResponse } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  return toResponse(receiveWhatsAppVerify(receiveDeps(req), new URL(req.url).searchParams));
}

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveWhatsApp(receiveDeps(req), { signature: req.headers.get("x-hub-signature-256"), rawBody });
  return acknowledgeInbound(r);
}

export const GET = withErrorCapture("api/webhooks/whatsapp", handleGET);
export const POST = withErrorCapture("api/webhooks/whatsapp", handlePOST);
