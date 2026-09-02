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
import { open, seal, type Keyring } from "./crypto";
import { bundleFromResponse, callbackUri, codeChallenge, exchangeCode, exchangeMetaLongLived, newCodeVerifier, newState, STATE_TTL_MS, verifyShopifyHmac, type FetchLike, type TokenBundle } from "./oauth";
import { hasPicker, listAccountOptions, normaliseExternalRef, OptionsError, type AccountOption } from "./options";
import type { PurgeResult, SyncProvisioner } from "./provisioning";
import { connectorEntry, GOOGLE_CHILDREN, isGoogleUmbrella, META_GRAPH_VERSION, normaliseShopDomain, platformCredentials, type ConnectorEntry } from "./registry";
import { revokeToken, type RevokeResult } from "./revoke";
import { insertSystemReceipt } from "@/lib/db/receipts";
import { accountForUser, consumeOauthState, deleteSecret, getConnector, getSecret, insertOauthState, isMember, putSecret, updateConnector, upsertConnector, type ConnectorRow } from "./store";
import { getAccessTokenFor } from "./tokens";
import type { Platform } from "@/lib/runtime/types";

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
  /** Per-tenant sync (Airbyte or the Noop); disconnect tears the tenant's sync down through it. */
  provisioner?: SyncProvisioner;
  /** Fires once a connection becomes readable (callback with a usable token, a picker choice,
      a pasted key) — the routes schedule the first certified read from it (firstRead.ts).
      Must not throw; must not block. */
  onConnected?: (info: { accountId: string; platform: Platform; connectorId: string }) => void;
}

/** True when the connector row can be read right away (a picker platform still needs its
    external_ref chosen first — the credential provider answers "nothing connected" until then). */
export function readableOnConnect(platform: string, externalRef: string | null): boolean {
  return !hasPicker(platform) || !!externalRef;
}

function fireConnected(deps: HandlerDeps, info: { accountId: string; platform: Platform; connectorId: string }) {
  try {
    deps.onConnected?.(info);
  } catch {
    /* the connection stands; the nightly snapshot reads it */
  }
}

export type FallbackReason = "unknown_platform" | "platform_not_configured" | "secret_store_not_configured" | "accounts_not_configured" | "developer_token_not_configured";

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
  // The Google umbrella has no row of its own: its children keep whatever state they have.
  if (!isGoogleUmbrella(entry.id)) await upsertConnector(deps.db, accountId, entry.id, { status: "connecting" });

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
      if (!isGoogleUmbrella(entry.id)) await upsertConnector(db, accountId, entry.id, { status: "error", last_sync_result: "error:oauth" });
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
    if (isGoogleUmbrella(entry.id)) {
      // One consent, three rows: each child gets the same bundle sealed under its own id; a
      // property / customer chosen earlier (external_ref) is kept, so a re-connect is quiet.
      for (const child of GOOGLE_CHILDREN) {
        const childId = await upsertConnector(db, accountId, child, { status: "connected", last_sync_at: null, last_sync_result: null });
        await putSecret(db, childId, seal(JSON.stringify(bundle), keyring, childId), now.toISOString());
        const row = await getConnector(db, accountId, child);
        if (readableOnConnect(child, row?.external_ref ?? null)) fireConnected(deps, { accountId, platform: child, connectorId: childId });
      }
      deps.log?.(`connectors.callback platform=google account=${accountId} result=connected children=${GOOGLE_CHILDREN.join(",")}`);
      return okRedirect(entry.id);
    }
    const externalRef = shop ?? (await identifyExternalRef(deps.fetch, entry, bundle));

    const connectorId = await upsertConnector(db, accountId, entry.id, { status: "connected", external_ref: externalRef, last_sync_at: null, last_sync_result: null });
    await putSecret(db, connectorId, seal(JSON.stringify(bundle), keyring, connectorId), now.toISOString());
    deps.log?.(`connectors.callback platform=${entry.id} account=${accountId} result=connected`);
    if (readableOnConnect(entry.id, externalRef)) fireConnected(deps, { accountId, platform: entry.id as Platform, connectorId });
    return okRedirect(entry.id);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "unexpected";
    return fail(`exchange_${code}`);
  }
}

