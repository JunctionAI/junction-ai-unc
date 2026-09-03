/* POST /api/webhooks/telegram — register with setWebhook (docs/CHANNELS.md §Telegram):
     url = https://<APP_URL>/api/webhooks/telegram, secret_token = TELEGRAM_WEBHOOK_SECRET
   Verified FIRST on X-Telegram-Bot-Api-Secret-Token; 200 at once; the work runs after. */

import { after } from "next/server";
import { processInbound, receiveDeps } from "@/lib/channels/server";
import { receiveTelegram, toResponse } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveTelegram(receiveDeps(req), { secretToken: req.headers.get("x-telegram-bot-api-secret-token"), rawBody });
  if (r.events.length) after(() => processInbound(r.events));
  return toResponse(r);
}

export const POST = withErrorCapture("api/webhooks/telegram", handlePOST);
