/* Server-only credential access. Every outcome is bound to its original account,
 * selected connector and sealed grant. Refresh claims persist across process death;
 * a timed-out POST is not permission to retry a potentially rotated grant. */
import { unwrap, type DbClient } from "../db/types";
import { RuntimeContextError, type RuntimeContextIdentity } from "../runtime/contextFence";
import { claimLease, releaseLease } from "./lease";
import { needsReseal, open, seal, type Keyring } from "./crypto";
import { bundleFromResponse, refreshTokens, TokenCallError, type FetchLike, type TokenBundle } from "./oauth";
import { connectorEntry, platformCredentials } from "./registry";
import { getConnector, getConnectorById, type ConnectorRow } from "./store";
import { assertTokenContext, captureToken, settleToken, type TokenCapture, type TokenContext } from "./tokenContext";
import { makeAuthProvider } from "./providers/index";
import { AuthProviderError, providerRefOf } from "./providers/interface";
import type { Platform } from "../runtime/types";

export const REFRESH_SKEW_MS = 5 * 60 * 1000;
export class TokenAccessError extends Error {
  constructor(readonly code: "temporarily_unavailable" | "configuration_error") {
    super(code === "temporarily_unavailable" ? "connection temporarily unavailable; retry later" : "connection configuration requires operator attention");
    this.name = "TokenAccessError";
  }
}
export interface TokenDeps {
  db: DbClient; keyring: Keyring; env: Record<string, string | undefined>; fetch: FetchLike; now: () => Date;
  log?: (line: string) => void;
  /** Present for a running workflow: never resolve a new business for old work. */
  expectedContext?: RuntimeContextIdentity;
  expectedOwner?: string;
}
export interface AccessToken {
  accessToken: string; platform: Platform; externalRef: string | null; expiresAt: string | null; refreshToken?: string;
}
interface Resolution { token: AccessToken | null; context: TokenContext }
const tokenFlights = new WeakMap<DbClient, Map<string, Promise<Resolution>>>();
const resolvedContexts = new WeakMap<AccessToken, TokenContext>();

async function singleFlight(row: ConnectorRow, deps: TokenDeps): Promise<AccessToken | null> {
  const captured = await captureToken(deps.db, row, deps.expectedContext, deps.expectedOwner);
  if (!captured) return null;
  let flights = tokenFlights.get(deps.db);
  if (!flights) { flights = new Map(); tokenFlights.set(deps.db, flights); }
  // New generation/grant/asset/provider/status must not join an older request.
  const key = JSON.stringify(captured.context);
  let flight = flights.get(key);
  if (!flight) {
    flight = tokenForCapture(captured, deps);
    flights.set(key, flight);
  }
  try {
    const result = await flight;
    await assertTokenContext(deps.db, result.context);
    if (result.token) {
      if (result.token.expiresAt && Date.parse(result.token.expiresAt) <= deps.now().getTime()) throw new TokenAccessError("temporarily_unavailable");
      resolvedContexts.set(result.token, result.context);
    }
    return result.token;
  } finally { if (flights.get(key) === flight) flights.delete(key); }
}

/** null = absent/unusable; coded failures never masquerade as revoked consent. */
export async function getAccessToken(connectorId: string, deps: TokenDeps): Promise<AccessToken | null> {
  const row = await getConnectorById(deps.db, connectorId);
  return row ? singleFlight(row, deps) : null;
}
export async function getAccessTokenFor(accountId: string, platform: Platform, deps: TokenDeps): Promise<AccessToken | null> {
  if (deps.expectedContext && deps.expectedContext.accountId !== accountId) throw new RuntimeContextError("context_changed", "Credential account mismatch.");
  const row = await getConnector(deps.db, accountId, platform);
  return row ? singleFlight(row, deps) : null;
}

