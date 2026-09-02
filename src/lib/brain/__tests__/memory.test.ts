/* Memory CRUD against the schema-checked fake: insert, dedupe-merge, supersession, forget,
   listing (kinds / expired), embedding on insert only when an embedder is available. */

import { describe, expect, it } from "vitest";
import { addMemory, addMemories, findBySourceRef, forget, getMemory, isNearIdentical, listMemories, normaliseText, supersede } from "../memory";
import { ACCT, OTHER, brainDb, clock, toyEmbed } from "./helpers";

describe("addMemory", () => {
  it("inserts with the schema's columns, defaults, and no embedding when nothing is configured", async () => {
    const db = brainDb();
    const clk = clock();
    const r = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "  Never  discounts below 15%. ", source: "chat", tags: ["Pricing", "pricing", " discounts "] }, { now: clk.now, embed: null });
    expect(r.merged).toBe(false);
    expect(r.memory).toMatchObject({ accountId: ACCT, kind: "constraint", text: "Never discounts below 15%.", source: "chat", confidence: 0.7, importance: 3, tags: ["pricing", "discounts"], validTo: null, supersededBy: null, happensAt: null });
    const row = db.rows("memories")[0];
    expect(row.embedding).toBeNull();
    expect(row.valid_from).toBe(row.created_at);
    const call = db.lastCall("memories", "insert");
    expect(call.columns).not.toContain("embedding"); // vectors are never read back
  });

  it("computes the embedding on insert when an embedder is available", async () => {
    const db = brainDb();
    const embed = toyEmbed();
    await addMemory(db, { accountId: ACCT, kind: "fact", text: "We ship from Auckland.", source: "onboarding" }, { embed });
    expect(embed.calls).toEqual([["We ship from Auckland."]]);
    const row = db.rows("memories")[0];
    expect(Array.isArray(row.embedding)).toBe(true);
    expect((row.embedding as number[]).length).toBe(1536);
  });

  it("clamps confidence/importance, validates kind + source, parses happens_at, rejects empty text", async () => {
    const db = brainDb();
    const r = await addMemory(db, { accountId: ACCT, kind: "event", text: "Black Friday sale starts.", source: "chat", confidence: 7, importance: 99, happensAt: "2026-11-27" }, { embed: null });
    expect(r.memory).toMatchObject({ confidence: 1, importance: 5, happensAt: "2026-11-27T00:00:00.000Z" });
    await expect(addMemory(db, { accountId: ACCT, kind: "wish" as never, text: "x y z", source: "chat" }, { embed: null })).rejects.toThrow(/kind/);
    await expect(addMemory(db, { accountId: ACCT, kind: "fact", text: "x y z", source: "dream" as never }, { embed: null })).rejects.toThrow(/source/);
    await expect(addMemory(db, { accountId: ACCT, kind: "fact", text: "   ", source: "chat" }, { embed: null })).rejects.toThrow(/empty/);
  });

  it("dedupes: same kind + near-identical text merges into the existing row (confidence/importance/tags bumped)", async () => {
    const db = brainDb();
    const clk = clock();
    const a = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%", source: "chat", confidence: 0.6, importance: 3, tags: ["pricing"] }, { now: clk.now, embed: null });
    const b = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "never DISCOUNTS below 15%.", source: "onboarding", confidence: 0.9, importance: 5, tags: ["discounts"], sourceRef: "onboarding:x" }, { now: clk.now, embed: null });
    expect(b.merged).toBe(true);
    expect(b.memory.id).toBe(a.memory.id);
    expect(b.memory).toMatchObject({ confidence: 0.95, importance: 5, tags: ["pricing", "discounts"], sourceRef: "onboarding:x" });
    expect(db.rows("memories")).toHaveLength(1);
    expect(db.rows("memories")[0]).toMatchObject({ confidence: 0.95, importance: 5, source: "chat" }); // the original row, updated in place
    // merging twice more caps confidence at 1
    await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%", source: "chat" }, { now: clk.now, embed: null });
    expect(db.rows("memories")[0].confidence).toBe(1);
  });

  it("does NOT merge across kinds, across accounts, or with a forgotten memory", async () => {
    const db = brainDb();
    await addMemory(db, { accountId: ACCT, kind: "fact", text: "Margin is 55%", source: "chat" }, { embed: null });
    const pref = await addMemory(db, { accountId: ACCT, kind: "preference", text: "Margin is 55%", source: "chat" }, { embed: null });
    const other = await addMemory(db, { accountId: OTHER, kind: "fact", text: "Margin is 55%", source: "chat" }, { embed: null });
    expect(pref.merged).toBe(false);
    expect(other.merged).toBe(false);
    expect(db.rows("memories")).toHaveLength(3);
    await forget(db, other.memory.id);
    const again = await addMemory(db, { accountId: OTHER, kind: "fact", text: "Margin is 55%", source: "chat" }, { embed: null });
    expect(again.merged).toBe(false);
    expect(db.rows("memories")).toHaveLength(4);
  });

  it("near-identical is a high bar: a different number is a different memory", async () => {
    const db = brainDb();
    await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%", source: "chat" }, { embed: null });
    const r = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 20%", source: "chat" }, { embed: null });
    expect(r.merged).toBe(false);
    expect(isNearIdentical("Ad budget is NZ$3,000 a month", "Ad budget is NZ$3,000 per month")).toBe(true);
    expect(isNearIdentical("Ad budget is NZ$3,000 a month", "Ad budget is NZ$5,000 a month")).toBe(false);
    expect(normaliseText("Don't  ship — to the US!")).toBe("dont ship to the us");
  });
});

