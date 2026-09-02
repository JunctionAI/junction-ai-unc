/* Intake keys — the bearer credential Tom's n8n workflows present to POST /api/intake.

   The plaintext is generated once and shown once; only its sha256 lands in intake_keys.key_hash
   (migration 0010). Verification hashes the presented key, looks the hash up, then re-compares
   with a timing-safe equality (same primitive as the Shopify HMAC check in
   src/lib/connectors/oauth.ts) so a near-miss and a miss cost the same. Revoked keys
   (revoked_at set) are rejected. No key value is ever placed in an Error or a log line. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { unwrap, type DbClient } from "../db/types";

export const KEY_PREFIX = "unc_ik_";

export interface IntakeKeyRow {
  id: string;
  account_id: string;
  label: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** What the settings surface may see: never the hash. */
export interface IntakeKeySummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function generateIntakeKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashIntakeKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Constant-time hex compare; false on length mismatch or non-hex input. */
export function hashesEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const ba = Buffer.from(a.toLowerCase(), "hex");
  const bb = Buffer.from(b.toLowerCase(), "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** "Bearer <key>" → key, or null. Case-insensitive scheme, single token. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

const summarise = (r: IntakeKeyRow): IntakeKeySummary => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at });

/** Service-role write (member RLS on intake_keys is read-only by design). Returns the plaintext ONCE. */
export async function createIntakeKey(service: DbClient, accountId: string, label = "n8n"): Promise<{ key: string; summary: IntakeKeySummary }> {
  const key = generateIntakeKey();
  const row = await unwrap<IntakeKeyRow>(
    "intake_keys.insert",
    service
      .from("intake_keys")
      .insert({ account_id: accountId, label: label.trim().slice(0, 80) || "n8n", key_hash: hashIntakeKey(key) })
      .select("id, account_id, label, key_hash, created_at, last_used_at, revoked_at")
      .single(),
  );
  return { key, summary: summarise(row) };
}

export async function listIntakeKeys(db: DbClient, accountId: string): Promise<IntakeKeySummary[]> {
  const rows = await unwrap<IntakeKeyRow[]>("intake_keys.select", db.from("intake_keys").select("id, account_id, label, key_hash, created_at, last_used_at, revoked_at").eq("account_id", accountId).order("created_at", { ascending: false }));
  return (rows ?? []).map(summarise);
}

/** Revoke = set revoked_at (rows are kept for the audit trail). false when no such live key on this account. */
export async function revokeIntakeKey(service: DbClient, accountId: string, keyId: string, now = new Date()): Promise<boolean> {
  const rows = await unwrap<{ id: string }[]>(
    "intake_keys.update",
    service.from("intake_keys").update({ revoked_at: now.toISOString() }).eq("account_id", accountId).eq("id", keyId).is("revoked_at", null).select("id"),
  );
  return (rows ?? []).length > 0;
}

export interface AuthenticatedKey {
  keyId: string;
  accountId: string;
}

/** null on unknown, malformed or revoked keys. Service-role read: the caller has no session. */
export async function authenticateIntakeKey(service: DbClient, presented: string | null): Promise<AuthenticatedKey | null> {
  if (!presented || !presented.startsWith(KEY_PREFIX) || presented.length > 200) return null;
  const hash = hashIntakeKey(presented);
  const row = await unwrap<IntakeKeyRow | null>("intake_keys.lookup", service.from("intake_keys").select("id, account_id, label, key_hash, created_at, last_used_at, revoked_at").eq("key_hash", hash).maybeSingle());
  if (!row || !hashesEqual(row.key_hash, hash)) return null;
  if (row.revoked_at) return null;
  return { keyId: row.id, accountId: row.account_id };
}

export async function touchIntakeKey(service: DbClient, keyId: string, now = new Date()): Promise<void> {
  await unwrap("intake_keys.touch", service.from("intake_keys").update({ last_used_at: now.toISOString() }).eq("id", keyId));
}
