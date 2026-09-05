/* SERVER ONLY — imports next/headers through src/lib/db/server. Builds HandlerDeps for the
   API routes from the real environment: session user via the cookie client, service-role
   client for the secret tables, keyring from CONNECTOR_SECRET_KEY, base URL from APP_URL. */

import { after } from "next/server";
import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { keyringFromEnv } from "./crypto";
import { readNowAfterConnect } from "./firstRead";
import type { ConnectorConfig, HandlerDeps } from "./handlers";
import { getProvisioner } from "./provisioning";
import { ACCOUNT_SELECTION_HEADER } from "../db/accountSelection";

/** APP_URL wins (must match the registered redirect URIs exactly); the request origin is the
    local-dev fallback. */
export function appUrlFor(req: Request): string {
  const env = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  return new URL(req.url).origin;
}

export function connectorConfig(req: Request): ConnectorConfig {
  let keyring = null;
  try {
    keyring = keyringFromEnv();
  } catch {
    // A present-but-malformed key reads as "not configured" for the founder; the docs cover the fix.
    keyring = null;
  }
  return { appUrl: appUrlFor(req), dbConfigured: isDbConfigured() && isServiceRoleConfigured(), keyring, env: process.env };
}

export async function handlerDeps(req: Request): Promise<HandlerDeps> {
  const config = connectorConfig(req);
  let userId: string | null = null;
  let db = null;
  if (config.dbConfigured) {
    const session = await getServerSupabase();
    if (session) {
      const {
        data: { user },
      } = await session.auth.getUser();
      userId = user?.id ?? null;
    }
    db = asDb(getServiceSupabase());
  }
  const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);
  const now = () => new Date();
  const log = (line: string) => console.log(`[connectors] ${line}`);
  const service = db;
  const keyring = config.keyring;
  return {
    config,
    db,
    userId,
    requestedAccountId: req.headers.get(ACCOUNT_SELECTION_HEADER),
    fetch: fetchFn,
    now,
    log,
    provisioner: db ? getProvisioner({ db, fetch: fetchFn, now, log }, process.env) : undefined,
    /* First read runs after the response is sent (next/server `after`),
       so the founder sees Connected at once and the card polls /api/connectors/state for
       Reading… → Read ✓. A failure lands as a receipt + error:first_read, never a thrown error. */
    onConnected:
      service && keyring
        ? ({ accountId, platform, connectorId, contextGeneration, externalRef }) => {
            after(async () => {
              try {
                await readNowAfterConnect({ db: service, keyring, env: process.env, fetch: fetchFn, now, log }, accountId, platform,
                  { connectorId, contextGeneration, externalRef, initiatedBy: userId });
              } catch (e) {
                log(`first_read platform=${platform} account=${accountId} result=threw ${e instanceof Error ? e.name : "error"}`);
              }
            });
          }
        : undefined,
  };
}
