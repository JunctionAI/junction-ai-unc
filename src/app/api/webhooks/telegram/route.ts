/* POST /api/webhooks/telegram — register with setWebhook (docs/CHANNELS.md §Telegram):
     url = https://<APP_URL>/api/webhooks/telegram, secret_token = TELEGRAM_WEBHOOK_SECRET
   Verify the secret, durably capture the arrival identity, then acknowledge; work runs after. */

import { acknowledgeInbound, receiveDeps } from "@/lib/channels/server";
import { receiveTelegram } from "@/lib/channels/webhooks";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const rawBody = await req.text();
  const r = receiveTelegram(receiveDeps(req), { secretToken: req.headers.get("x-telegram-bot-api-secret-token"), rawBody });
  return acknowledgeInbound(r);
}

export const POST = withErrorCapture("api/webhooks/telegram", handlePOST);
