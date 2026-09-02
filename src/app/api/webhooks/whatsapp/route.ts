/* /api/webhooks/whatsapp — Meta Cloud API (docs/CHANNELS.md §WhatsApp).
     GET   the subscription handshake (hub.mode / hub.verify_token / hub.challenge)
     POST  deliveries, verified FIRST on X-Hub-Signature-256 over the RAW body; 200 at once. */

import { after } from "next/server";
import { processInbound, receiveDeps } from "@/lib/channels/server";
import { receiveWhatsApp, receiveWhatsAppVerify, toResponse } from "@/lib/channels/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return toResponse(receiveWhatsAppVerify(receiveDeps(req), new URL(req.url).searchParams));
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const r = receiveWhatsApp(receiveDeps(req), { signature: req.headers.get("x-hub-signature-256"), rawBody });
  if (r.events.length) after(() => processInbound(r.events));
  return toResponse(r);
}
