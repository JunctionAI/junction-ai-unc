/* SERVER ONLY — token access for the sync layer and the worker.

   getAccessToken(connectorId): opens the sealed bundle, refreshes it first when it is within
   REFRESH_SKEW_MS of expiry and the platform supports a refresh grant (Google, Klaviyo),
   re-seals under the current key (so a key rotation completes itself over time), and
   returns the live access token. A refresh that fails, or an expired token that cannot be
   refreshed (Meta), flips the row to needs_reconnect / 'error:token_refresh' and returns
   null — the card shows Reconnect and the sync records "couldn't ask", never "empty".

   ConnectorCredentialProvider matches src/worker/credentials.ts structurally:
     interface CredentialProvider { get(accountId, platform): Promise<PlatformCredential | null> }
   with the same PlatformCredential union (declared here, not imported — the worker tree is
   owned elsewhere and must stay importable without this module). When the worker is switched
   to live credentials it passes `new ConnectorCredentialProvider(deps)` as `credentials`. */

import type { DbClient } from "@/lib/db/types";
import { needsReseal, open, seal, SecretStoreError, type Keyring } from "./crypto";
import { bundleFromResponse, refreshTokens, TokenCallError, type FetchLike, type TokenBundle } from "./oauth";
import { connectorEntry, platformCredentials } from "./registry";
import { getConnector, getConnectorById, getSecret, putSecret, updateConnector, type ConnectorRow } from "./store";
import type { Platform } from "@/lib/runtime/types";

export const REFRESH_SKEW_MS = 5 * 60 * 1000;

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

/** Live token for a connector row, refreshed + re-sealed as needed. null = reconnect required. */
export async function getAccessToken(connectorId: string, deps: TokenDeps): Promise<AccessToken | null> {
  const row = await getConnectorById(deps.db, connectorId);
  if (!row) return null;
  return tokenForRow(row, deps);
}

/** Same, keyed by (account, platform). */
export async function getAccessTokenFor(accountId: string, platform: Platform, deps: TokenDeps): Promise<AccessToken | null> {
  const row = await getConnector(deps.db, accountId, platform);
  if (!row) return null;
  return tokenForRow(row, deps);
}

async function tokenForRow(row: ConnectorRow, deps: TokenDeps): Promise<AccessToken | null> {
  if (row.status !== "connected") return null;
  const entry = connectorEntry(row.platform);
  if (!entry || entry.flow === "none") return null;

  const sealed = await getSecret(deps.db, row.id);
  if (!sealed) {
    await markReconnect(deps, row, "no_secret");
    return null;
  }
  let bundle: TokenBundle;
  try {
    bundle = JSON.parse(open(sealed, deps.keyring, row.id)) as TokenBundle;
  } catch (e) {
    await markReconnect(deps, row, e instanceof SecretStoreError ? `secret_${e.code}` : "secret_malformed");
    return null;
  }

  const now = deps.now();
  const expiresAt = bundle.expiresAt ? new Date(bundle.expiresAt).getTime() : null;
  const expiring = expiresAt !== null && expiresAt - now.getTime() < REFRESH_SKEW_MS;
  let rewrite = needsReseal(sealed, deps.keyring);

  if (expiring) {
    if (entry.refresh !== "refresh_token" || !bundle.refreshToken) {
      await markReconnect(deps, row, "token_expired");
      return null;
    }
    const creds = platformCredentials(entry.id, deps.env);
    if (!creds) {
      await markReconnect(deps, row, "platform_not_configured");
      return null;
    }
    try {
      const fresh = await refreshTokens(deps.fetch, entry, { refreshToken: bundle.refreshToken, clientId: creds.clientId, clientSecret: creds.clientSecret });
      bundle = bundleFromResponse(fresh, now, bundle);
      rewrite = true;
    } catch (e) {
      await markReconnect(deps, row, e instanceof TokenCallError ? `token_refresh_${e.code}` : "token_refresh");
      return null;
    }
  }

  if (rewrite) await putSecret(deps.db, row.id, seal(JSON.stringify(bundle), deps.keyring, row.id), now.toISOString());

  return { accessToken: bundle.accessToken, platform: entry.id, externalRef: row.external_ref, expiresAt: bundle.expiresAt ?? null, ...(bundle.refreshToken ? { refreshToken: bundle.refreshToken } : {}) };
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
  | { kind: "google_ads"; customerId: string; developerToken: string; accessToken: string; loginCustomerId?: string };

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
      default:
        return null;
    }
  }
}
