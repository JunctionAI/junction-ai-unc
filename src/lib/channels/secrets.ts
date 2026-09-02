/* channel_secrets — per-workspace tokens (today: the Slack bot token per team), sealed with
   the connector keyring (src/lib/connectors/crypto.ts, CONNECTOR_SECRET_KEY). AAD binds the
   ciphertext to "<channel>:<scope_id>" so a row copied onto another workspace does not open.
   Service role only; plaintext never leaves this module except to the adapter. */

import { open, seal, type Keyring } from "../connectors/crypto";
import { unwrap, type DbClient } from "../db/types";
import type { Channel } from "./types";

export interface ChannelSecretBundle {
  accessToken: string;
  /** Extra non-secret facts kept with the token (Slack: bot_user_id). */
  [k: string]: unknown;
}

const aad = (channel: Channel, scopeId: string) => `${channel}:${scopeId}`;

export async function putChannelSecret(db: DbClient, keyring: Keyring, input: { accountId: string; channel: Channel; scopeId: string; bundle: ChannelSecretBundle; now: Date }): Promise<void> {
  const sealed = seal(JSON.stringify(input.bundle), keyring, aad(input.channel, input.scopeId));
  await unwrap(
    "channel_secrets.upsert",
    db
      .from("channel_secrets")
      .upsert({ account_id: input.accountId, channel: input.channel, scope_id: input.scopeId, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion, updated_at: input.now.toISOString() }, { onConflict: "channel,scope_id" }),
  );
}

export async function getChannelSecret(db: DbClient, keyring: Keyring, channel: Channel, scopeId: string): Promise<ChannelSecretBundle | null> {
  const row = await unwrap<{ ciphertext: string; iv: string; tag: string; key_version: number } | null>(
    "channel_secrets.select",
    db.from("channel_secrets").select("ciphertext, iv, tag, key_version").eq("channel", channel).eq("scope_id", scopeId).maybeSingle(),
  );
  if (!row) return null;
  const plain = open({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version }, keyring, aad(channel, scopeId));
  const parsed = JSON.parse(plain) as ChannelSecretBundle;
  return typeof parsed?.accessToken === "string" ? parsed : null;
}

export async function deleteChannelSecret(db: DbClient, channel: Channel, scopeId: string): Promise<void> {
  await unwrap("channel_secrets.delete", db.from("channel_secrets").delete().eq("channel", channel).eq("scope_id", scopeId));
}

/** Slack bot-token resolver for the adapter; a missing keyring or an unopenable row reads as "no token". */
export function slackTokenResolver(db: DbClient, keyring: Keyring | null): (teamId: string) => Promise<string | null> {
  return async (teamId) => {
    if (!keyring) return null;
    try {
      const b = await getChannelSecret(db, keyring, "slack", teamId);
      return b?.accessToken ?? null;
    } catch {
      return null;
    }
  };
}
