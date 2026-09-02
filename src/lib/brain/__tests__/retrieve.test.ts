/* Retrieval ranking: pinned constraints/preferences first, the 30-day event window next,
   then similarity (toy embedder + the fake's match_memories) or keyword+recency fallback. */

import { describe, expect, it } from "vitest";
import { addMemory } from "../memory";
import { formatMemoryLine, keywordScore, recallForContext } from "../retrieve";
import { ACCT, brainDb, clock, toyEmbed } from "./helpers";

const NOW = "2026-09-02T09:00:00.000Z";

async function seed(db: ReturnType<typeof brainDb>, embed: ReturnType<typeof toyEmbed> | null) {
  const clk = clock("2026-08-01T00:00:00.000Z");
  const o = { now: clk.now, embed };
  await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%.", source: "chat", importance: 5 }, o);
  await addMemory(db, { accountId: ACCT, kind: "preference", text: "Prefers short replies with numbers.", source: "chat", importance: 3 }, o);
  await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Ad spend is capped at NZ$3,000 per month.", source: "onboarding", importance: 5, confidence: 0.95 }, o);
  await addMemory(db, { accountId: ACCT, kind: "event", text: "Black Friday drop.", source: "chat", happensAt: "2026-11-27", importance: 4 }, o); // outside 30 days
  await addMemory(db, { accountId: ACCT, kind: "event", text: "Spring collection launch.", source: "chat", happensAt: "2026-09-15", importance: 4 }, o); // inside
  await addMemory(db, { accountId: ACCT, kind: "event", text: "Trade show in Sydney.", source: "chat", happensAt: "2026-08-20", importance: 4 }, o); // past
  await addMemory(db, { accountId: ACCT, kind: "fact", text: "Gross margin is 42%.", source: "chat", importance: 4 }, o);
  await addMemory(db, { accountId: ACCT, kind: "fact", text: "Ships from Auckland with NZ Post.", source: "scan", importance: 2 }, o);
  await addMemory(db, { accountId: ACCT, kind: "relationship", text: "Mia (sister) runs packaging.", source: "chat", importance: 3 }, o);
  await addMemory(db, { accountId: ACCT, kind: "lesson", text: "Welcome flow holds a 41% open rate.", source: "self_review", importance: 3 }, o);
  await addMemory(db, { accountId: ACCT, kind: "summary", text: "Earlier the founder asked about margin and shipping costs.", source: "chat", importance: 2 }, o);
  return clk;
}