// ---------- disconnect ----------

export type DisconnectResult =
  | { status: 200; body: { ok: true; status: "disconnected"; revoked: boolean; syncPurged: boolean } }
  | { status: 200; body: { fallback: true; reason: FallbackReason } }
  | { status: 401 | 403 | 404; body: { error: string } };

/** Forget a connection, in this order:
      1. revoke the token on the platform's side (revoke.ts) while we still hold it — best-effort;
      2. tear down the tenant's warehouse sync (provisioner.purgeTenant) — best-effort;
      3. delete the sealed secret, mark the row disconnected;
      4. receipt what happened (+ a separate receipt for a revoke that failed, so the founder
         knows to revoke from the platform's connected-apps page).
    Nothing in 1–2 can block 3. Gates mirror start: platform known → DB → session → membership → a row. */
export async function handleDisconnect(deps: HandlerDeps, platform: string): Promise<DisconnectResult> {
  const entry = connectorEntry(platform);
  if (!entry) return { status: 404, body: { error: "unknown platform" } };
  if (!deps.config.dbConfigured || !deps.db) return { status: 200, body: { fallback: true, reason: "accounts_not_configured" } };
  if (!deps.userId) return { status: 401, body: { error: "sign in first" } };
  const accountId = await accountForUser(deps.db, deps.userId);
  if (!accountId) return { status: 403, body: { error: "no account for this user" } };
  const row = await getConnector(deps.db, accountId, entry.id);
  if (!row) return { status: 404, body: { error: "nothing connected" } };
  const db = deps.db;
  const now = deps.now().toISOString();

  // 1. platform-side revoke, while the token is still ours to present
  const revoke = await revokeSealed(deps, entry, row);
  // 2. warehouse sync teardown
  const purge = await purgeSync(deps, accountId, entry.id);
  // 3. forget the secret
  await deleteSecret(db, row.id);
  await updateConnector(db, row.id, { status: "disconnected", last_sync_result: null });

  // 4. receipts
  const revokeLine = revoke.ok ? `access revoked on ${entry.name}’s side and the token deleted from the secret store` : `token deleted from the secret store`;
  await insertSystemReceipt(db, {
    accountId,
    kind: "notification",
    platform: entry.id,
    description: `${entry.name} disconnected — ${revokeLine}; reads on it stop now. ${purgeLine(purge)}`,
    payload: { connector_id: row.id, platform: entry.id, previous_status: row.status, external_ref: row.external_ref, revoke: revokePayload(revoke), sync_purge: purge },
    now,
  });
  if (!revoke.ok) {
    await insertSystemReceipt(db, {
      accountId,
      kind: "notification",
      platform: entry.id,
      description: `Couldn’t revoke ${entry.name}’s access on their side (${revoke.code}) — the token is deleted here, but revoke the app from ${entry.name}’s connected-apps page too if you want it gone there.`,
      payload: { connector_id: row.id, platform: entry.id, revoke: revokePayload(revoke) },
      now,
    });
  }
  deps.log?.(`connectors.disconnect platform=${entry.id} account=${accountId} revoke=${revoke.ok ? "ok" : revoke.code} purge=${purge.purged ? "ok" : purge.reason ?? "failed"}`);
  return { status: 200, body: { ok: true, status: "disconnected", revoked: revoke.ok, syncPurged: purge.purged } };
}

async function revokeSealed(deps: HandlerDeps, entry: ConnectorEntry, row: ConnectorRow): Promise<RevokeResult> {
  if (!deps.config.keyring || !deps.db) return { ok: false, code: "not_configured", endpoint: null };
  try {
    const sealed = await getSecret(deps.db, row.id);
    if (!sealed) return { ok: false, code: "no_token", endpoint: null };
    const bundle = JSON.parse(open(sealed, deps.config.keyring, row.id)) as TokenBundle;
    const creds = platformCredentials(entry.id, deps.config.env);
    return await revokeToken(deps.fetch, entry, { bundle, externalRef: row.external_ref, clientId: creds?.clientId, clientSecret: creds?.clientSecret });
  } catch {
    // an unreadable secret (rotated-away key, malformed) is still deleted below
    return { ok: false, code: "no_token", endpoint: null };
  }
}

