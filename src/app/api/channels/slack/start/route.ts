/* GET /api/channels/slack/start?redirect_to=/app — "Add to Slack". Session-bound; writes a
   single-use state (oauth_states, platform slack_channel) and redirects to Slack's consent
   screen. 503 when Slack isn't configured (SLACK_CLIENT_ID / SECRET / SIGNING_SECRET). */

import { slackConfig } from "@/lib/channels/adapters/slack";
import { startSlackInstall } from "@/lib/channels/slackOauth";
import { appUrlFor } from "@/lib/connectors/server";
import { requireAccountOwnerSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const config = slackConfig(process.env);
  if (!config) return Response.json({ error: "Slack is not switched on yet" }, { status: 503 });
  const redirectTo = new URL(req.url).searchParams.get("redirect_to");
  try {
    const { url } = await startSlackInstall({ db: session.service, config, appUrl: appUrlFor(req), accountId: session.accountId, actorId: session.userId, now: new Date(), redirectTo });
    return Response.redirect(url, 302);
  } catch {
    return Response.json({ error: "Could not confirm Slack setup. Refresh before trying again." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}

export const GET = withErrorCapture("api/channels/slack/start", handleGET);