describe("recallForContext", () => {
  it("keyword mode (no embeddings): pinned rules by importance, then upcoming events, then query matches", async () => {
    const db = brainDb();
    await seed(db, null);
    const r = await recallForContext(db, ACCT, { query: "what is our margin on shipping?", embed: null, now: () => new Date(NOW) });
    expect(r.mode).toBe("keyword");
    expect(r.memories.slice(0, 3).map((m) => m.via)).toEqual(["pinned", "pinned", "pinned"]);
    // importance 5 before 3; at equal importance the more confident rule (0.95 from onboarding) first
    expect(r.lines.slice(0, 3)).toEqual(["[constraint] Ad spend is capped at NZ$3,000 per month.", "[constraint] Never discounts below 15%.", "[preference] Prefers short replies with numbers."]);
    expect(r.lines[3]).toBe("[event 2026-09-15] Spring collection launch."); // the only event inside the next 30 days
    const upcoming = r.memories.filter((m) => m.via === "upcoming").map((m) => m.text);
    expect(upcoming).toEqual(["Spring collection launch."]); // Black Friday (too far) and the trade show (past) are not "upcoming"
    // the query slice: the memories that mention margin / shipping outrank the rest
    const slice = r.memories.filter((m) => m.via === "keyword").map((m) => m.text);
    expect(slice.slice(0, 3)).toEqual(expect.arrayContaining(["Earlier the founder asked about margin and shipping costs.", "Gross margin is 42%.", "Ships from Auckland with NZ Post."]));
    expect(slice[slice.length - 1]).not.toMatch(/margin|ship/i);
    expect(r.truncated).toBe(false);
    expect(db.calls.every((c) => c.table !== "memories" || c.op === "select" || c.op === "insert")).toBe(true);
  });

  it("similarity mode: the query is embedded and match_memories ranks the slice; pinned + events still lead", async () => {
    const db = brainDb();
    const embed = toyEmbed();
    await seed(db, embed);
    const r = await recallForContext(db, ACCT, { query: "welcome flow open rate", embed, now: () => new Date(NOW), limit: 6 });
    expect(r.mode).toBe("similarity");
    expect(embed.calls[embed.calls.length - 1]).toEqual(["welcome flow open rate"]);
    expect(r.memories.slice(0, 4).map((m) => m.via)).toEqual(["pinned", "pinned", "pinned", "upcoming"]);
    const sim = r.memories.filter((m) => m.via === "similarity");
    expect(sim[0].text).toBe("Welcome flow holds a 41% open rate.");
    expect(r.memories).toHaveLength(6);
  });

  it("falls back to keyword mode when the embedder or the RPC fails, and to recency with no query", async () => {
    const db = brainDb();
    await seed(db, null);
    const broken = async () => ({ vectors: [null], ok: false, usage: { input: 0, output: 0 }, latencyMs: 0, model: "x" });
    const r = await recallForContext(db, ACCT, { query: "margin", embed: broken, now: () => new Date(NOW) });
    expect(r.mode).toBe("keyword");
    expect(r.memories.some((m) => m.via === "keyword" && m.text === "Gross margin is 42%.")).toBe(true);

    const embed = toyEmbed();
    db.rpcs.match_memories = () => {
      throw new Error("ivfflat index missing");
    };
    const logs: string[] = [];
    const r2 = await recallForContext(db, ACCT, { query: "margin", embed, now: () => new Date(NOW), log: (e) => logs.push(e) });
    expect(r2.mode).toBe("keyword");
    expect(logs).toContain("brain.match_memories_failed");

    const r3 = await recallForContext(db, ACCT, { embed: null, now: () => new Date(NOW) });
    expect(r3.mode).toBe("none");
    expect(r3.memories.filter((m) => m.via === "keyword").length).toBeGreaterThan(0); // recency + importance still fills the slice
  });

  it("kinds restricts the query slice only; limit and the char cap hold", async () => {
    const db = brainDb();
    await seed(db, null);
    const r = await recallForContext(db, ACCT, { query: "margin", kinds: ["lesson"], embed: null, now: () => new Date(NOW) });
    expect(r.memories.filter((m) => m.via === "keyword").map((m) => m.kind)).toEqual(["lesson"]);
    expect(r.memories.filter((m) => m.via === "pinned")).toHaveLength(3);
    const capped = await recallForContext(db, ACCT, { query: "margin", embed: null, now: () => new Date(NOW), maxChars: 100 });
    expect(capped.truncated).toBe(true);
    expect(capped.lines.join("\n").length).toBeLessThanOrEqual(100);
    expect(capped.lines[0]).toBe("[constraint] Ad spend is capped at NZ$3,000 per month."); // pinned survive the cap first
    const tiny = await recallForContext(db, ACCT, { query: "margin", embed: null, now: () => new Date(NOW), limit: 2 });
    expect(tiny.memories).toHaveLength(2);
    expect(tiny.memories.every((m) => m.via === "pinned")).toBe(true);
  });

  it("forgotten memories and other accounts never surface", async () => {
    const db = brainDb();
    const clk = clock();
    const m = await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Old rule that no longer applies.", source: "chat" }, { now: clk.now, embed: null });
    await addMemory(db, { accountId: "00000000-0000-4000-8000-00000000acc2", kind: "constraint", text: "Someone else's rule.", source: "chat" }, { now: clk.now, embed: null });
    const { forget } = await import("../memory");
    await forget(db, m.memory.id, { now: clk.now });
    const r = await recallForContext(db, ACCT, { query: "rule", embed: null, now: clk.now });
    expect(r.lines).toEqual([]);
  });

  it("formatMemoryLine + keywordScore", () => {
    expect(formatMemoryLine({ kind: "event", text: "Launch", happensAt: "2026-09-15T00:00:00.000Z" })).toBe("[event 2026-09-15] Launch");
    expect(formatMemoryLine({ kind: "fact", text: "Margin 42%", happensAt: null })).toBe("[fact] Margin 42%");
    const now = new Date(NOW);
    const fresh = keywordScore("margin", { text: "Gross margin is 42%.", createdAt: NOW, importance: 3 }, now);
    const stale = keywordScore("margin", { text: "Gross margin is 42%.", createdAt: "2025-09-02T09:00:00.000Z", importance: 3 }, now);
    const miss = keywordScore("margin", { text: "Ships from Auckland.", createdAt: NOW, importance: 3 }, now);
    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(miss);
  });
});
