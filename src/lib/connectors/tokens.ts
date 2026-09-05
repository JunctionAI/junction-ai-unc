/* SERVER ONLY — token access for the sync layer and the worker.

   getAccessToken(connectorId): opens the sealed bundle, refreshes it first when it is within
   REFRESH_SKEW_MS of expiry and the platform supports a refresh grant (Google, Klaviyo),
   re-seals under the current key (so a key rotation completes itself over time), and
   returns the live access token. Confirmed invalid grants / expired non-renewable tokens
   require reconnection. Temporary and application-configuration failures preserve the
   connection and throw a coded error so callers never confuse them with missing consent.

   ConnectorCredentialProvider matches src/worker/credentials.ts structurally:
     interface CredentialProvider { get(accountId, platform): Promise<PlatformCredential | null> }
   with the same PlatformCredential union (declared here, not imported — the worker tree is
   owned elsewhere and must stay importable without this module). When the worker is switched
   to live credentials it passes `new ConnectorCredentialProvider(deps)` as `credentials`. */

import { unwrap, type DbClient } from "../db/types";
import { claimLease, releaseLease } from "./lease";
import { needsReseal, open, seal, type Keyring } from "./crypto";
import { bundleFromResponse, refreshTokens, TokenCallError, type FetchLike, type TokenBundle } from "./oauth";
import { connectorEntry, platformCredentials } from "./registry";
import { getConnector, getConnectorById, getSecret, putSecret, updateConnector, type ConnectorRow } from "./store";
import { makeAuthProvider } from "./providers/index";
import { AuthProviderError, providerRefOf, type ProviderRef } from "./providers/interface";
import type { Platform } from "../runtime/types";

export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class TokenAccessError extends Error {
  constructor(readonly code: "temporarily_unavailable" | "configuration_error") {
    super(code === "temporarily_unavailable" ? "connection temporarily unavailable; retry later" : "connection configuration requires operator attention");
    this.name = "TokenAccessError";
  }
}

// Coalesce calls sharing a database client. This is process-local; a distributed lease
// is still required before multiple independent refresh owners are enabled.
const tokenFlights = new WeakMap<DbClient, Map<string, Promise<AccessToken | null>>>();

async function singleFlight(row: ConnectorRow, deps: TokenDeps): Promise<AccessToken | null> {
  let flights = tokenFlights.get(deps.db);
  if (!flights) { flights = new Map(); tokenFlights.set(deps.db, flights); }
  const running = flights.get(row.id);
  if (running) return running;
  const flight = tokenForRow(row, deps);
  flights.set(row.id, flight);
  try { return await flight; } finally { if (flights.get(row.id) === flight) flights.delete(row.id); }
}

async function unavailable(deps: TokenDeps, row: ConnectorRow, code: TokenAccessError["code"]): Promise<never> {
  deps.log?.(`connectors.token platform=${row.platform} connector=${row.id} result=${code}`);
  try { await updateConnector(deps.db, row.id, { last_sync_result: `error:auth_${code}` }); } catch { /* preserve original error */ }
  throw new TokenAccessError(code);
}

export interface TokenDeps {
  db: DbClient;
  keyring: Keyring;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now: () => Date;
  log?: (line: string) => void;
}

export interface AccessToken {
  accessToken: string;
  platform: Platform;
  externalRef: string | null;
  expiresAt: string | null;
  /** Present only for platforms whose sync source needs it (Google refresh flows). */
  refreshToken?: string;
}

async function markReconnect(deps: TokenDeps, row: ConnectorRow, code: string) {
  deps.log?.(`connectors.token platform=${row.platform} connector=${row.id} result=${code}`);
  try {
    await updateConnector(deps.db, row.id, { status: "needs_reconnect", last_sync_result: `error:${code}` });
  } catch {
    /* status is advisory; the null return is the contract */
  }
}

/** null = absent/unusable connection; TokenAccessError = infrastructure/provider failure. */
export async function getAccessToken(connectorId: string, deps: TokenDeps): Promise<AccessToken | null> {
  const row = await getConnectorById(deps.db, connectorId);
  if (!row) return null;
  return singleFlight(row, deps);
}

/** Same, keyed by (account, platform). */
export async function getAccessTokenFor(accountId: string, platform: Platform, deps: TokenDeps): Promise<AccessToken | null> {
  const row = await getConnector(deps.db, accountId, platform);
  if (!row) return null;
  return singleFlight(row, deps);
}

