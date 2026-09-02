/* Approvals handlers on both stores: MemoryStore (demo) and SupabaseStore over the
   schema-checked fake (accounts). A paused LIVE run is seeded through the engine — the only
   way an approval comes to exist — then listed and decided through the worker's resume path. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { runRoutine } from "@/lib/runtime/engine";
import { StaticReader } from "@/lib/runtime/providers";
import type { Store } from "@/lib/runtime/store/interface";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { budgetMoveSpec, clock, draftSpec, input, QUESTIONS_FIXTURE, SPEND_FIXTURE } from "@/lib/runtime/__tests__/helpers";
import { StaticAccountsSource } from "@/worker/accounts";
import { NOT_IMPLEMENTED_REASON } from "@/worker/providers/executor";
import { buildAdapters, type ServiceDeps } from "@/worker/service";
import { decideApproval, DecideError, decideErrorStatus, listApprovalsForAccount, listPendingApprovals, listRecentDrafts, RECENT_RECEIPTS } from "../handlers";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const OTHER = "00000000-0000-4000-8000-00000000acc2";

function fakeDb() {
  const db = new FakeSupabase();
  db.seed("accounts", [
    { id: ACCT, name: "Example Co" },
    { id: OTHER, name: "Someone Else" },
  ]);
  return db;
}

interface Harness {
  store: Store;
  deps: ServiceDeps;
  clk: ReturnType<typeof clock>;
  db?: FakeSupabase;
}

function harness(kind: "memory" | "supabase"): Harness {
  const clk = clock();
  const db = kind === "supabase" ? fakeDb() : undefined;
  const store: Store = db ? new SupabaseStore(db) : new MemoryStore();
  const deps: ServiceDeps = { store, accounts: new StaticAccountsSource(), now: clk.now };
  return { store, deps, clk, db };
}

/** Pause a live mutating run at its gate for `accountId`. */
async function seedPaused(h: Harness, accountId = ACCT) {
  const adapters = { ...buildAdapters(h.deps), reader: new StaticReader(SPEND_FIXTURE, h.clk.now), now: h.clk.now };
  const r = await runRoutine(budgetMoveSpec(), input({ account: { accountId, currency: "NZD", budgetMonthly: 3000, approver: "Tom" }, triggeredBy: "manual" }), adapters, { mode: "live" });
  expect(r.status).toBe("waiting_approval");
  return r;
}

/** A finished dry run of a draft-only routine (what wave-1 founders get daily). */
async function seedDryRun(h: Harness, accountId = ACCT) {
  const adapters = { ...buildAdapters(h.deps), reader: new StaticReader(QUESTIONS_FIXTURE, h.clk.now), now: h.clk.now };
  const r = await runRoutine(draftSpec(), input({ account: { accountId, currency: "NZD", budgetMonthly: 3000 }, triggeredBy: "manual" }), adapters, { mode: "dry_run" });
  expect(r.status).toBe("done");
  return r;
}

