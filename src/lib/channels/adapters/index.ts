/* Adapter registry from an env-shaped object. Each channel is present only when its env is
   complete; the UI reads `availability()` to show "Not switched on yet" honestly. Nothing here
   touches process.env at module load. */

import type { Keyring } from "../../connectors/crypto";
import type { DbClient } from "../../db/types";
import { mergeMeta } from "../links";
import type { AdapterRegistry } from "../outbound";
import { slackTokenResolver } from "../secrets";
import type { Channel, Env, FetchLike } from "../types";
import { SlackAdapter, slackConfig } from "./slack";
import { TelegramAdapter, telegramConfig } from "./telegram";
import { TwilioAdapter, twilioConfig } from "./twilio";
import { WhatsAppAdapter, whatsappConfig } from "./whatsapp";
import { TnzAdapter, tnzConfig } from "./tnz";
import { AppleAdapter, APPLE_SETUP_NOTE } from "./apple";
import { messagingDisabled, MESSAGING_DISABLED_NOTE } from "../releaseGate";

export interface AdapterInputs {
  env: Env;
  fetch: FetchLike;
  /** Slack needs the sealed bot token per workspace; absent → Slack sends fail closed. */
  db?: DbClient | null;
  keyring?: Keyring | null;
}

export function buildAdapters(inputs: AdapterInputs): AdapterRegistry {
  const { env, fetch } = inputs;
  if (messagingDisabled(env)) return {};
  const tokenFor = inputs.db ? slackTokenResolver(inputs.db, inputs.keyring ?? null) : async () => null;
  const db = inputs.db;
  return {
    apple: new AppleAdapter(),
    telegram: new TelegramAdapter(telegramConfig(env), fetch),
    whatsapp: new WhatsAppAdapter(whatsappConfig(env), fetch),
    slack: new SlackAdapter(slackConfig(env), fetch, tokenFor, db ? (linkId, dm) => mergeMeta(db, linkId, { dm_channel: dm }) : undefined),
    sms: env.SMS_PROVIDER === "tnz" ? new TnzAdapter(tnzConfig(env), fetch) : new TwilioAdapter(!env.SMS_PROVIDER || env.SMS_PROVIDER === "twilio" ? twilioConfig(env) : null, fetch),
  };
}

export interface ChannelAvailability {
  channel: Channel;
  configured: boolean;
  /** Public facts the connect step shows (bot username, the number to message). Never a token. */
  botUsername?: string | null;
  number?: string | null;
  setupNote?: string;
  pilotAccountId?: string;
}

export function availability(env: Env): ChannelAvailability[] {
  if (messagingDisabled(env)) return (["telegram", "whatsapp", "slack", "sms", "email", "apple"] as Channel[]).map(channel => ({ channel, configured: false, setupNote: MESSAGING_DISABLED_NOTE }));
  const tg = telegramConfig(env);
  const wa = whatsappConfig(env);
  const sl = slackConfig(env);
  const tw = twilioConfig(env);
  const tnz = tnzConfig(env);
  return [
    { channel: "telegram", configured: !!tg && !!tg.botUsername, botUsername: tg?.botUsername ?? null },
    { channel: "whatsapp", configured: !!wa && !!wa.displayNumber, number: wa?.displayNumber ?? null },
    { channel: "slack", configured: !!sl },
    env.SMS_PROVIDER === "tnz"
      ? { channel: "sms", configured: !!tnz, number: tnz?.number ?? null, ...(tnz ? { pilotAccountId: tnz.pilotAccountId } : {}), setupNote: tnz ? "NZ SMS pilot. One business per phone; carrier delivery still needs a real test." : "SMS setup is pending: the Unc number and secure provider connection must be activated." }
      : { channel: "sms", configured: (!env.SMS_PROVIDER || env.SMS_PROVIDER === "twilio") && !!tw, number: tw?.from ?? null },
    { channel: "email", configured: false },
    { channel: "apple", configured: false, setupNote: APPLE_SETUP_NOTE },
  ];
}
