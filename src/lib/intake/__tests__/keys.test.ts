/* Intake keys — hashing, timing-safe verification, revocation, rate limit. */

import { beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { authenticateIntakeKey, bearerFromHeader, createIntakeKey, generateIntakeKey, hashesEqual, hashIntakeKey, KEY_PREFIX, listIntakeKeys, revokeIntakeKey } from "../keys";
import { checkRateLimit, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, resetRateLimitsForTests } from "../rateLimit";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  resetRateLimitsForTests();
});

describe("key primitives", () => {
  it("generates prefixed, high-entropy keys; the hash is sha256 hex", () => {
    const k = generateIntakeKey();
    expect(k.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.length).toBeGreaterThan(40);
    expect(generateIntakeKey()).not.toBe(k);
    expect(hashIntakeKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashesEqual is strict about hex and length", () => {
    const h = hashIntakeKey("x");
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, h.toUpperCase())).toBe(true);
    expect(hashesEqual(h, hashIntakeKey("y"))).toBe(false);
    expect(hashesEqual(h, h.slice(1))).toBe(false);
    expect(hashesEqual("zz", "zz")).toBe(false);
  });
  it("bearerFromHeader", () => {
    expect(bearerFromHeader("Bearer abc")).toBe("abc");
    expect(bearerFromHeader("bearer   abc ")).toBe("abc");
    expect(bearerFromHeader("Basic abc")).toBeNull();
    expect(bearerFromHeader("Bearer a b")).toBeNull();
    expect(bearerFromHeader(null)).toBeNull();
  });
});

describe("create / authenticate / revoke", () => {
  it("stores only the hash, returns the plaintext once, and the plaintext authenticates", async () => {
    const { key, summary } = await createIntakeKey(db, ACCT, "n8n prod");
    const row = db.rows("intake_keys")[0];
    expect(row.key_hash).toBe(hashIntakeKey(key));
    expect(JSON.stringify(row)).not.toContain(key);
    expect(summary).toEqual({ id: row.id, label: "n8n prod", createdAt: "2026-09-02T09:00:00.000Z", lastUsedAt: null, revokedAt: null });
    expect(await authenticateIntakeKey(db, key)).toEqual({ keyId: row.id, accountId: ACCT });
    expect((await listIntakeKeys(db, ACCT))[0]).not.toHaveProperty("key_hash");
  });
  it("rejects unknown, malformed and revoked keys", async () => {
    const { key, summary } = await createIntakeKey(db, ACCT);
    expect(await authenticateIntakeKey(db, `${KEY_PREFIX}nope`)).toBeNull();
    expect(await authenticateIntakeKey(db, "not-a-key")).toBeNull();
    expect(await authenticateIntakeKey(db, null)).toBeNull();
    expect(await revokeIntakeKey(db, ACCT, summary.id)).toBe(true);
    expect(await authenticateIntakeKey(db, key)).toBeNull();
    expect(await revokeIntakeKey(db, ACCT, summary.id)).toBe(false); // already revoked
    expect(await revokeIntakeKey(db, "00000000-0000-4000-8000-00000000acc2", summary.id)).toBe(false); // wrong account
  });
});

describe("rate limit", () => {
  it("allows RATE_LIMIT_MAX per window per key, then 429 with a retry hint, then resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect(checkRateLimit("k1", t0 + i).allowed).toBe(true);
    const blocked = checkRateLimit("k1", t0 + 50);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkRateLimit("k2", t0 + 50).allowed).toBe(true); // other key unaffected
    expect(checkRateLimit("k1", t0 + RATE_LIMIT_WINDOW_MS).allowed).toBe(true);
  });
});
