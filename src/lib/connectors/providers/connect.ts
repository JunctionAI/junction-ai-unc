/* The Connect flow when a hosted provider holds the tokens — the provider-side twins of
   handleStart / handleCallback / the disconnect revoke step. handlers.ts calls into these
   behind authProviderFor(); with no provider flagged none of this runs.

     startViaProvider     POST /api/connectors/<platform>/start  (same route, same UI)
                          → { url }  the provider's hosted connect link
     callbackViaProvider  GET  /api/connectors/provider/<provider>/callback?state=…
                          → redirect path — also usable as a "check now" poll when the
                          provider's UI cannot redirect back (Nango): same state, same answer.

   Gates mirror the own-app flow (platform known → provider usable → secret store present →
   DB → session → membership → (Shopify) shop). The secret store is still required even
   though no token is sealed: the pointer + receipts path assumes an accounts-mode deployment.

   The connector row is the in-flight record: status 'connecting' + sync_ref pointer written
   at start; the callback asks the provider whether the connection is active, fills in the
   connection id (Nango assigns it late), the external_ref when the provider surfaces one,
   flips the row to 'connected', receipts it, and fires onConnected. No token touches our
   process here at all. */

import type { DbClient } from "@/lib/db/types";
import { insertSystemReceipt } from "@/lib/db/receipts";
import type { FallbackReason, HandlerDeps } from "../handlers";
import { callbackUri, newState, STATE_TTL_MS } from "../oauth";
import { hasPicker } from "../options";
import { connectorEntry, normaliseShopDomain, type ConnectorEntry } from "../registry";
import { accountForUser, consumeOauthState, getConnector, insertOauthState, markOauthFailure, memberRole, updateConnector, upsertConnector, type ConnectorRow } from "../store";
import { authProviderFor } from "./index";
import { AuthProviderError, providerRefOf, providerRefPatch, withoutProviderRef, type AuthProvider, type AuthProviderId, type ProviderRef } from "./interface";
import type { Platform } from "@/lib/runtime/types";

export type ProviderStartResult = { status: 200; body: { url: string; provider: AuthProviderId } } | { status: 200; body: { fallback: true; reason: FallbackReason } } | { status: 400 | 401 | 403 | 404 | 502; body: { error: string } };

const fallback = (reason: FallbackReason): ProviderStartResult => ({ status: 200, body: { fallback: true, reason } });
const err = (status: 400 | 401 | 403 | 404 | 502, error: string): ProviderStartResult => ({ status, body: { error } });

/** Public callback URL for a provider: /api/connectors/provider/<provider>/callback?platform=<platform>. */
export function providerCallbackUri(appUrl: string, provider: AuthProviderId, platform: string): string {
  const u = new URL(callbackUri(appUrl, `provider/${provider}`));
  u.searchParams.set("platform", platform);
  return u.toString();
}

function providerDeps(deps: HandlerDeps) {
  return { env: deps.config.env, fetch: deps.fetch, now: deps.now };
}

