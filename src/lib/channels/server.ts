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
import { toResponse, type Received, type ReceiveDeps } from "./webhooks";
import { after } from "next/server";
import { saveInboundEvents, drainInboundEvents } from "./inbox";
import { messagingDisabled } from "./releaseGate";

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

/** HTTP success means the authenticated events and their original identity are durable.
 * after() only wakes the queue; it never carries raw events as a fallback. */
export async function acknowledgeInbound(received: Received): Promise<Response> {
  if (!received.events.length) return toResponse(received);
  const db = serviceDbOrNull();
  if (!db) return Response.json({ error: "message storage unavailable" }, { status: 503 });
  try { await saveInboundEvents(db, received.events); }
  catch { return Response.json({ error: "message was not acknowledged; retry with the same event ID" }, { status: 503 }); }
  try { after(() => processInbound()); } catch { /* already saved; the worker recovers */ }
  return toResponse(received);
}

/** A best-effort wake of durable work. Worker recovery uses the same atomic claim RPC. */
export async function processInbound(): Promise<void> {
  if (messagingDisabled(process.env)) return;
  const deps = inboundDeps();
  if (!deps) return;
  await drainInboundEvents(deps.db, async message => {
    const out = await handleInbound(deps, message);
    channelLog("channels.inbound", { channel: message.event.channel, outcome: out.kind });
  });
}
