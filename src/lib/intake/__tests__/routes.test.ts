/* POST /api/intake (bearer key), /api/intake/keys (session, owner) and the brain routes
   /api/brain/memories + /api/brain/profile (session) against the schema-checked fake. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { createIntakeKey, hashIntakeKey } from "../keys";
import { resetRateLimitsForTests, RATE_LIMIT_MAX } from "../rateLimit";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { POST as intake } from "@/app/api/intake/route";
import { DELETE as revokeKey, GET as listKeys, POST as mintKey } from "@/app/api/intake/keys/route";
import { DELETE as forget, GET as listMemories, PATCH as revise, POST as addMemory } from "@/app/api/brain/memories/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/brain/profile/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const OTHER = "00000000-0000-4000-8000-00000000acc2";
const USER = "00000000-0000-4000-8000-00000000u5e1";

const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://unc.test${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const post = (body: unknown, key: string | null, headers: Record<string, string> = {}) => intake(req("/api/intake", "POST", body, key ? { authorization: `Bearer ${key}`, ...headers } : headers));

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  resetRateLimitsForTests();
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [
    { id: ACCT, name: "Example Co" },
    { id: OTHER, name: "Other Co" },
  ]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
});
afterEach(() => restoreEnv());

describe("POST /api/intake", () => {
  it("writes with a valid key, scopes to the key's account, honours Idempotency-Key, touches last_used_at", async () => {
    const { key } = await createIntakeKey(db, ACCT);
    let res = await post({ facts: ["We ship from Auckland"], platforms: ["Shopify"] }, key, { "idempotency-key": "n8n-run-1" });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, replayed: false, written: { memories: 2, connectors: 1 }, warnings: [] });
    expect(db.rows("memories").every((m) => m.account_id === ACCT)).toBe(true);
    expect(db.rows("intake_keys")[0].last_used_at).toMatch(/^20\d\d-/);
    expect(db.rows("intake_events")[0].outcome).toMatchObject({ idempotency_key_hash: hashIntakeKey(`${ACCT}:n8n-run-1`) });

    res = await post({ facts: ["Something else"] }, key, { "idempotency-key": "n8n-run-1" });
    expect((await res.json()).replayed).toBe(true);
    expect(db.rows("memories")).toHaveLength(2);
  });
  it("401 without / with an unknown / with a revoked key; the error never echoes the key", async () => {
    expect((await post({ facts: ["x"] }, null)).status).toBe(401);
    const bogus = "unc_ik_" + "z".repeat(43);
    const r = await post({ facts: ["x"] }, bogus);
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(bogus);
    const { key, summary } = await createIntakeKey(db, ACCT);
    await db.from("intake_keys").update({ revoked_at: "2026-09-02T09:00:00.000Z" }).eq("id", summary.id);
    expect((await post({ facts: ["x"] }, key)).status).toBe(401);
    expect(db.rows("memories")).toHaveLength(0);
  });
  it("400 on bad JSON / contract violations, 429 past the rate limit, 503 when not configured", async () => {
    const { key } = await createIntakeKey(db, ACCT);
    expect((await post("{not json", key)).status).toBe(400);
    const r = await post({ goal: { baseline: "lots" } }, key);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("goal.baseline must be a number");
    resetRateLimitsForTests();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect((await post({ facts: [`f${i}`] }, key)).status).toBe(200);
    const limited = await post({ facts: ["over"] }, key);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    clearBillingEnv();
    expect((await post({ facts: ["x"] }, key)).status).toBe(503);
  });
});

describe("/api/intake/keys", () => {
  it("owner mints (plaintext once), lists (no hashes), revokes", async () => {
    let res = await mintKey(req("/api/intake/keys", "POST", { label: "n8n prod" }));
    expect(res.status).toBe(200);
    const minted = await res.json();
    expect(minted.key).toMatch(/^unc_ik_/);
    expect(minted.summary).toMatchObject({ label: "n8n prod", revokedAt: null });
    const listed = await (await listKeys()).json();
    expect(listed.keys).toEqual([minted.summary]);
    expect(JSON.stringify(listed)).not.toContain(minted.key);
    expect(JSON.stringify(listed)).not.toContain("key_hash");
    res = await revokeKey(req("/api/intake/keys", "DELETE", { id: minted.summary.id }));
    expect(await res.json()).toEqual({ ok: true });
    expect((await (await listKeys()).json()).keys[0].revokedAt).toMatch(/^20\d\d-/);
    expect((await revokeKey(req("/api/intake/keys", "DELETE", { id: minted.summary.id }))).status).toBe(404);
  });
  it("members cannot mint or revoke; no session → 401; demo mode → fallback", async () => {
    db.rows("account_members")[0].role = "member";
    expect((await mintKey(req("/api/intake/keys", "POST", {}))).status).toBe(403);
    expect((await revokeKey(req("/api/intake/keys", "DELETE", { id: "x" }))).status).toBe(403);
    user = null;
    expect((await listKeys()).status).toBe(401);
    clearBillingEnv();
    expect(await (await listKeys()).json()).toEqual({ fallback: true });
  });
});

describe("/api/brain/memories + /api/brain/profile", () => {
  it("add (founder, 1.0) → list → edit (supersedes) → forget (valid_to), always scoped to the account", async () => {
    db.seed("memories", [{ id: "00000000-0000-4000-8000-00000000m0a2", account_id: OTHER, kind: "fact", text: "Other's secret", source: "chat", confidence: 0.7, importance: 3, tags: [], valid_from: "2026-09-01T00:00:00.000Z" }]);
    let res = await addMemory(req("/api/brain/memories", "POST", { text: "Never discount the flagship", kind: "constraint" }));
    expect(res.status).toBe(200);
    const added = (await res.json()).memory;
    expect(added).toMatchObject({ kind: "constraint", text: "Never discount the flagship", source: "founder", confidence: 1, importance: 4 });
    expect((await addMemory(req("/api/brain/memories", "POST", { text: "Never discount the flagship" }))).status).toBe(409);
    expect((await addMemory(req("/api/brain/memories", "POST", { text: "x", kind: "wish" }))).status).toBe(400);

    // the fake is not RLS; the route's own account_id pin is what keeps OTHER's row out
    const listed = (await (await listMemories()).json()).memories;
    expect(listed.map((m: { text: string }) => m.text)).toEqual(["Never discount the flagship"]);

    res = await revise(req("/api/brain/memories", "PATCH", { id: added.id, text: "Never discount the flagship below 10%" }));
    const revised = (await res.json()).memory;
    expect(revised).toMatchObject({ kind: "constraint", source: "founder", confidence: 1 });
    expect(revised.id).not.toBe(added.id);
    const old = db.rows("memories").find((m) => m.id === added.id)!;
    expect(old.valid_to).toMatch(/^20\d\d-/);
    expect(old.superseded_by).toBe(revised.id);
    expect((await revise(req("/api/brain/memories", "PATCH", { id: "00000000-0000-4000-8000-00000000m0a2", text: "hijack" }))).status).toBe(404);

    expect(await (await forget(req("/api/brain/memories", "DELETE", { id: revised.id }))).json()).toEqual({ ok: true });
    expect((await (await listMemories()).json()).memories).toEqual([]);
    expect(db.rows("memories")).toHaveLength(3); // nothing deleted, only ended
    expect((await forget(req("/api/brain/memories", "DELETE", { id: "00000000-0000-4000-8000-00000000m0a2" }))).status).toBe(404);
  });
  it("rejects old browser memory writes after context repair and reads only the current generation", async () => {
    db.rows("accounts")[0].context_generation = 1;
    db.seed("memories", [{ id: "old-memory", account_id: ACCT, context_generation: 0, kind: "fact", text: "Old Junction context", source: "chat" }]);
    for (const handler of [addMemory, revise, forget]) {
      const response = await handler(req("/api/brain/memories", "POST", { id: "old-memory", text: "Stale overwrite" }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "context_changed" });
    }
    expect((await (await listMemories()).json())).toMatchObject({ memories: [], contextGeneration: 1 });
    const response = await addMemory(req("/api/brain/memories", "POST", { text: "Current context" }, { "x-unc-context-generation": "1" }));
    expect(response.status).toBe(200);
    expect(db.rows("memories")[1]).toMatchObject({ context_generation: 1, text: "Current context", account_id: ACCT });
    expect(db.rows("memories")[0].text).toBe("Old Junction context");
  });
  it("founder notes round-trip; null clears; demo mode → fallback", async () => {
    expect(await (await getProfile()).json()).toEqual({ founderNotes: null, tone: {}, cadence: {}, channels: {} });
    let res = await patchProfile(req("/api/brain/profile", "PATCH", { founderNotes: "  Keep it short. No Sundays.  " }));
    expect(await res.json()).toEqual({ founderNotes: "Keep it short. No Sundays." });
    expect(db.rows("account_profiles")).toMatchObject([{ account_id: ACCT, founder_notes: "Keep it short. No Sundays." }]);
    expect((await (await getProfile()).json()).founderNotes).toBe("Keep it short. No Sundays.");
    res = await patchProfile(req("/api/brain/profile", "PATCH", { founderNotes: null }));
    expect(await res.json()).toEqual({ founderNotes: null });
    expect((await patchProfile(req("/api/brain/profile", "PATCH", { founderNotes: 5 }))).status).toBe(400);
    clearBillingEnv();
    expect(await (await getProfile()).json()).toEqual({ fallback: true });
  });
});