async function purgeSync(deps: HandlerDeps, accountId: string, platform: ConnectorEntry["id"]): Promise<PurgeResult> {
  if (!deps.provisioner) return { purged: false, deleted: [], reason: "sync_not_configured" };
  try {
    return await deps.provisioner.purgeTenant(accountId, platform as Platform);
  } catch (e) {
    return { purged: false, deleted: [], reason: e instanceof Error && "code" in e ? `airbyte_${String((e as { code: unknown }).code)}` : "purge_failed" };
  }
}

export function purgeLine(p: PurgeResult): string {
  if (p.purged) return p.deleted.length ? "Warehouse sync torn down (Airbyte connection + source deleted)." : "No warehouse sync was provisioned for it.";
  if (p.reason === "sync_not_configured") return "Warehouse sync isn’t switched on — nothing to tear down.";
  return `Couldn’t tear down the warehouse sync (${p.reason ?? "failed"}) — it will fail on its next run without a token; see the runbook.`;
}

const revokePayload = (r: RevokeResult) => (r.ok ? { ok: true, endpoint: r.endpoint } : { ok: false, code: r.code, endpoint: r.endpoint });

// ---------- post-connect account pickers ----------

/* GET  …/options  → { platform, externalRef, options[] }   the founder's choices (listed only
                                                            while external_ref is null, or ?refresh=1)
   POST …/select   { externalRef } → { ok, externalRef }    stores the choice; status → connected

   Gates mirror disconnect (platform known → picker exists → DB → session → membership → a
   connected row), then the sealed token is opened through getAccessTokenFor (refreshing it
   if needed) for the platform list call. A token that can't be opened/refreshed → 409 with
   the row already flipped to needs_reconnect by tokens.ts, so the card shows Reconnect. */

export type OptionsResult =
  | { status: 200; body: { platform: string; externalRef: string | null; options: AccountOption[]; listed: boolean } }
  | { status: 200; body: { fallback: true; reason: FallbackReason } }
  | { status: 401 | 403 | 404 | 409 | 502; body: { error: string } };

type PickerGate = { ok: true; accountId: string; row: ConnectorRow; entry: ConnectorEntry } | { ok: false; result: { status: 200; body: { fallback: true; reason: FallbackReason } } | { status: 401 | 403 | 404; body: { error: string } } };

async function pickerGate(deps: HandlerDeps, platform: string): Promise<PickerGate> {
  const entry = connectorEntry(platform);
  if (!entry) return { ok: false, result: { status: 404, body: { error: "unknown platform" } } };
  if (!hasPicker(entry.id)) return { ok: false, result: { status: 404, body: { error: "this platform has no account picker" } } };
  if (!deps.config.dbConfigured || !deps.db) return { ok: false, result: { status: 200, body: { fallback: true, reason: "accounts_not_configured" } } };
  if (!deps.userId) return { ok: false, result: { status: 401, body: { error: "sign in first" } } };
  const accountId = await accountForUser(deps.db, deps.userId);
  if (!accountId) return { ok: false, result: { status: 403, body: { error: "no account for this user" } } };
  const row = await getConnector(deps.db, accountId, entry.id);
  if (!row || row.status !== "connected") return { ok: false, result: { status: 404, body: { error: "nothing connected" } } };
  return { ok: true, accountId, row, entry };
}

