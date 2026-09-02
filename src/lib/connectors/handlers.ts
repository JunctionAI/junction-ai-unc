/* The Connect flow, as two pure-ish handlers the API routes wrap:

     handleStart    POST /api/connectors/<platform>/start     → { url } | { fallback, reason } | error
     handleCallback GET  /api/connectors/<platform>/callback  → redirect path

   Everything the routes need from Next (session user, service client, env) arrives through
   HandlerDeps so the tests run the same code against the schema-checked fake with a stubbed
   fetch — no live platform, no network.

   Gates, in order (start):
     platform known → flow exists + client id/secret present → secret store configured →
     accounts (DB) configured → session → membership → (Shopify) valid shop domain.
   Any "not switched on" answer is { fallback: true, reason } with 200 so the UI can say so
   honestly; only malformed input / missing session are real errors.

   Callback never shows the founder a stack trace: every failure lands on
   /app?connect_error=<platform> with the connector row in status 'error' and
   last_sync_result 'error:oauth' when we know which row it was. Tokens are sealed straight
   into connector_secrets and appear in no log, no response and no redirect. */

import type { DbClient } from "@/lib/db/types";
import { seal, type Keyring } from "./crypto";
import { bundleFromResponse, callbackUri, codeChallenge, exchangeCode, exchangeMetaLongLived, newCodeVerifier, newState, STATE_TTL_MS, verifyShopifyHmac, type FetchLike, type TokenBundle } from "./oauth";
import { connectorEntry, normaliseShopDomain, platformCredentials, type ConnectorEntry } from "./registry";
import { insertSystemReceipt } from "@/lib/db/receipts";
import { accountForUser, consumeOauthState, deleteSecret, getConnector, insertOauthState, isMember, putSecret, updateConnector, upsertConnector } from "./store";

export interface ConnectorConfig {
  /** Public base URL the callbacks are registered under (APP_URL), no trailing slash. */
  appUrl: string;
  dbConfigured: boolean;
  keyring: Keyring | null;
  /** Env-shaped map the registry reads client ids/secrets from (process.env in production). */
  env: Record<string, string | undefined>;
}

export interface HandlerDeps {
  config: ConnectorConfig;
  /** Service-role client; null when the DB isn't configured. */
  db: DbClient | null;
  /** Session user id; null when there is no session. */
  userId: string | null;
  fetch: FetchLike;
  now: () => Date;
  /** Diagnostics only — receives codes, never values. */
  log?: (line: string) => void;
}

export type FallbackReason = "unknown_platform" | "platform_not_configured" | "secret_store_not_configured" | "accounts_not_configured";

export type StartResult = { status: 200; body: { url: string } } | { status: 200; body: { fallback: true; reason: FallbackReason } } | { status: 400 | 401 | 403 | 404; body: { error: string } };

const fallback = (reason: FallbackReason): StartResult => ({ status: 200, body: { fallback: true, reason } });
const err = (status: 400 | 401 | 403 | 404, error: string): StartResult => ({ status, body: { error } });

