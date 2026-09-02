/* GET /api/channels/slack/start?redirect_to=/app — "Add to Slack". Session-bound; writes a
   single-use state (oauth_states, platform slack_channel) and redirects to Slack's consent
   screen. 503 when Slack isn't configured (SLACK_CLIENT_ID / SECRET / SIGNING_SECRET). */

import { slackConfig } from "@/lib/channels/adapters/slack";
import { startSlackInstall } from "@/lib/channels/slackOauth";
import { appUrlFor } from "@/lib/connectors/server";
import { requireAccountSession } from "@/lib/db/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const config = slackConfig(process.env);
  if (!config) return Response.json({ error: "Slack is not switched on yet" }, { status: 503 });
  const redirectTo = new URL(req.url).searchParams.get("redirect_to");
  try {
    const { url } = await startSlackInstall({ db: session.service, config, appUrl: appUrlFor(req), accountId: session.accountId, now: new Date(), redirectTo });
    return Response.redirect(url, 302);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "could not start the Slack install" }, { status: 500 });
  }
}
