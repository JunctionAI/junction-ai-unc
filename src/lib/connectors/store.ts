/* Row helpers for the connector tables — written against the DbClient slice so the unit
   tests drive them with the schema-checked fake (src/lib/db/__tests__/fakeSupabase.ts).

   All of these run under the SERVICE ROLE (connector_secrets / oauth_states deny every
   client role). Callers must have checked the session + membership first — see handlers.ts. */

import { unwrap, type DbClient } from "../db/types";
import type { SealedSecret } from "./crypto";

export type ConnectorStatus = "disconnected" | "connecting" | "connected" | "needs_reconnect" | "error";

/** Sync-provenance vocabulary for connectors.last_sync_result:
      ok            — asked, got rows
      empty         — asked, platform said nothing happened
      error:<code>  — couldn't ask (auth, network, provider) — NOT the same as empty. */
export type SyncResult = "ok" | "empty" | `error:${string}`;

export interface ConnectorRow {
  id: string;
  account_id: string;
  platform: string;
  status: ConnectorStatus;
  external_ref: string | null;
  last_sync_at: string | null;
  last_sync_result: string | null;
  sync_ref: Record<string, unknown> | null;
}

export interface OauthStateRow {
  state: string;
  account_id: string;
  platform: string;
  code_verifier: string | null;
  shop: string | null;
  redirect_to: string;
  expires_at: string;
}

const CONNECTOR_COLS = "id, account_id, platform, status, external_ref, last_sync_at, last_sync_result, sync_ref";

/** First account the user belongs to (owner first). null = signed in but no account yet. */
export async function accountForUser(db: DbClient, userId: string): Promise<string | null> {
  const rows = await unwrap<{ account_id: string; role: string }[]>(
    "account_members.select",
    db.from("account_members").select("account_id, role").eq("user_id", userId).order("created_at", { ascending: true }),
  );
  if (!rows.length) return null;
  return (rows.find((r) => r.role === "owner") ?? rows[0]).account_id;
}

export async function isMember(db: DbClient, userId: string, accountId: string): Promise<boolean> {
  const rows = await unwrap<{ account_id: string }[]>("account_members.select", db.from("account_members").select("account_id").eq("user_id", userId).eq("account_id", accountId));
  return rows.length > 0;
}

export async function getConnector(db: DbClient, accountId: string, platform: string): Promise<ConnectorRow | null> {
  return unwrap<ConnectorRow | null>("connectors.select", db.from("connectors").select(CONNECTOR_COLS).eq("account_id", accountId).eq("platform", platform).maybeSingle());
}

/** The connector rows a platform-side identifier belongs to (a Shopify shop domain can only be
    installed once per account, but the same shop may exist on several accounts). */
export async function findConnectorsByExternalRef(db: DbClient, platform: string, externalRef: string): Promise<ConnectorRow[]> {
  return unwrap<ConnectorRow[]>("connectors.select", db.from("connectors").select(CONNECTOR_COLS).eq("platform", platform).eq("external_ref", externalRef));
}

export async function getConnectorById(db: DbClient, connectorId: string): Promise<ConnectorRow | null> {
  return unwrap<ConnectorRow | null>("connectors.select", db.from("connectors").select(CONNECTOR_COLS).eq("id", connectorId).maybeSingle());
}

/** Upsert on (account_id, platform); only the given columns change. Returns the row id. */
export async function upsertConnector(
  db: DbClient,
  accountId: string,
  platform: string,
  patch: { status?: ConnectorStatus; external_ref?: string | null; last_sync_at?: string | null; last_sync_result?: string | null; sync_ref?: Record<string, unknown> },
): Promise<string> {
  const row = await unwrap<{ id: string }>(
    "connectors.upsert",
    db.from("connectors").upsert({ account_id: accountId, platform, ...patch }, { onConflict: "account_id,platform" }).select("id").single(),
  );
  return row.id;
}

export async function updateConnector(
  db: DbClient,
  connectorId: string,
  patch: { status?: ConnectorStatus; external_ref?: string | null; last_sync_at?: string | null; last_sync_result?: string | null; sync_ref?: Record<string, unknown> },
): Promise<void> {
  await unwrap("connectors.update", db.from("connectors").update(patch).eq("id", connectorId));
}

export async function putSecret(db: DbClient, connectorId: string, sealed: SealedSecret, now: string): Promise<void> {
  await unwrap(
    "connector_secrets.upsert",
    db.from("connector_secrets").upsert({ connector_id: connectorId, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion, updated_at: now }, { onConflict: "connector_id" }),
  );
}

export async function getSecret(db: DbClient, connectorId: string): Promise<SealedSecret | null> {
  const row = await unwrap<{ ciphertext: string; iv: string; tag: string; key_version: number } | null>(
    "connector_secrets.select",
    db.from("connector_secrets").select("ciphertext, iv, tag, key_version").eq("connector_id", connectorId).maybeSingle(),
  );
  return row ? { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version } : null;
}

export async function deleteSecret(db: DbClient, connectorId: string): Promise<void> {
  await unwrap("connector_secrets.delete", db.from("connector_secrets").delete().eq("connector_id", connectorId));
}

export async function insertOauthState(db: DbClient, row: OauthStateRow & { created_at: string }): Promise<void> {
  await unwrap("oauth_states.insert", db.from("oauth_states").insert({ ...row }));
}

/** Read-and-delete: a state is single-use whatever happens next. */
export async function consumeOauthState(db: DbClient, state: string): Promise<OauthStateRow | null> {
  const row = await unwrap<OauthStateRow | null>(
    "oauth_states.select",
    db.from("oauth_states").select("state, account_id, platform, code_verifier, shop, redirect_to, expires_at").eq("state", state).maybeSingle(),
  );
  if (row) await unwrap("oauth_states.delete", db.from("oauth_states").delete().eq("state", state));
  return row;
}

/** Expiry sweep (call from a cron / the worker heartbeat). Returns nothing; idempotent. */
export async function sweepOauthStates(db: DbClient, now: string): Promise<void> {
  await unwrap("oauth_states.delete", db.from("oauth_states").delete().lte("expires_at", now));
}