export async function handleStart(deps: HandlerDeps, platform: string, body: unknown): Promise<StartResult> {
  const entry = connectorEntry(platform);
  if (!entry) return err(404, "unknown platform");
  if (entry.flow === "none") return fallback("platform_not_configured");
  const creds = platformCredentials(platform, deps.config.env);
  if (!creds) return fallback("platform_not_configured");
  if (!deps.config.keyring) return fallback("secret_store_not_configured");
  if (!deps.config.dbConfigured || !deps.db) return fallback("accounts_not_configured");
  if (!deps.userId) return err(401, "sign in first");
  const accountId = await accountForUser(deps.db, deps.userId);
  if (!accountId) return err(403, "no account for this user");

  let shop: string | undefined;
  if (entry.flow === "shopify") {
    const raw = body && typeof body === "object" ? (body as { shop?: unknown }).shop : undefined;
    const s = normaliseShopDomain(raw);
    if (!s) return err(400, "shop must be a your-store.myshopify.com domain");
    shop = s;
  }

  const now = deps.now();
  const state = newState();
  const verifier = entry.pkce ? newCodeVerifier() : null;
  await insertOauthState(deps.db, {
    state,
    account_id: accountId,
    platform: entry.id,
    code_verifier: verifier,
    shop: shop ?? null,
    redirect_to: "/app",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
  });
  // Mark the row as in flight so a stale card reads "connecting" rather than "connected".
  await upsertConnector(deps.db, accountId, entry.id, { status: "connecting" });

  const url = entry.authorizeUrl({
    clientId: creds.clientId,
    redirectUri: callbackUri(deps.config.appUrl, entry.id),
    state,
    scopes: entry.scopes,
    codeChallenge: verifier ? codeChallenge(verifier) : undefined,
    shop,
  });
  deps.log?.(`connectors.start platform=${entry.id} account=${accountId}`);
  return { status: 200, body: { url } };
}

// ---------- callback ----------

export interface CallbackResult {
  redirect: string;
}

const okRedirect = (platform: string) => ({ redirect: `/app?connected=${encodeURIComponent(platform)}` });
const errRedirect = (platform: string) => ({ redirect: `/app?connect_error=${encodeURIComponent(platform)}` });

export async function handleCallback(deps: HandlerDeps, platform: string, requestUrl: string): Promise<CallbackResult> {
  const entry = connectorEntry(platform);
  if (!entry || entry.flow === "none") return errRedirect(platform);
  if (!deps.config.dbConfigured || !deps.db) return { redirect: "/app" };
  const db = deps.db;

  const params = new URL(requestUrl).searchParams;
  const state = params.get("state") || "";
  if (!state) return errRedirect(entry.id);

  // Single-use: consumed before anything else is checked so a replay can't pass.
  const row = await consumeOauthState(db, state).catch(() => null);
  if (!row || row.platform !== entry.id) {
    deps.log?.(`connectors.callback platform=${entry.id} reason=bad_state`);
    return errRedirect(entry.id);
  }
  const now = deps.now();
  const accountId = row.account_id;
  const fail = async (reason: string) => {
    deps.log?.(`connectors.callback platform=${entry.id} account=${accountId} reason=${reason}`);
    try {
      await upsertConnector(db, accountId, entry.id, { status: "error", last_sync_result: "error:oauth" });
    } catch {
      /* the redirect is still the right answer */
    }
    return errRedirect(entry.id);
  };

  if (new Date(row.expires_at).getTime() < now.getTime()) return fail("state_expired");
  // The browser that finishes the flow must be the founder who started it.
  if (!deps.userId || !(await isMember(db, deps.userId, accountId))) return fail("session_mismatch");
  if (params.get("error")) return fail("provider_denied");
  const code = params.get("code") || "";
  if (!code) return fail("no_code");

  const creds = platformCredentials(entry.id, deps.config.env);
  const keyring = deps.config.keyring;
  if (!creds || !keyring) return fail("not_configured");

  let shop: string | undefined;
  if (entry.flow === "shopify") {
    if (!verifyShopifyHmac(params, creds.clientSecret)) return fail("bad_hmac");
    const cbShop = normaliseShopDomain(params.get("shop"));
    if (!cbShop || cbShop !== row.shop) return fail("shop_mismatch");
    shop = cbShop;
  }

  try {
    const redirectUri = callbackUri(deps.config.appUrl, entry.id);
    let tokens = await exchangeCode(deps.fetch, entry, { code, redirectUri, clientId: creds.clientId, clientSecret: creds.clientSecret, codeVerifier: row.code_verifier ?? undefined, shop });
    if (entry.id === "meta_ads") {
      // Long-lived (~60 day) token; keep the short-lived one if the exchange is refused.
      try {
        tokens = await exchangeMetaLongLived(deps.fetch, entry, { accessToken: tokens.access_token, clientId: creds.clientId, clientSecret: creds.clientSecret });
      } catch {
        deps.log?.(`connectors.callback platform=meta_ads account=${accountId} note=long_lived_exchange_failed`);
      }
    }
    const bundle = bundleFromResponse(tokens, now);
    const externalRef = shop ?? (await identifyExternalRef(deps.fetch, entry, bundle));

    const connectorId = await upsertConnector(db, accountId, entry.id, { status: "connected", external_ref: externalRef });
    await putSecret(db, connectorId, seal(JSON.stringify(bundle), keyring, connectorId), now.toISOString());
    deps.log?.(`connectors.callback platform=${entry.id} account=${accountId} result=connected`);
    return okRedirect(entry.id);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "unexpected";
    return fail(`exchange_${code}`);
  }
}

