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

export interface AdapterInputs {
  env: Env;
  fetch: FetchLike;
  /** Slack needs the sealed bot token per workspace; absent → Slack sends fail closed. */
  db?: DbClient | null;
  keyring?: Keyring | null;
}

export function buildAdapters(inputs: AdapterInputs): AdapterRegistry {
  const { env, fetch } = inputs;
  const tokenFor = inputs.db ? slackTokenResolver(inputs.db, inputs.keyring ?? null) : async () => null;
  const db = inputs.db;
  return {
    telegram: new TelegramAdapter(telegramConfig(env), fetch),
    whatsapp: new WhatsAppAdapter(whatsappConfig(env), fetch),
    slack: new SlackAdapter(slackConfig(env), fetch, tokenFor, db ? (linkId, dm) => mergeMeta(db, linkId, { dm_channel: dm }) : undefined),
    sms: new TwilioAdapter(twilioConfig(env), fetch),
  };
}

export interface ChannelAvailability {
  channel: Channel;
  configured: boolean;
  /** Public facts the connect step shows (bot username, the number to message). Never a token. */
  botUsername?: string | null;
  number?: string | null;
}

export function availability(env: Env): ChannelAvailability[] {
  const tg = telegramConfig(env);
  const wa = whatsappConfig(env);
  const sl = slackConfig(env);
  const tw = twilioConfig(env);
  return [
    { channel: "telegram", configured: !!tg && !!tg.botUsername, botUsername: tg?.botUsername ?? null },
    { channel: "whatsapp", configured: !!wa && !!wa.displayNumber, number: wa?.displayNumber ?? null },
    { channel: "slack", configured: !!sl },
    { channel: "sms", configured: !!tw, number: tw?.from ?? null },
    { channel: "email", configured: false },
  ];
}
