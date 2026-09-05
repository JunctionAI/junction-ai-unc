/* Slack install — "Add to Slack" from Channels. One Slack app; each founder installs it into
   their workspace, the bot token is sealed per team in channel_secrets, and the installing
   user becomes the linked destination (no code to type: OAuth proves the identity).

   State rides on the existing oauth_states table (platform 'slack_channel' so it never
   collides with the Slack *connector*), single-use, 10-minute TTL. */

import { consumeOauthState } from "../connectors/store";
import { seal, type Keyring } from "../connectors/crypto";
import { newState } from "../connectors/oauth";
import { unwrap, type DbClient, type Row } from "../db/types";
import { slackAuthorizeUrl, slackExchangeCode, type SlackConfig } from "./adapters/slack";
import { rowToLink } from "./links";
import type { ChannelLink, FetchLike } from "./types";

export const SLACK_STATE_PLATFORM = "slack_channel";
export const slackCallbackUri = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/api/channels/slack/callback`;

const safeRedirect = (v: string | null | undefined) => (v && /^\/app(?:[?#]|$)/.test(v) && !/[\\\r\n]/.test(v) ? v.slice(0, 200) : "/app");

export async function startSlackInstall(deps: { db: DbClient; config: SlackConfig; appUrl: string; accountId: string; actorId: string; now: Date; redirectTo?: string | null }): Promise<{ url: string; state: string }> {
  const state = newState();
  await unwrap("slack.install.begin", deps.db.rpc("begin_slack_install", { input: {
    state, accountId: deps.accountId, actorId: deps.actorId, redirectTo: safeRedirect(deps.redirectTo),
  } }));
  return { url: slackAuthorizeUrl(deps.config, slackCallbackUri(deps.appUrl), state), state };
}

export type FinishResult = { ok: true; link: ChannelLink; redirectTo: string } | { ok: false; reason: "bad_state" | "session_mismatch" | "denied" | "exchange_failed" | "no_keyring" | "save_unconfirmed"; redirectTo: string };

export async function finishSlackInstall(
  deps: { db: DbClient; keyring: Keyring | null; config: SlackConfig; fetch: FetchLike; appUrl: string; now: Date; userId: string | null; log?: (event: string, fields: Record<string, unknown>) => void },
  query: URLSearchParams,
): Promise<FinishResult> {
  const state = query.get("state") ?? "";
  const row = state ? await consumeOauthState(deps.db, state) : null;
  if (!row || row.platform !== SLACK_STATE_PLATFORM || !(new Date(row.expires_at).getTime() > deps.now.getTime())) return { ok: false, reason: "bad_state", redirectTo: "/app" };
  const redirectTo = safeRedirect(row.redirect_to);
  const context = row.auth_context as unknown as Row | null;
  if (!deps.userId || !context || context.protocol !== "slack_install_v1" || context.actorId !== deps.userId || context.accountId !== row.account_id
    || await unwrap("slack.install.check", deps.db.rpc("check_slack_install", { state_value: state, context_value: context, actor: deps.userId })) !== true) {
    return { ok: false, reason: "session_mismatch", redirectTo };
  }
  if (query.get("error") || !query.get("code")) return { ok: false, reason: "denied", redirectTo };
  if (!deps.keyring) return { ok: false, reason: "no_keyring", redirectTo };
  const install = await slackExchangeCode(deps.fetch, deps.config, query.get("code")!, slackCallbackUri(deps.appUrl));
  if (!install) return { ok: false, reason: "exchange_failed", redirectTo };
  let link: ChannelLink;
  try {
    const sealed = seal(JSON.stringify({ accessToken: install.botToken, botUserId: install.botUserId }), deps.keyring, `slack:${install.teamId}`);
    const result = await unwrap<Row>("slack.install.finish", deps.db.rpc("finish_slack_install", {
      state_value: state, context_value: context, actor: deps.userId, sealed,
      installation: { teamId: install.teamId, teamName: install.teamName, userId: install.userId, botUserId: install.botUserId },
    }));
    link = rowToLink(result);
    if (link.channel !== "slack" || link.slackRouteId || link.userId !== deps.userId || link.externalId !== install.userId
      || link.meta.team_id !== install.teamId || link.meta.bot_user_id !== install.botUserId || !link.verifiedAt) throw Error("Install readback mismatch");
  } catch {
    // The transaction may have committed despite a lost response. Never exchange
    // the single-use code again, overwrite the grant, or report fabricated success.
    return { ok: false, reason: "save_unconfirmed", redirectTo };
  }
  deps.log?.("channels.slack_installed", { accountId: link.accountId, teamId: install.teamId });
  // Consent is setup, never permission to send an unsolicited welcome.
  return { ok: true, link, redirectTo };
}
