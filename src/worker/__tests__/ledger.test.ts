import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { DbIdempotencyLedger, MemoryIdempotencyLedger } from "../providers/ledger";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const META = { accountId: ACCT, runId: "run-1", actionId: "meta.adset.pause" };
const KEY = "run-1:meta.adset.pause:abc";

describe("MemoryIdempotencyLedger", () => {
  it("claims once, then duplicates; complete records the result", async () => {
    const l = new MemoryIdempotencyLedger();
    expect(await l.claim(KEY, META)).toBe("claimed");
    expect(await l.claim(KEY, META)).toBe("duplicate");
    expect(await l.seen(KEY)).toBe(true);
    await l.complete(KEY, { ok: true, externalId: "1202" });
    expect(l.entries.get(KEY)).toMatchObject({ ok: true, externalId: "1202", status: "ok" });
  });
});

describe("DbIdempotencyLedger", () => {
  it("inserts started, unique-key clash is duplicate, complete writes ok", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Test" }]);
    const l = new DbIdempotencyLedger(db);
    expect(await l.claim(KEY, META)).toBe("claimed");
    const row = db.rows("action_ledger")[0];
    expect(row).toMatchObject({ key: KEY, account_id: ACCT, run_id: "run-1", action_id: "meta.adset.pause", status: "started" });
    expect(await l.claim(KEY, META)).toBe("duplicate");
    expect(db.rows("action_ledger")).toHaveLength(1);
    await l.complete(KEY, { ok: true, externalId: "1202" });
    expect(db.rows("action_ledger")[0]).toMatchObject({ status: "ok", external_id: "1202" });
    expect(await l.seen(KEY)).toBe(true);
  });

  it("a crash after claim still refuses the retry — fail closed, no second send", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Test" }]);
    const first = new DbIdempotencyLedger(db);
    expect(await first.claim(KEY, META)).toBe("claimed");
    // process dies before complete. a new worker, same store:
    const restarted = new DbIdempotencyLedger(db);
    expect(await restarted.claim(KEY, META)).toBe("duplicate");
    expect(db.rows("action_ledger")[0].status).toBe("started");
  });

  it("failed complete records the error, still a duplicate on retry", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Test" }]);
    const l = new DbIdempotencyLedger(db);
    await l.claim(KEY, META);
    await l.complete(KEY, { ok: false, error: "token_expired — Meta says the token is dead" });
    expect(db.rows("action_ledger")[0]).toMatchObject({ status: "failed", error: "token_expired — Meta says the token is dead" });
    expect(await l.claim(KEY, META)).toBe("duplicate");
  });
});