export async function startViaProvider(deps: HandlerDeps, platform: string, body: unknown): Promise<ProviderStartResult> {
  const entry = connectorEntry(platform);
  if (!entry) return err(404, "unknown platform");
  const res = authProviderFor(entry.id, providerDeps(deps));
  if (res.mode === "own") return fallback("platform_not_configured");
  if (!res.provider) return fallback("platform_not_configured");
  if (!deps.config.keyring) return fallback("secret_store_not_configured");
  if (!deps.config.dbConfigured || !deps.db) return fallback("accounts_not_configured");
  if (!deps.userId) return err(401, "sign in first");
  const accountId = await accountForUser(deps.db, deps.userId, deps.requestedAccountId);
  if (!accountId) return err(403, "no account for this user");
  if ((await memberRole(deps.db, deps.userId, accountId)) !== "owner") return err(403, "only the account owner can connect a platform");

  let shop: string | undefined;
  if (entry.flow === "shopify") {
    const raw = body && typeof body === "object" ? (body as { shop?: unknown }).shop : undefined;
    const s = normaliseShopDomain(raw);
    if (!s) return err(400, "shop must be a your-store.myshopify.com domain");
    shop = s;
  }

  const now = deps.now();
  const state = newState();
  const platformId = entry.id as Platform;
  let link;
  try {
    link = await res.provider.connectUrl({ accountId, platform: platformId, state, returnUrl: providerCallbackUri(deps.config.appUrl, res.mode, platformId), shop });
  } catch (e) {
    const code = e instanceof AuthProviderError ? e.code : "unexpected";
    deps.log?.(`connectors.provider.start provider=${res.mode} platform=${platformId} account=${accountId} result=${code}`);
    return err(502, `couldn't start ${res.mode} connect (${code})`);
  }
  await insertOauthState(deps.db, {
    state,
    account_id: accountId,
    platform: platformId,
    code_verifier: null,
    shop: shop ?? null,
    redirect_to: "/app",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
  });
  const existing = await getConnector(deps.db, accountId, platformId);
  const ref: ProviderRef = { provider: res.mode, connectionId: link.connectionId, integration: link.integration };
  await upsertConnector(deps.db, accountId, platformId, { status: "connecting", sync_ref: { ...withoutProviderRef(existing?.sync_ref ?? null), ...providerRefPatch(ref) } });
  deps.log?.(`connectors.provider.start provider=${res.mode} platform=${platformId} account=${accountId} result=link`);
  return { status: 200, body: { url: link.url, provider: res.mode } };
}

// ---------- callback / check ----------

export interface ProviderCallbackResult {
  redirect: string;
}

const okRedirect = (platform: string) => ({ redirect: `/app?connected=${encodeURIComponent(platform)}` });
const errRedirect = (platform: string) => ({ redirect: `/app?connect_error=${encodeURIComponent(platform)}` });