async function tokenForRow(row: ConnectorRow, deps: TokenDeps, leaseHolder?: string): Promise<AccessToken | null> {
  if (row.status !== "connected") return null;
  const entry = connectorEntry(row.platform);
  if (!entry || entry.flow === "none") return null;

  // Hosted-provider rows (PROTOTYPE): the token lives in the provider's vault, not in
  // connector_secrets — fetch it per call; the provider refreshes on its side. Same contract:
  // null = reconnect, the row flipped, a code (never a value) in the log.
  const providerRef = providerRefOf(row);
  if (providerRef) return tokenViaProvider(row, providerRef, deps, entry.id as Platform);

  const sealed = await getSecret(deps.db, row.id);
  if (!sealed) {
    await markReconnect(deps, row, "no_secret");
    return null;
  }
  let bundle: TokenBundle;
  try {
    bundle = JSON.parse(open(sealed, deps.keyring, row.id)) as TokenBundle;
  } catch (e) {
    // A missing decryption key is an operator issue; another customer login cannot fix it.
    void e;
    return unavailable(deps, row, "configuration_error");
  }

  const now = deps.now();
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return unavailable(deps, row, "configuration_error");
  const expiresAt = bundle.expiresAt ? new Date(bundle.expiresAt).getTime() : null;
  if (typeof bundle.accessToken !== "string" || !bundle.accessToken.trim() || (expiresAt !== null && !Number.isFinite(expiresAt))) return unavailable(deps, row, "configuration_error");
  const expiring = expiresAt !== null && expiresAt - now.getTime() < REFRESH_SKEW_MS;
  const renewable = entry.refresh === "refresh_token" && typeof bundle.refreshToken === "string" && Boolean(bundle.refreshToken);
  let rewrite = needsReseal(sealed, deps.keyring);

  if (((expiring && renewable) || rewrite) && !leaseHolder && deps.env.CONNECTOR_REFRESH_LEASES_ENABLED === "true") {
    const key = `connector:${row.id}`;
    const holder = await claimLease(deps.db, key);
    if (!holder) return unavailable(deps, row, "temporarily_unavailable");
    let completed = false;
    try {
      // Another process may have renewed or disconnected it since our first read.
      const current = await getConnectorById(deps.db, row.id);
      const token = current ? await tokenForRow(current, deps, holder) : null;
      completed = true;
      return token;
    } finally { if (completed) await releaseLease(deps.db, key, holder); }
  }

  if (expiring) {
    if (!renewable) {
      // A non-renewable token remains valid until actual expiry, not the refresh skew.
      if (expiresAt !== null && expiresAt <= now.getTime()) {
        await markReconnect(deps, row, "token_expired");
        return null;
      }
    } else {
      const creds = platformCredentials(entry.id, deps.env);
      if (!creds) {
        return unavailable(deps, row, "configuration_error");
      }
      try {
        const fresh = await refreshTokens(deps.fetch, entry, { refreshToken: bundle.refreshToken!, clientId: creds.clientId, clientSecret: creds.clientSecret });
        bundle = bundleFromResponse(fresh, now, bundle);
        rewrite = true;
      } catch (e) {
        if (e instanceof TokenCallError && e.oauthError === "invalid_grant") {
          await markReconnect(deps, row, `token_refresh_${e.code}`);
          return null;
        }
        const config = e instanceof TokenCallError && ["invalid_client", "unauthorized_client", "invalid_scope", "unsupported_grant_type", "invalid_request"].includes(e.oauthError ?? "");
        return unavailable(deps, row, config ? "configuration_error" : "temporarily_unavailable");
      }
    }
  }

  if (rewrite) {
    const next = seal(JSON.stringify(bundle), deps.keyring, row.id);
    if (leaseHolder) {
      const committed = await unwrap<boolean>("commit connector token", deps.db.rpc("commit_connector_token", {
        p_connector_id: row.id, p_holder: leaseHolder, p_expected_ciphertext: sealed.ciphertext,
        p_ciphertext: next.ciphertext, p_iv: next.iv, p_tag: next.tag, p_key_version: next.keyVersion,
      }));
      if (!committed) return unavailable(deps, row, "temporarily_unavailable");
    } else await putSecret(deps.db, row.id, next, now.toISOString());
  }
  if (row.last_sync_result?.startsWith("error:auth_")) await updateConnector(deps.db, row.id, { last_sync_result: null });

  return { accessToken: bundle.accessToken, platform: entry.id as Platform, externalRef: row.external_ref, expiresAt: bundle.expiresAt ?? null, ...(bundle.refreshToken ? { refreshToken: bundle.refreshToken } : {}) };
}