export async function handleOptions(deps: HandlerDeps, platform: string, opts: { refresh?: boolean } = {}): Promise<OptionsResult> {
  const gate = await pickerGate(deps, platform);
  if (!gate.ok) return gate.result;
  const { accountId, row, entry } = gate;
  const db = deps.db!;
  if (row.external_ref && !opts.refresh) return { status: 200, body: { platform: entry.id, externalRef: row.external_ref, options: [], listed: false } };
  if (!deps.config.keyring) return { status: 200, body: { fallback: true, reason: "secret_store_not_configured" } };
  if (entry.id === "google_ads" && !(deps.config.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim()) return { status: 200, body: { fallback: true, reason: "developer_token_not_configured" } };

  const token = await getAccessTokenFor(accountId, entry.id as Platform, { db, keyring: deps.config.keyring, env: deps.config.env, fetch: deps.fetch, now: deps.now, log: deps.log });
  if (!token) {
    deps.log?.(`connectors.options platform=${entry.id} account=${accountId} result=needs_reconnect`);
    return { status: 409, body: { error: "needs reconnect" } };
  }
  try {
    const options = await listAccountOptions(entry.id as Platform, token.accessToken, { fetch: deps.fetch, env: deps.config.env });
    deps.log?.(`connectors.options platform=${entry.id} account=${accountId} options=${options.length}`);
    return { status: 200, body: { platform: entry.id, externalRef: row.external_ref, options, listed: true } };
  } catch (e) {
    const code = e instanceof OptionsError ? e.code : "unexpected";
    deps.log?.(`connectors.options platform=${entry.id} account=${accountId} result=list_${code}`);
    return { status: 502, body: { error: `couldn't list accounts (${code})` } };
  }
}

export type SelectResult = { status: 200; body: { ok: true; externalRef: string } } | { status: 200; body: { fallback: true; reason: FallbackReason } } | { status: 400 | 401 | 403 | 404; body: { error: string } };

/** Store the founder's choice. The value is validated for shape only — a wrong account reads
    as an honest "couldn't ask" on the next run, never as invented data. */
export async function handleSelect(deps: HandlerDeps, platform: string, body: unknown): Promise<SelectResult> {
  const gate = await pickerGate(deps, platform);
  if (!gate.ok) return gate.result;
  const { accountId, row, entry } = gate;
  const raw = body && typeof body === "object" ? (body as { externalRef?: unknown }).externalRef : undefined;
  const externalRef = normaliseExternalRef(entry.id, raw);
  if (!externalRef) return { status: 400, body: { error: "externalRef must be a valid account id for this platform" } };
  const now = deps.now().toISOString();
  await updateConnector(deps.db!, row.id, { external_ref: externalRef, status: "connected" });
  await insertSystemReceipt(deps.db!, {
    accountId,
    kind: "notification",
    platform: entry.id,
    description: `${entry.name}: reading ${describeRef(entry.id, externalRef)} from now on.${row.external_ref && row.external_ref !== externalRef ? ` (was ${row.external_ref})` : ""}`,
    payload: { connector_id: row.id, platform: entry.id, external_ref: externalRef, previous_external_ref: row.external_ref },
    now,
  });
  deps.log?.(`connectors.select platform=${entry.id} account=${accountId}`);
  // The token was usable before; the choice is what makes the row readable — read it now.
  fireConnected(deps, { accountId, platform: entry.id as Platform, connectorId: row.id });
  return { status: 200, body: { ok: true, externalRef } };
}

function describeRef(platform: string, ref: string): string {
  switch (platform) {
    case "ga4":
      return `property ${ref}`;
    case "google_ads":
      return `customer ${ref.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3")}`;
    case "meta_ads":
      return `ad account ${ref}`;
    default:
      return ref;
  }
}

// ---------- external_ref discovery (best-effort, never fatal) ----------

const IDENTIFY_TIMEOUT_MS = 5_000;

/** Meta: the ad account when the user manages exactly one; Klaviyo: the account id;
    HubSpot: the portal id. Google: the GA4 property / Ads customer is chosen later (many
    per login) → null, and Meta with several ad accounts likewise — the post-connect picker
    (handleOptions / handleSelect) fills it in. */
export async function identifyExternalRef(fetchFn: FetchLike, entry: ConnectorEntry, bundle: TokenBundle): Promise<string | null> {
  try {
    if (entry.id === "meta_ads") {
      const res = await fetchFn(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=account_id&limit=25`, { headers: { authorization: `Bearer ${bundle.accessToken}` }, signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
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
    if (entry.id === "hubspot") {
      // account-info needs no extra scope; the portal id is non-secret (it is in every HubSpot URL).
      const res = await fetchFn("https://api.hubapi.com/account-info/v3/details", { headers: { authorization: `Bearer ${bundle.accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
      if (!res.ok) return null;
      const j = (await res.json()) as { portalId?: unknown };
      return typeof j.portalId === "number" || (typeof j.portalId === "string" && j.portalId) ? String(j.portalId) : null;
    }
  } catch {
    /* identification is a nicety; the connection stands without it */
  }
  return null;
}
