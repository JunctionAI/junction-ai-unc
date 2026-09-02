/* SERVER ONLY — imports next/headers through src/lib/db/server. Builds HandlerDeps for the
   API routes from the real environment: session user via the cookie client, service-role
   client for the secret tables, keyring from CONNECTOR_SECRET_KEY, base URL from APP_URL. */

import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { keyringFromEnv } from "./crypto";
import type { ConnectorConfig, HandlerDeps } from "./handlers";

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
  return {
    config,
    db,
    userId,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    log: (line) => console.log(`[connectors] ${line}`),
  };
}