async function tokenViaProvider(row: ConnectorRow, ref: ProviderRef, deps: TokenDeps, platform: Platform): Promise<AccessToken | null> {
  const provider = makeAuthProvider(ref.provider, { env: deps.env, fetch: deps.fetch, now: deps.now });
  if (!provider || !provider.supports(platform)) {
    return unavailable(deps, row, "configuration_error");
  }
  if (!ref.connectionId) {
    return unavailable(deps, row, "configuration_error");
  }
  try {
    const tok = await provider.getAccessToken({ accountId: row.account_id, platform, connectionId: ref.connectionId });
    if (!tok.accessToken || (tok.expiresAt && (!Number.isFinite(Date.parse(tok.expiresAt)) || new Date(tok.expiresAt).getTime() <= deps.now().getTime()))) {
      // The provider handed back a token it did not refresh — treat as expired, never use it.
      return unavailable(deps, row, "temporarily_unavailable");
    }
    if (row.last_sync_result?.startsWith("error:auth_")) await updateConnector(deps.db, row.id, { last_sync_result: null });
    return { accessToken: tok.accessToken, platform, externalRef: row.external_ref, expiresAt: tok.expiresAt, ...(tok.refreshToken ? { refreshToken: tok.refreshToken } : {}) };
  } catch (e) {
    if (e instanceof TokenAccessError) throw e;
    if (e instanceof AuthProviderError && e.code === "not_connected") {
      await markReconnect(deps, row, "provider_not_connected");
      return null;
    }
    const config = e instanceof AuthProviderError && ["not_configured", "no_integration", "http_401", "http_403"].includes(e.code);
    return unavailable(deps, row, config ? "configuration_error" : "temporarily_unavailable");
  }
}

// ---------- worker-shaped credential provider ----------

/** Mirror of src/worker/credentials.ts PlatformCredential (kept in sync by hand; the worker
    tree is not imported from here). */
export type PlatformCredential =
  | { kind: "fixture"; platform: Platform; marker: string }
  | { kind: "shopify"; shopDomain: string; accessToken: string }
  | { kind: "klaviyo"; apiKey: string }
  | { kind: "ga4"; propertyId: string; accessToken: string }
  | { kind: "meta_ads"; adAccountId: string; accessToken: string }
  | { kind: "google_ads"; customerId: string; developerToken: string; accessToken: string; loginCustomerId?: string }
  | { kind: "hubspot"; accessToken: string; portalId?: string };

export interface CredentialProviderShape {
  get(accountId: string, platform: Platform): Promise<PlatformCredential | null>;
}

/** Real credentials from connector_secrets. Returns null (= "nothing connected") whenever a
    piece is missing — a token without its external_ref (GA4 property, Ads customer) is not a
    usable credential yet, and the reader's "couldn't ask" path is the honest outcome. */
export class ConnectorCredentialProvider implements CredentialProviderShape {
  constructor(private readonly deps: TokenDeps) {}

  async get(accountId: string, platform: Platform): Promise<PlatformCredential | null> {
    const tok = await getAccessTokenFor(accountId, platform, this.deps);
    if (!tok) return null;
    switch (platform) {
      case "shopify":
        return tok.externalRef ? { kind: "shopify", shopDomain: tok.externalRef, accessToken: tok.accessToken } : null;
      case "klaviyo":
        return { kind: "klaviyo", apiKey: tok.accessToken };
      case "ga4":
        return tok.externalRef ? { kind: "ga4", propertyId: tok.externalRef, accessToken: tok.accessToken } : null;
      case "meta_ads":
        return tok.externalRef ? { kind: "meta_ads", adAccountId: tok.externalRef, accessToken: tok.accessToken } : null;
      case "google_ads": {
        const developerToken = (this.deps.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
        const loginCustomerId = (this.deps.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim() || undefined;
        if (!tok.externalRef || !developerToken) return null;
        return { kind: "google_ads", customerId: tok.externalRef, developerToken, accessToken: tok.accessToken, ...(loginCustomerId ? { loginCustomerId } : {}) };
      }
      case "hubspot":
        return { kind: "hubspot", accessToken: tok.accessToken, ...(tok.externalRef ? { portalId: tok.externalRef } : {}) };
      default:
        return null;
    }
  }
}
