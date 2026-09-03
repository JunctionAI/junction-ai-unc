import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { AGREEMENT_MIN_DECIDED, AGREEMENT_THRESHOLD, scoreAgreement } from "../agreement";

const ACCT = "acct-1";
const NOW = new Date("2026-09-03T09:00:00.000Z");

async function decide(store: MemoryStore, n: number, status: "approved" | "held", routineId = "D02-W01", hoursAgo = 24) {
  const createdAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  const decidedAt = new Date(NOW.getTime() - (hoursAgo - 1) * 3_600_000).toISOString();
  const id = `ap-${status}-${n}`;
  await store.createApproval({ id, accountId: ACCT, runId: `run-${id}`, routineId, title: `Proposal ${n}`, status: "pending", createdAt, expiresAt: new Date(NOW.getTime() + 48 * 3_600_000).toISOString() });
  await store.updateApproval(id, { status, decidedAt, decidedBy: "founder" });
}

describe("scoreAgreement", () => {
  it("nothing decided → keep asking, apply locked", async () => {
    const store = new MemoryStore();
    const s = await scoreAgreement(store, ACCT, "D02-W01", { now: NOW });
    expect(s).toMatchObject({ decided: 0, approved: 0, held: 0, rate: null, applyUnlocked: false });
    expect(s.line).toBe("No decisions on this routine yet — I keep asking.");
  });

  it("pending and other routines do not count; window is decidedAt", async () => {
    const store = new MemoryStore();
    await store.createApproval({ id: "pend", accountId: ACCT, runId: "r1", routineId: "D02-W01", title: "x", status: "pending", createdAt: NOW.toISOString(), expiresAt: NOW.toISOString() });
    await decide(store, 1, "approved", "D01-W01");
    const old = new MemoryStore();
    await decide(old, 1, "approved", "D02-W01", 40 * 24);
    const s = await scoreAgreement(store, ACCT, "D02-W01", { now: NOW });
    expect(s.decided).toBe(0);
    expect((await scoreAgreement(old, ACCT, "D02-W01", { now: NOW, windowDays: 28 })).decided).toBe(0);
  });

  it("unlocks apply at ≥80% over the minimum decided count", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 8; i++) await decide(store, i, "approved");
    for (let i = 0; i < 2; i++) await decide(store, 100 + i, "held");
    const s = await scoreAgreement(store, ACCT, "D02-W01", { now: NOW });
    expect(s).toMatchObject({ decided: 10, approved: 8, held: 2, rate: 0.8, applyUnlocked: true });
    expect(s.line).toContain("can graduate");
    expect(AGREEMENT_THRESHOLD).toBe(0.8);
    expect(AGREEMENT_MIN_DECIDED).toBe(10);
  });

  it("stays locked when the rate is high but n is short, or n is enough but rate is under", async () => {
    const short = new MemoryStore();
    for (let i = 0; i < 9; i++) await decide(short, i, "approved");
    expect((await scoreAgreement(short, ACCT, "D02-W01", { now: NOW })).applyUnlocked).toBe(false);
    const low = new MemoryStore();
    for (let i = 0; i < 7; i++) await decide(low, i, "approved");
    for (let i = 0; i < 3; i++) await decide(low, 50 + i, "held");
    const s = await scoreAgreement(low, ACCT, "D02-W01", { now: NOW });
    expect(s.applyUnlocked).toBe(false);
    expect(s.rate).toBe(0.7);
    expect(s.line).toContain("under 80%");
  });
});
