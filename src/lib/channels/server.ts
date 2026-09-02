/* SERVER ONLY (imports next/headers through src/lib/db/server). Builds the channels deps
   from the real environment for the API routes and the webhooks: service-role client,
   keyring, adapters (env-gated), the process-wide Store, the accounts source, APP_URL. */

import { appUrlFor } from "@/lib/connectors/server";
import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import type { DbClient } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { defaultAccountsSource, envKeyring } from "@/worker/wiring";
import { availability, buildAdapters } from "./adapters/index";
import { handleInbound, type InboundDeps } from "./inbound";
import type { AdapterRegistry } from "./outbound";
import type { InboundEvent } from "./types";
import type { ReceiveDeps } from "./webhooks";

export const channelLog = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ event, ...fields }));

export function serviceDbOrNull(): DbClient | null {
  if (!isDbConfigured() || !isServiceRoleConfigured()) return null;
  try {
    return asDb(getServiceSupabase());
  } catch {
    return null;
  }
}

const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

export function envAdapters(db: DbClient | null): AdapterRegistry {
  return buildAdapters({ env: process.env, fetch: fetchFn, db, keyring: envKeyring(process.env) });
}

export function receiveDeps(req: Request): ReceiveDeps {
  return { env: process.env, now: () => new Date(), appUrl: appUrlFor(req) };
}

export function channelAvailability() {
  return availability(process.env);
}

/** null in demo mode (no database): webhooks verify and answer, but there is nothing to write to. */
export function inboundDeps(): InboundDeps | null {
  const db = serviceDbOrNull();
  if (!db) return null;
  return { db, store: getStore(), accounts: defaultAccountsSource(), adapters: envAdapters(db), now: () => new Date(), log: channelLog };
}

/** What the webhook routes run after the response went back. Never throws. */
export async function processInbound(events: InboundEvent[]): Promise<void> {
  if (!events.length) return;
  const deps = inboundDeps();
  if (!deps) {
    channelLog("channels.inbound_skipped", { reason: "no database", events: events.length });
    return;
  }
  for (const e of events) {
    try {
      const out = await handleInbound(deps, e);
      channelLog("channels.inbound", { channel: e.channel, outcome: out.kind });
    } catch (err) {
      channelLog("channels.inbound_failed", { channel: e.channel, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