describe("supersede / forget / list", () => {
  it("supersede closes the old memory and points it at the new one; both must exist and share an account", async () => {
    const db = brainDb();
    const clk = clock();
    const old = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%", source: "chat" }, { now: clk.now, embed: null });
    const neu = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 20%", source: "chat" }, { now: clk.now, embed: null });
    await supersede(db, old.memory.id, neu.memory.id, { now: clk.now });
    const closed = await getMemory(db, old.memory.id);
    expect(closed).toMatchObject({ validTo: clk.at().toISOString(), supersededBy: neu.memory.id });
    expect((await listMemories(db, ACCT)).map((m) => m.id)).toEqual([neu.memory.id]);
    expect((await listMemories(db, ACCT, { includeExpired: true })).map((m) => m.id).sort()).toEqual([old.memory.id, neu.memory.id].sort());
    await expect(supersede(db, neu.memory.id, neu.memory.id)).rejects.toThrow(/itself/);
    await expect(supersede(db, neu.memory.id, "00000000-0000-4000-8000-00000000dead")).rejects.toThrow(/not found/);
    const foreign = await addMemory(db, { accountId: OTHER, kind: "constraint", text: "Something else entirely", source: "chat" }, { now: clk.now, embed: null });
    await expect(supersede(db, neu.memory.id, foreign.memory.id)).rejects.toThrow(/different accounts/);
  });

  it("lists newest first, filters by kinds, honours the limit, and finds by source_ref", async () => {
    const db = brainDb();
    const clk = clock();
    await addMemory(db, { accountId: ACCT, kind: "fact", text: "First fact about the shop", source: "chat" }, { now: clk.now, embed: null });
    await addMemory(db, { accountId: ACCT, kind: "preference", text: "Likes short replies", source: "chat", sourceRef: "chat:corner:2026-09-02" }, { now: clk.now, embed: null });
    await addMemory(db, { accountId: ACCT, kind: "fact", text: "Second fact about the team", source: "chat" }, { now: clk.now, embed: null });
    await addMemory(db, { accountId: OTHER, kind: "fact", text: "Not this account", source: "chat" }, { now: clk.now, embed: null });
    expect((await listMemories(db, ACCT)).map((m) => m.text)).toEqual(["Second fact about the team", "Likes short replies", "First fact about the shop"]);
    expect((await listMemories(db, ACCT, { kinds: ["fact"] })).map((m) => m.text)).toEqual(["Second fact about the team", "First fact about the shop"]);
    expect(await listMemories(db, ACCT, { limit: 1 })).toHaveLength(1);
    expect((await findBySourceRef(db, ACCT, "chat:corner:2026-09-02")).map((m) => m.text)).toEqual(["Likes short replies"]);
  });

  it("addMemories keeps going past a bad item", async () => {
    const db = brainDb();
    const r = await addMemories(db, [{ accountId: ACCT, kind: "fact", text: "Good one here", source: "chat" }, { accountId: ACCT, kind: "fact", text: "", source: "chat" }, { accountId: ACCT, kind: "lesson", text: "Another good one", source: "chat" }], { embed: null });
    expect(r.results).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/empty/);
  });
});