export async function callbackViaProvider(deps: HandlerDeps, providerId: string, requestUrl: string): Promise<ProviderCallbackResult> {
  const params = new URL(requestUrl).searchParams;
  const platform = params.get("platform") || "";
  const entry = connectorEntry(platform);
  if (!entry || entry.flow === "none") return errRedirect(platform || "provider");
  if (!deps.config.dbConfigured || !deps.db) return { redirect: "/app" };
  const db = deps.db;
  const state = params.get("state") || "";
  if (!state) return errRedirect(entry.id);

  const stateRow = await consumeOauthState(db, state).catch(() => null);
  if (!stateRow || stateRow.platform !== entry.id) {
    deps.log?.(`connectors.provider.callback provider=${providerId} platform=${entry.id} reason=bad_state`);
    return errRedirect(entry.id);
  }
  const now = deps.now();
  const accountId = stateRow.account_id;
  const fail = async (reason: string) => {
    deps.log?.(`connectors.provider.callback provider=${providerId} platform=${entry.id} account=${accountId} reason=${reason}`);
    try {
      await markOauthFailure(db, accountId, entry.id);
    } catch {
      /* the redirect is still the right answer */
    }
    return errRedirect(entry.id);
  };
  if (!deps.userId || (await memberRole(db, deps.userId, accountId)) !== "owner") {
    deps.log?.(`connectors.provider.callback provider=${providerId} platform=${entry.id} account=${accountId} reason=session_mismatch`);
    return errRedirect(entry.id);
  }
  const expiresAt = new Date(stateRow.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return fail("state_expired");
  // Composio appends ?status=success&connected_account_id=…; anything else on `error`/`status` is a refusal.
  const cbStatus = (params.get("status") || "").toLowerCase();
  if (params.get("error") || (cbStatus && cbStatus !== "success")) return fail("provider_denied");

  const row = await getConnector(db, accountId, entry.id);
  const ref = row ? providerRefOf(row) : null;
  if (!row || !ref || ref.provider !== providerId) return fail("no_pending_connection");
  // A connection id the provider hands back on the callback is only trusted when it matches
  // the one we recorded at start, or when we had none (Nango assigns it late).
  const cbConnectionId = params.get("connected_account_id") || params.get("connection_id") || null;
  const connectionId = ref.connectionId ?? cbConnectionId;
  const res = authProviderFor(entry.id, providerDeps(deps));
  if (res.mode === "own" || !res.provider || res.mode !== ref.provider) return fail("provider_not_configured");

  try {
    const conn = await res.provider.handleCallback({ accountId, platform: entry.id as Platform, connectionId, integration: ref.integration });
    if (conn.status !== "active") return fail(`provider_${conn.status}`);
    const externalRef = stateRow.shop ?? conn.externalRef ?? row.external_ref ?? null;
    const nextRef: ProviderRef = { ...ref, connectionId: conn.connectionId };
    await updateConnector(db, row.id, { status: "connected", external_ref: externalRef, last_sync_at: null, last_sync_result: null, sync_ref: { ...withoutProviderRef(row.sync_ref), ...providerRefPatch(nextRef) } });
    await insertSystemReceipt(db, {
      accountId,
      kind: "notification",
      platform: entry.id,
      description: `${entry.name} connected through ${providerLabel(ref.provider)} — the token is held in ${providerLabel(ref.provider)}'s vault, fetched per read, never stored here.`,
      payload: { connector_id: row.id, platform: entry.id, auth_provider: ref.provider, provider_connection_id: conn.connectionId, external_ref: externalRef },
      now: now.toISOString(),
    });
    deps.log?.(`connectors.provider.callback provider=${providerId} platform=${entry.id} account=${accountId} result=connected`);
    if (!hasPicker(entry.id) || externalRef) fireConnected(deps, { accountId, platform: entry.id as Platform, connectorId: row.id });
    return okRedirect(entry.id);
  } catch (e) {
    const code = e instanceof AuthProviderError ? e.code : "unexpected";
    return fail(`provider_${code}`);
  }
}

function fireConnected(deps: HandlerDeps, info: { accountId: string; platform: Platform; connectorId: string }) {
  try {
    deps.onConnected?.(info);
  } catch {
    /* the connection stands */
  }
}

export function providerLabel(id: AuthProviderId): string {
  return id === "composio" ? "Composio" : "Nango";
}

// ---------- disconnect ----------

export type ProviderRevoke = { ok: true; provider: AuthProviderId } | { ok: false; provider: AuthProviderId; code: string };

/** Forget the connection at the provider (their vault drops the token). Best-effort; the
    caller still clears the pointer and flips the row. */
export async function revokeViaProvider(deps: HandlerDeps, entry: ConnectorEntry, row: ConnectorRow, ref: ProviderRef): Promise<ProviderRevoke> {
  const res = authProviderFor(entry.id, providerDeps(deps));
  const provider: AuthProvider | null = res.mode !== "own" && res.provider && res.mode === ref.provider ? res.provider : null;
  if (!provider) return { ok: false, provider: ref.provider, code: "provider_not_configured" };
  if (!ref.connectionId) return { ok: false, provider: ref.provider, code: "no_connection" };
  try {
    await provider.deleteConnection({ accountId: row.account_id, platform: entry.id as Platform, connectionId: ref.connectionId, integration: ref.integration });
    return { ok: true, provider: ref.provider };
  } catch (e) {
    return { ok: false, provider: ref.provider, code: e instanceof AuthProviderError ? e.code : "unexpected" };
  }
}

/** Drop the pointer from the row (after a disconnect). */
export async function clearProviderRef(db: DbClient, row: ConnectorRow): Promise<void> {
  await updateConnector(db, row.id, { sync_ref: withoutProviderRef(row.sync_ref) });
}