async function tokenForCapture(captured: TokenCapture, deps: TokenDeps): Promise<Resolution> {
  const { row, sealed, context } = captured;
  const entry = connectorEntry(row.platform);
  if (!entry || entry.flow === "none") return { token: null, context };
  let holder: string | undefined;
  let refreshAttempt = false;
  let settled = false;
  const record = async (kind: "success" | "reconnect" | "temporary" | "configuration", extra: { code?: string; sealed?: ReturnType<typeof seal>; retryable?: boolean } = {}) => {
    const next = await settleToken(deps.db, context, { kind, holder, refreshAttempt, ...extra });
    settled = true;
    return next;
  };
  const unavailable = async (code: TokenAccessError["code"], retryable = false): Promise<never> => {
    deps.log?.(`connectors.token platform=${row.platform} connector=${row.id} result=${code}`);
    await record(code === "configuration_error" ? "configuration" : "temporary", { retryable });
    throw new TokenAccessError(code);
  };
  const reconnect = async (code: string): Promise<Resolution> => {
    deps.log?.(`connectors.token platform=${row.platform} connector=${row.id} result=${code}`);
    return { token: null, context: await record("reconnect", { code }) };
  };
  const result = (bundle: TokenBundle, next: TokenContext): Resolution => {
    if (next.binding.externalRef !== row.external_ref) throw new RuntimeContextError("context_changed", "The selected asset changed while its grant was being read.");
    return {
    context: next, token: { accessToken: bundle.accessToken, platform: entry.id as Platform, externalRef: row.external_ref,
      expiresAt: bundle.expiresAt ?? null, ...(bundle.refreshToken ? { refreshToken: bundle.refreshToken } : {}) },
    };
  };

  try {
    const ref = providerRefOf(row);
    if (ref) {
      const provider = makeAuthProvider(ref.provider, { env: deps.env, fetch: deps.fetch, now: deps.now });
      if (!provider || !provider.supports(entry.id as Platform) || !ref.connectionId) return await unavailable("configuration_error");
      let tok;
      try {
        await assertTokenContext(deps.db, context);
        tok = await provider.getAccessToken({ accountId: row.account_id, platform: entry.id as Platform, connectionId: ref.connectionId });
      } catch (e) {
        if (e instanceof RuntimeContextError) throw e;
        if (e instanceof AuthProviderError && e.code === "not_connected") return await reconnect("provider_not_connected");
        const config = e instanceof AuthProviderError && ["not_configured", "no_integration", "http_401", "http_403"].includes(e.code);
        return await unavailable(config ? "configuration_error" : "temporarily_unavailable");
      }
      if (!tok.accessToken || (tok.expiresAt && (!Number.isFinite(Date.parse(tok.expiresAt)) || Date.parse(tok.expiresAt) <= deps.now().getTime())))
        return await unavailable("temporarily_unavailable");
      return result({ accessToken: tok.accessToken, obtainedAt: deps.now().toISOString(), expiresAt: tok.expiresAt ?? undefined,
        ...(tok.refreshToken ? { refreshToken: tok.refreshToken } : {}) }, await record("success"));
    }

    if (!sealed) return await reconnect("no_secret");
    let bundle: TokenBundle;
    try { bundle = JSON.parse(open(sealed, deps.keyring, row.id)) as TokenBundle; }
    catch { return await unavailable("configuration_error"); }
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return await unavailable("configuration_error");
    const now = deps.now();
    const expiresAt = bundle.expiresAt ? Date.parse(bundle.expiresAt) : null;
    if (typeof bundle.accessToken !== "string" || !bundle.accessToken.trim() || (expiresAt !== null && !Number.isFinite(expiresAt)))
      return await unavailable("configuration_error");
    const expiring = expiresAt !== null && expiresAt - now.getTime() < REFRESH_SKEW_MS;
    const renewable = entry.refresh === "refresh_token" && typeof bundle.refreshToken === "string" && Boolean(bundle.refreshToken);
    let rewrite = needsReseal(sealed, deps.keyring);
    if (expiring && !renewable && expiresAt! <= now.getTime()) return await reconnect("token_expired");
    const creds = expiring && renewable ? platformCredentials(entry.id, deps.env) : null;
    if (expiring && renewable && !creds) return await unavailable("configuration_error");

    if ((expiring && renewable) || rewrite) {
      // Mandatory for every native refresh/reseal, regardless of the legacy flag.
      const claimed = await claimLease(deps.db, `connector:${row.id}`);
      if (!claimed) throw new TokenAccessError("temporarily_unavailable");
      holder = claimed;
      await assertTokenContext(deps.db, context);
    }
    if (expiring && renewable) {
      const admitted = await unwrap<boolean>("connector.refresh.begin", deps.db.rpc("begin_connector_refresh", { input: { context, holder } }));
      if (admitted !== true) { settled = true; throw new TokenAccessError("temporarily_unavailable"); }
      refreshAttempt = true;
      try {
        const fresh = await refreshTokens(deps.fetch, entry, { refreshToken: bundle.refreshToken!, clientId: creds!.clientId, clientSecret: creds!.clientSecret });
        bundle = bundleFromResponse(fresh, now, bundle);
        rewrite = true;
      } catch (e) {
        if (e instanceof TokenCallError && e.oauthError === "invalid_grant") return await reconnect(`token_refresh_${e.code}`);
        const config = e instanceof TokenCallError && ["invalid_client", "unauthorized_client", "invalid_scope", "unsupported_grant_type", "invalid_request"].includes(e.oauthError ?? "");
        // Only a classified failed OAuth response permits a bounded retry. A
        // timeout/network/malformed response may conceal a successfully rotated grant.
        const retryable = e instanceof TokenCallError && e.code.startsWith("http_") &&
          ["temporarily_unavailable", "server_error"].includes(e.oauthError ?? "");
        return await unavailable(config ? "configuration_error" : "temporarily_unavailable", retryable);
      }
    }
    const next = await record("success", rewrite ? { sealed: seal(JSON.stringify(bundle), deps.keyring, row.id) } : {});
    return result(bundle, next);
  } finally {
    // Unknown commits retain both the short lease and durable pending attempt.
    if (holder && settled) {
      try { await releaseLease(deps.db, `connector:${row.id}`, holder); } catch { /* expiry handles cleanup, never overwrite a confirmed token outcome */ }
    }
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
  get(accountId: string, platform: Platform, context?: RuntimeContextIdentity): Promise<PlatformCredential | null>;
  validate?(credential: PlatformCredential): Promise<void>;
}

/** Real credentials from connector_secrets. Returns null (= "nothing connected") whenever a
    piece is missing — a token without its external_ref (GA4 property, Ads customer) is not a
    usable credential yet, and the reader's "couldn't ask" path is the honest outcome. */
export class ConnectorCredentialProvider implements CredentialProviderShape {
  private readonly contexts = new WeakMap<PlatformCredential, { context: TokenContext; expiresAt: string | null }>();
  constructor(private readonly deps: TokenDeps) {}

  async validate(credential: PlatformCredential): Promise<void> {
    const captured = this.contexts.get(credential);
    if (!captured) throw new RuntimeContextError("context_unavailable", "No captured credential identity.");
    if (captured.expiresAt && Date.parse(captured.expiresAt) <= this.deps.now().getTime()) throw new TokenAccessError("temporarily_unavailable");
    await assertTokenContext(this.deps.db, captured.context);
  }

  async get(accountId: string, platform: Platform, context?: RuntimeContextIdentity): Promise<PlatformCredential | null> {
    const tok = await getAccessTokenFor(accountId, platform, { ...this.deps, expectedContext: context ?? this.deps.expectedContext });
    if (!tok) return null;
    const remember = (credential: PlatformCredential): PlatformCredential => {
      this.contexts.set(credential, { context: resolvedContexts.get(tok)!, expiresAt: tok.expiresAt });
      return credential;
    };
    switch (platform) {
      case "shopify":
        return tok.externalRef ? remember({ kind: "shopify", shopDomain: tok.externalRef, accessToken: tok.accessToken }) : null;
      case "klaviyo":
        return remember({ kind: "klaviyo", apiKey: tok.accessToken });
      case "ga4":
        return tok.externalRef ? remember({ kind: "ga4", propertyId: tok.externalRef, accessToken: tok.accessToken }) : null;
      case "meta_ads":
        return tok.externalRef ? remember({ kind: "meta_ads", adAccountId: tok.externalRef, accessToken: tok.accessToken }) : null;
      case "google_ads": {
        const developerToken = (this.deps.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
        const loginCustomerId = (this.deps.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim() || undefined;
        if (!tok.externalRef || !developerToken) return null;
        return remember({ kind: "google_ads", customerId: tok.externalRef, developerToken, accessToken: tok.accessToken, ...(loginCustomerId ? { loginCustomerId } : {}) });
      }
      case "hubspot":
        return remember({ kind: "hubspot", accessToken: tok.accessToken, ...(tok.externalRef ? { portalId: tok.externalRef } : {}) });
      default:
        return null;
    }
  }
}