for (const kind of ["memory", "supabase"] as const) {
  describe(`approvals handlers on ${kind}`, () => {
    it("lists the pending approval with its catalog name/category, reasoning and expiry", async () => {
      const h = harness(kind);
      const paused = await seedPaused(h);
      const listing = await listApprovalsForAccount({ store: h.store, now: h.clk.now }, ACCT);
      expect(listing.approvals).toHaveLength(1);
      const a = listing.approvals[0];
      expect(a).toMatchObject({ id: paused.approval!.id, runId: paused.runId, routineId: "D02-W01", routineName: "Daily paid decisioning", category: "Paid ads", status: "pending", decidedAt: null });
      expect(a.title).toBeTruthy();
      expect(typeof a.reasoning).toBe("string");
      expect(new Date(a.expiresAt).getTime()).toBeGreaterThan(h.clk.now().getTime());
      // the run's receipts so far are the account's most recent receipts
      expect(listing.receipts.length).toBeGreaterThan(0);
      expect(listing.receipts.every((r) => r.runId === paused.runId)).toBe(true);
      expect(listing.drafts).toEqual([]);
    });

    it("is account-scoped and skips lapsed approvals", async () => {
      const h = harness(kind);
      await seedPaused(h, OTHER);
      expect(await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT)).toEqual([]);
      await seedPaused(h, ACCT);
      expect(await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT)).toHaveLength(1);
      h.clk.advanceHours(49); // gate expiryHours default 48
      expect(await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT)).toEqual([]);
    });

    it("held → the run is skipped, the approval reads held, a taste_event + receipt are written", async () => {
      const h = harness(kind);
      const paused = await seedPaused(h);
      const out = await decideApproval(h.deps, { accountId: ACCT, approvalId: paused.approval!.id, decision: "held", decidedBy: "user-1" });
      expect(out.approval).toMatchObject({ id: paused.approval!.id, status: "held" });
      expect(out.approval.decidedAt).not.toBeNull();
      expect(out.run.status).toBe("skipped");
      expect(out.receipts.map((r) => r.kind)).toEqual(["notification"]);
      expect(out.receipts[0].description).toMatch(/^Held:/);
      expect(await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT)).toEqual([]);
      if (h.db) {
        expect(h.db.rows("taste_events").map((t) => t.action)).toEqual(["held"]);
        expect(h.db.rows("taste_events")[0].approval_id).toBe(paused.approval!.id);
      } else {
        expect((await (h.store as MemoryStore).listTasteEvents(ACCT)).map((t) => t.action)).toEqual(["held"]);
      }
    });

    it("approved → the shipped executor refuses, the run fails closed, nothing is mutated", async () => {
      const h = harness(kind);
      const paused = await seedPaused(h);
      const out = await decideApproval(h.deps, { accountId: ACCT, approvalId: paused.approval!.id, decision: "approved", decidedBy: "user-1" });
      expect(out.approval.status).toBe("approved");
      expect(out.run.status).toBe("failed");
      expect(out.run.error).toBe(NOT_IMPLEMENTED_REASON);
      expect(out.receipts.some((r) => r.kind === "mutation")).toBe(false);
      expect(out.receipts[0]).toMatchObject({ kind: "notification", approvalId: paused.approval!.id });
    });

    it("404 for unknown / another account's approval; 409 once decided", async () => {
      const h = harness(kind);
      const paused = await seedPaused(h);
      await expect(decideApproval(h.deps, { accountId: ACCT, approvalId: "missing", decision: "held" })).rejects.toMatchObject({ code: "not_found" });
      await expect(decideApproval(h.deps, { accountId: OTHER, approvalId: paused.approval!.id, decision: "held" })).rejects.toMatchObject({ code: "not_found" });
      await decideApproval(h.deps, { accountId: ACCT, approvalId: paused.approval!.id, decision: "held" });
      const again = decideApproval(h.deps, { accountId: ACCT, approvalId: paused.approval!.id, decision: "approved" });
      await expect(again).rejects.toMatchObject({ code: "already_decided" });
      // unbound (demo) caller can decide any account's approval
      const paused2 = await seedPaused(h, OTHER);
      expect((await decideApproval(h.deps, { accountId: null, approvalId: paused2.approval!.id, decision: "held" })).approval.status).toBe("held");
    });

    it("surfaces the latest dry-run drafts, one per run, newest first", async () => {
      const h = harness(kind);
      const first = await seedDryRun(h);
      h.clk.advanceHours(1);
      const second = await seedDryRun(h);
      const drafts = await listRecentDrafts({ store: h.store }, ACCT);
      expect(drafts.map((d) => d.runId)).toEqual([second.runId, first.runId]);
      expect(drafts[0]).toMatchObject({ routineId: "D01-W01", routineName: "Founder content engine", status: "done" });
      // the gate preview is the draft: what the founder would have been asked
      expect(drafts[0].description).toMatch(/^Would ask /);
      expect(drafts[0].title).toBeTruthy();
      expect(drafts[0].description).toContain(drafts[0].title);
    });

    it("caps receipts at the 10 most recent", async () => {
      const h = harness(kind);
      for (let i = 0; i < 3; i++) {
        await seedDryRun(h);
        h.clk.advanceHours(1);
      }
      const listing = await listApprovalsForAccount({ store: h.store, now: h.clk.now }, ACCT);
      expect(listing.receipts).toHaveLength(RECENT_RECEIPTS);
      const times = listing.receipts.map((r) => r.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    });
  });
}

describe("approvals handlers — accounts-only cases", () => {
  it("ignores the Phase-2 demo approval rows (client_key, no run) the autosave writes", async () => {
    const h = harness("supabase");
    h.db!.seed("approvals", [{ account_id: ACCT, client_key: "demo-ap-0", routine_id: "D02-W01", title: "Shift NZ$40/day into Advantage+ retargeting", status: "pending" }]);
    expect(await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT)).toEqual([]);
    const paused = await seedPaused(h);
    const pending = await listPendingApprovals({ store: h.store, now: h.clk.now }, ACCT);
    expect(pending.map((a) => a.id)).toEqual([paused.approval!.id]);
  });

  it("maps decide errors to HTTP statuses", () => {
    expect(decideErrorStatus(new DecideError("not_found", "x"))).toBe(404);
    expect(decideErrorStatus(new DecideError("already_decided", "x"))).toBe(409);
    expect(decideErrorStatus(new DecideError("not_resumable", "x"))).toBe(409);
  });
});