// ---------- disconnect ----------

export type DisconnectResult = { status: 200; body: { ok: true; status: "disconnected" } } | { status: 200; body: { fallback: true; reason: FallbackReason } } | { status: 401 | 403 | 404; body: { error: string } };

/** Forget a connection: delete the sealed token, mark the row disconnected, leave a receipt.
    The platform-side revoke (the founder's connected-apps page) is theirs; the receipt says so.
    Gates mirror start: platform known → DB → session → membership → a row to disconnect. */
export async function handleDisconnect(deps: HandlerDeps, platform: string): Promise<DisconnectResult> {
  const entry = connectorEntry(platform);
  if (!entry) return { status: 404, body: { error: "unknown platform" } };
  if (!deps.config.dbConfigured || !deps.db) return { status: 200, body: { fallback: true, reason: "accounts_not_configured" } };
  if (!deps.userId) return { status: 401, body: { error: "sign in first" } };
  const accountId = await accountForUser(deps.db, deps.userId);
  if (!accountId) return { status: 403, body: { error: "no account for this user" } };
  const row = await getConnector(deps.db, accountId, entry.id);
  if (!row) return { status: 404, body: { error: "nothing connected" } };

  const now = deps.now().toISOString();
  await deleteSecret(deps.db, row.id);
  await updateConnector(deps.db, row.id, { status: "disconnected", last_sync_result: null });
  await insertSystemReceipt(deps.db, {
    accountId,
    kind: "notification",
    platform: entry.id,
    description: `${entry.name} disconnected — token deleted from the secret store; reads on it stop now. Revoke the app on ${entry.name}’s side too if you want it gone there.`,
    payload: { connector_id: row.id, platform: entry.id, previous_status: row.status, external_ref: row.external_ref },
    now,
  });
  deps.log?.(`connectors.disconnect platform=${entry.id} account=${accountId}`);
  return { status: 200, body: { ok: true, status: "disconnected" } };
}

// ---------- external_ref discovery (best-effort, never fatal) ----------

const IDENTIFY_TIMEOUT_MS = 5_000;

/** Meta: the ad account when the user manages exactly one; Klaviyo: the account id.
    Google: the GA4 property / Ads customer is chosen later (many per login) → null. */
export async function identifyExternalRef(fetchFn: FetchLike, entry: ConnectorEntry, bundle: TokenBundle): Promise<string | null> {
  try {
    if (entry.id === "meta_ads") {
      const res = await fetchFn(`https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id&limit=25`, { headers: { authorization: `Bearer ${bundle.accessToken}` }, signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { account_id?: string }[] };
      const ids = (j.data ?? []).map((d) => d.account_id).filter((x): x is string => typeof x === "string");
      return ids.length === 1 ? `act_${ids[0]}` : null;
    }
    if (entry.id === "klaviyo") {
      const res = await fetchFn("https://a.klaviyo.com/api/accounts/", { headers: { authorization: `Bearer ${bundle.accessToken}`, accept: "application/json", revision: "2024-10-15" }, signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { id?: string }[] };
      const id = j.data?.[0]?.id;
      return typeof id === "string" ? id : null;
    }
  } catch {
    /* identification is a nicety; the connection stands without it */
  }
  return null;
}
