import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fakeSupabase";
import { accountContextGeneration, captureMemoryContext, contextMemoryDb, contextRequestMatches, contextStillCurrent } from "../contextGeneration";
import { accountInitialState } from "../../platform/state";
import { persistedProjection, rowsToState, stateToRows } from "../mapping";

const setup = () => {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: "a", context_generation: 2 }, { id: "b", context_generation: 1 }]);
  db.seed("memories", [
    { id: "old", account_id: "a", context_generation: 1, text: "old", kind: "fact", source: "chat" },
    { id: "current", account_id: "a", context_generation: 2, text: "current", kind: "fact", source: "chat" },
    { id: "other", account_id: "b", context_generation: 1, text: "other", kind: "fact", source: "chat" },
  ]);
  return db;
};

describe("captured business context", () => {
  it("allows headerless legacy requests only on the initial generation", () => {
    const req = new Request("https://unc.test");
    expect(contextRequestMatches(req, 0)).toBe(true);
    expect(contextRequestMatches(req, 1)).toBe(false);
  });

  it("captures once, never silently rebases an old operation", async () => {
    const db = setup();
    const context = await captureMemoryContext(db, "a", new Request("https://unc.test", { headers: { "x-unc-context-generation": "2" } }));
    if (context instanceof Response) throw new Error("expected context");
    db.rows("accounts")[0].context_generation = 3;
    expect(await contextStillCurrent(db, "a", context.generation)).toBe(false);
    // The fake does not implement SQL triggers. This verifies the old stamp reaches
    // the database, where verify-context-generation.sql proves it is rejected.
    await context.db.from("memories").insert({ text: "late model result", kind: "fact", source: "chat" });
    expect(db.rows("memories").at(-1)).toMatchObject({ account_id: "a", context_generation: 2 });
  });

  it("pins both memory identity dimensions for reads and updates", async () => {
    const db = setup();
    const scoped = contextMemoryDb(db, "a", 2);
    expect((await scoped.from("memories").select("id")).data).toEqual([{ id: "current" }]);
    await scoped.from("memories").update({ text: "revised" });
    expect(db.rows("memories").map(r => r.text)).toEqual(["old", "revised", "other"]);
    expect(() => scoped.from("memories").insert({ account_id: "b", text: "spoof" })).toThrow("account mismatch");
    expect(() => scoped.from("memories").delete()).toThrow("explicit history/deletion");
  });

  it("stamps insert/upsert arrays and ignores supplied stale generation", async () => {
    const db = setup();
    const scoped = contextMemoryDb(db, "a", 2);
    await scoped.from("memories").insert([{ text: "one", context_generation: 8 }, { text: "two" }]);
    await scoped.from("memories").upsert({ id: "current", text: "upserted", context_generation: 9 });
    expect(db.rows("memories").slice(-2).every(r => r.account_id === "a" && r.context_generation === 2)).toBe(true);
    expect(db.rows("memories").find(r => r.id === "current")).toMatchObject({ context_generation: 2, text: "upserted" });
  });

  it("filters vector search results by account and captured generation even when the RPC returns stale rows", async () => {
    const db = setup();
    let account: unknown;
    db.rpcs.match_memories = async args => {
      account = args.acct;
      return [{ id: "old" }, { id: "current" }, { id: "other" }];
    };
    expect(await contextMemoryDb(db, "a", 2).rpc("match_memories", { acct: "b" })).toEqual({ data: [{ id: "current" }], error: null });
    expect(account).toBe("a");
  });

  it("fails closed on missing, invalid or unavailable account generations", async () => {
    const db = setup();
    await expect(accountContextGeneration(db, "unknown")).rejects.toThrow("unavailable");
    for (const value of [-1, "2", 1.2, Number.MAX_SAFE_INTEGER + 1]) {
      db.rows("accounts")[0].context_generation = value;
      await expect(accountContextGeneration(db, "a")).rejects.toThrow("Invalid");
    }
    expect(await captureMemoryContext(db, "a")).toBeInstanceOf(Response);
  });

  it("hydrates server generation but never serializes it into a client save", () => {
    const seed = accountInitialState("NZD");
    const rows = stateToRows("a", seed);
    const state = rowsToState({ ...rows, account: { ...rows.account, context_generation: 4 } }, seed);
    expect(state.contextGeneration).toBe(4);
    expect(persistedProjection(state)).toBe(persistedProjection({ ...state, contextGeneration: 99 }));
    expect(JSON.stringify(stateToRows("a", state))).not.toContain("context_generation");
  });
});
