/* GET /api/channels/slack/callback — Slack sends the founder back here with ?code&state.
   Register this exact URL as the app's Redirect URL: https://<APP_URL>/api/channels/slack/callback
   The state is consumed (single-use), the code exchanged for the workspace's bot token (sealed
   into channel_secrets), and the installing user linked. Always redirects back into the app
   with ?channel=slack&linked=1 or &error=<reason>. */

import { slackConfig } from "@/lib/channels/adapters/slack";
import { channelLog, envAdapters, serviceDbOrNull } from "@/lib/channels/server";
import { finishSlackInstall } from "@/lib/channels/slackOauth";
import { appUrlFor } from "@/lib/connectors/server";
import { getServerSupabase } from "@/lib/db/server";
import { envKeyring } from "@/worker/wiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const appUrl = appUrlFor(req);
  const back = (to: string, q: Record<string, string>) => Response.redirect(`${appUrl}${to}${to.includes("?") ? "&" : "?"}${new URLSearchParams(q).toString()}`, 302);
  const config = slackConfig(process.env);
  const db = serviceDbOrNull();
  if (!config || !db) return back("/app", { channel: "slack", error: "not_configured" });
  let userId: string | null = null;
  try {
    const supabase = await getServerSupabase();
    userId = supabase ? ((await supabase.auth.getUser()).data.user?.id ?? null) : null;
  } catch {
    userId = null;
  }
  const r = await finishSlackInstall({ db, keyring: envKeyring(process.env), config, fetch: (input, init) => fetch(input, init), appUrl, now: new Date(), userId, adapters: envAdapters(db), log: channelLog }, new URL(req.url).searchParams);
  return r.ok ? back(r.redirectTo, { channel: "slack", linked: "1" }) : back(r.redirectTo, { channel: "slack", error: r.reason });
}
