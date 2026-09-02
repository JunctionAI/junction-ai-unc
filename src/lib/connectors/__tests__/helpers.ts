/* Shared fixtures for the connector tests: a fixed 32-byte key, an env with fake app
   credentials, a seeded fake DB (account + owner), and a routing fetch stub that records
   every call and never touches the network. */

import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { keyringFromKeys, type Keyring } from "../crypto";
import type { ConnectorConfig, HandlerDeps } from "../handlers";
import type { FetchLike } from "../oauth";

export const TEST_KEY = Buffer.alloc(32, 42);
export const KEYRING: Keyring = keyringFromKeys({ version: 1, key: TEST_KEY });

export const FAKE_ENV: Record<string, string> = {
  SHOPIFY_CLIENT_ID: "shopify-client-id",
  SHOPIFY_CLIENT_SECRET: "shopify-client-secret",
  KLAVIYO_CLIENT_ID: "klaviyo-client-id",
  KLAVIYO_CLIENT_SECRET: "klaviyo-client-secret",
  META_APP_ID: "meta-app-id",
  META_APP_SECRET: "meta-app-secret",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-fixture",
  HUBSPOT_CLIENT_ID: "hubspot-client-id",
  HUBSPOT_CLIENT_SECRET: "hubspot-client-secret",
};

export const APP_URL = "https://unc.test";
export const NOW = new Date("2026-09-02T09:00:00.000Z");

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Route = (call: RecordedCall) => Response | Promise<Response> | undefined;

/** fetch stub: routes are tried in order; the first that returns a Response wins; otherwise 404. */
export function stubFetch(routes: Route[] = []): { fetch: FetchLike; calls: RecordedCall[]; routes: Route[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && !(h instanceof Headers) && !Array.isArray(h)) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    const call: RecordedCall = { url: input, method: (init?.method ?? "GET").toUpperCase(), headers, body: typeof init?.body === "string" ? init.body : null };
    calls.push(call);
    for (const r of routes) {
      const res = await r(call);
      if (res) return res;
    }
    return new Response("not stubbed", { status: 404 });
  };
  return { fetch: fetchFn, calls, routes };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function seededDb(): { db: FakeSupabase; accountId: string; userId: string } {
  const db = new FakeSupabase();
  db.now = () => NOW.toISOString();
  db.userId = "user-1";
  const accountId = db.rpcs.create_account({ p_name: "Example Co", p_currency: "NZD" }) as string;
  return { db, accountId, userId: "user-1" };
}

export function config(overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return { appUrl: APP_URL, dbConfigured: true, keyring: KEYRING, env: FAKE_ENV, ...overrides };
}

export function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps & { logs: string[]; calls: RecordedCall[]; routes: Route[] } {
  const logs: string[] = [];
  const f = stubFetch();
  const base: HandlerDeps = { config: config(), db: null, userId: null, fetch: f.fetch, now: () => NOW, log: (l) => logs.push(l) };
  return { ...base, ...overrides, logs, calls: f.calls, routes: f.routes };
}

/** Every recorded log line and request URL must be free of these values. */
export function assertNoLeak(haystacks: string[], secrets: string[]) {
  for (const h of haystacks) for (const s of secrets) if (s && h.includes(s)) throw new Error(`secret "${s.slice(0, 6)}…" leaked into: ${h.slice(0, 120)}`);
}
