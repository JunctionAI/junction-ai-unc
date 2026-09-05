/* Slack install — "Add to Slack" from Channels. One Slack app; each founder installs it into
   their workspace, the bot token is sealed per team in channel_secrets, and the installing
   user becomes the linked destination (no code to type: OAuth proves the identity).

   State rides on the existing oauth_states table (platform 'slack_channel' so it never
   collides with the Slack *connector*), single-use, 10-minute TTL. */

import { consumeOauthState, insertOauthState, memberRole } from "../connectors/store";
import type { Keyring } from "../connectors/crypto";
import { newState, STATE_TTL_MS } from "../connectors/oauth";
import type { DbClient } from "../db/types";
import { slackAuthorizeUrl, slackExchangeCode, type SlackConfig } from "./adapters/slack";
import { upsertVerifiedLink, welcomeLine } from "./links";
import { sendOnLink, type AdapterRegistry } from "./outbound";
import { putChannelSecret } from "./secrets";
import type { ChannelLink, FetchLike } from "./types";

export const SLACK_STATE_PLATFORM = "slack_channel";
export const slackCallbackUri = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/api/channels/slack/callback`;

const safeRedirect = (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") ? v.slice(0, 200) : "/app");

export async function startSlackInstall(deps: { db: DbClient; config: SlackConfig; appUrl: string; accountId: string; now: Date; redirectTo?: string | null }): Promise<{ url: string; state: string }> {
  const state = newState();
  await insertOauthState(deps.db, {
    state,
    account_id: deps.accountId,
    platform: SLACK_STATE_PLATFORM,
    code_verifier: null,
    shop: null,
    redirect_to: safeRedirect(deps.redirectTo),
    created_at: deps.now.toISOString(),
    expires_at: new Date(deps.now.getTime() + STATE_TTL_MS).toISOString(),
  });
  return { url: slackAuthorizeUrl(deps.config, slackCallbackUri(deps.appUrl), state), state };
}

export type FinishResult = { ok: true; link: ChannelLink; redirectTo: string } | { ok: false; reason: "bad_state" | "session_mismatch" | "denied" | "exchange_failed" | "no_keyring"; redirectTo: string };

export async function finishSlackInstall(
  deps: { db: DbClient; keyring: Keyring | null; config: SlackConfig; fetch: FetchLike; appUrl: string; now: Date; userId: string | null; adapters?: AdapterRegistry; log?: (event: string, fields: Record<string, unknown>) => void },
  query: URLSearchParams,
): Promise<FinishResult> {
  const state = query.get("state") ?? "";
  const row = state ? await consumeOauthState(deps.db, state) : null;
  if (!row || row.platform !== SLACK_STATE_PLATFORM || !(new Date(row.expires_at).getTime() > deps.now.getTime())) return { ok: false, reason: "bad_state", redirectTo: "/app" };
  const redirectTo = safeRedirect(row.redirect_to);
  if (!deps.userId || (await memberRole(deps.db, deps.userId, row.account_id)) !== "owner") {
    return { ok: false, reason: "session_mismatch", redirectTo };
  }
  if (query.get("error") || !query.get("code")) return { ok: false, reason: "denied", redirectTo };
  if (!deps.keyring) return { ok: false, reason: "no_keyring", redirectTo };
  const install = await slackExchangeCode(deps.fetch, deps.config, query.get("code")!, slackCallbackUri(deps.appUrl));
  if (!install) return { ok: false, reason: "exchange_failed", redirectTo };
  await putChannelSecret(deps.db, deps.keyring, { accountId: row.account_id, channel: "slack", scopeId: install.teamId, bundle: { accessToken: install.botToken, botUserId: install.botUserId }, now: deps.now });
  const link = await upsertVerifiedLink(deps.db, {
    accountId: row.account_id,
    userId: deps.userId,
    channel: "slack",
    externalId: install.userId,
    handle: install.teamName,
    displayName: install.teamName,
    meta: { team_id: install.teamId, team_name: install.teamName, bot_user_id: install.botUserId },
    now: deps.now,
  });
  deps.log?.("channels.slack_installed", { accountId: row.account_id, teamId: install.teamId });
  if (deps.adapters) {
    try {
      await sendOnLink({ db: deps.db, adapters: deps.adapters, now: () => deps.now, log: deps.log }, link, "link", { text: welcomeLine("slack") }, { ref: `install:${link.id}:${link.bindingVersion}`, appendToThread: false });
    } catch (err) {
      deps.log?.("channels.slack_welcome_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, link, redirectTo };
}
