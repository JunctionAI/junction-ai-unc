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

/** Canonical account selection: oldest owned account first, otherwise oldest membership.
    Keep this in lockstep with db/accountState.listMemberships (session/UI selection). */
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

/** The user's role on the account, or null when they are not a member. */
export async function memberRole(db: DbClient, userId: string, accountId: string): Promise<"owner" | "member" | null> {
  const rows = await unwrap<{ role: string }[]>("account_members.select", db.from("account_members").select("role").eq("user_id", userId).eq("account_id", accountId));
  if (!rows.length) return null;
  return rows[0].role === "owner" ? "owner" : "member";
}

export async function listConnectors(db: DbClient, accountId: string): Promise<ConnectorRow[]> {
  return unwrap<ConnectorRow[]>("connectors.select", db.from("connectors").select(CONNECTOR_COLS).eq("account_id", accountId));
}

/** connectors.last_read_metrics (migration 0011) — read separately and best-effort so a
    database that has not applied 0011 yet still lists its connectors. */
export async function readLastReadMetrics(db: DbClient, accountId: string): Promise<Record<string, number | null>> {
  try {
    const rows = await unwrap<{ id: string; last_read_metrics: number | null }[]>("connectors.select", db.from("connectors").select("id, last_read_metrics").eq("account_id", accountId));
    return Object.fromEntries(rows.map((r) => [r.id, r.last_read_metrics === null || r.last_read_metrics === undefined ? null : Number(r.last_read_metrics)]));
  } catch {
    return {};
  }
}

/** Best-effort write of connectors.last_read_metrics (0011): never fails the caller. */
export async function writeLastReadMetrics(db: DbClient, connectorId: string, count: number): Promise<boolean> {
  try {
    await unwrap("connectors.update", db.from("connectors").update({ last_read_metrics: count }).eq("id", connectorId));
    return true;
  } catch {
    return false;
  }
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

/** Starting native OAuth must not interrupt an existing usable connection. Neither
    statement can downgrade a connected row, including a concurrent successful callback. */
export async function beginOauthConnection(db: DbClient, accountId: string, platform: string): Promise<void> {
  await unwrap("connectors.begin.insert", db.from("connectors").upsert(
    { account_id: accountId, platform, status: "connecting" },
    { onConflict: "account_id,platform", ignoreDuplicates: true },
  ));
  await unwrap("connectors.begin.update", db.from("connectors").update({ status: "connecting" })
    .eq("account_id", accountId).eq("platform", platform).in("status", ["disconnected", "needs_reconnect", "error"]));
}

/** A failed attempt is not evidence that an existing grant stopped working. Never
    recreate a removed connector or overwrite a successful connection/disconnect. */
export async function markOauthFailure(db: DbClient, accountId: string, platform: string): Promise<void> {
  await unwrap("connectors.oauth_failure", db.from("connectors").update({ status: "error", last_sync_result: "error:oauth" })
    .eq("account_id", accountId).eq("platform", platform).eq("status", "connecting"));
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

/** Atomic DELETE RETURNING: only the winning callback receives the state. A separate
    SELECT followed by DELETE allows concurrent callbacks to exchange the same code. */
export async function consumeOauthState(db: DbClient, state: string): Promise<OauthStateRow | null> {
  return unwrap<OauthStateRow | null>(
    "oauth_states.consume",
    db.from("oauth_states").delete().eq("state", state)
      .select("state, account_id, platform, code_verifier, shop, redirect_to, expires_at").maybeSingle(),
  );
}

/** Expiry sweep (call from a cron / the worker heartbeat). Returns nothing; idempotent. */
export async function sweepOauthStates(db: DbClient, now: string): Promise<void> {
  await unwrap("oauth_states.delete", db.from("oauth_states").delete().lte("expires_at", now));
}
