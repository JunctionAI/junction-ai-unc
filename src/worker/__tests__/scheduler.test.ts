import { describe, expect, it } from "vitest";
import { CADENCE } from "../../lib/runtime/catalog-specs";
import { cadenceKind, dueRoutines, type ScheduleCandidate } from "../scheduler";

const at = (iso: string) => new Date(iso);

const candidate = (over: Partial<ScheduleCandidate> = {}): ScheduleCandidate => ({
  accountId: "acct-1",
  routineId: "D01-W01",
  enabled: true,
  cadence: CADENCE.DAILY_0700,
  ...over,
});

describe("cadenceKind", () => {
  it("classifies the three cadence forms", () => {
    expect(cadenceKind("manual")).toBe("manual");
    expect(cadenceKind("event:shopify:order_created")).toBe("event");
    expect(cadenceKind("0 7 * * *")).toBe("cron");
    expect(cadenceKind("whenever")).toBe("invalid");
  });
});

describe("dueRoutines", () => {
  it("fires a daily routine on its slot", () => {
    const due = dueRoutines(at("2026-09-02T07:00:30Z"), [candidate()]);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ accountId: "acct-1", routineId: "D01-W01", cadence: "0 7 * * *" });
    expect(due[0].slot.toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });

  it("does not fire before the slot", () => {
    expect(dueRoutines(at("2026-09-02T06:59:59Z"), [candidate()])).toHaveLength(0);
  });

  it("still fires inside the look-back window (slow tick / brief restart)", () => {
    expect(dueRoutines(at("2026-09-02T07:12:00Z"), [candidate()])).toHaveLength(1);
    expect(dueRoutines(at("2026-09-02T07:16:00Z"), [candidate()])).toHaveLength(0);
    expect(dueRoutines(at("2026-09-02T07:16:00Z"), [candidate()], { lookbackMs: 60 * 60_000 })).toHaveLength(1);
  });

  it("never fires manual or event cadences", () => {
    const due = dueRoutines(at("2026-09-02T07:00:00Z"), [candidate({ cadence: "manual" }), candidate({ routineId: "D01-W02", cadence: "event:shopify:order_created" })]);
    expect(due).toHaveLength(0);
  });

  it("skips disabled routines and malformed cadences", () => {
    const due = dueRoutines(at("2026-09-02T07:00:00Z"), [candidate({ enabled: false }), candidate({ routineId: "D01-W02", cadence: "0 7 * *" })]);
    expect(due).toHaveLength(0);
  });

  it("dedups: a run started at/after the slot means the slot was served", () => {
    const now = at("2026-09-02T07:01:00Z");
    expect(dueRoutines(now, [candidate({ lastRunStartedAt: "2026-09-02T07:00:10.000Z" })])).toHaveLength(0);
    expect(dueRoutines(now, [candidate({ lastRunStartedAt: "2026-09-02T07:00:00.000Z" })])).toHaveLength(0);
    // yesterday's run does not serve today's slot
    expect(dueRoutines(now, [candidate({ lastRunStartedAt: "2026-09-01T07:00:10.000Z" })])).toHaveLength(1);
    // a manual run just before the slot does not serve it either
    expect(dueRoutines(now, [candidate({ lastRunStartedAt: "2026-09-02T06:59:00.000Z" })])).toHaveLength(1);
  });

  it("never stacks on a run that is still in flight", () => {
    expect(dueRoutines(at("2026-09-02T07:00:00Z"), [candidate({ lastRunInFlight: true })])).toHaveLength(0);
  });

  it("consecutive 60s ticks fire a slot exactly once", () => {
    const c = candidate();
    let last: string | undefined;
    let fired = 0;
    for (let m = 55; m < 70; m++) {
      const now = new Date(Date.UTC(2026, 8, 2, 6, m, 30));
      const due = dueRoutines(now, [{ ...c, lastRunStartedAt: last }]);
      if (due.length) {
        fired += due.length;
        last = now.toISOString();
      }
    }
    expect(fired).toBe(1);
  });

  it("handles every catalog cadence and several accounts", () => {
    const now = at("2026-09-07T08:00:10Z"); // Monday 08:00 — DAILY_0700 is an hour stale, WEEKLY_MON + HOURLY due
    const cands: ScheduleCandidate[] = [];
    for (const accountId of ["a", "b"]) {
      cands.push(candidate({ accountId, routineId: "D01-W01", cadence: CADENCE.DAILY_0700 }));
      cands.push(candidate({ accountId, routineId: "D01-W02", cadence: CADENCE.WEEKLY_MON }));
      cands.push(candidate({ accountId, routineId: "D02-W03", cadence: CADENCE.EVERY_6H }));
      cands.push(candidate({ accountId, routineId: "D02-W04", cadence: CADENCE.HOURLY }));
      cands.push(candidate({ accountId, routineId: "D02-W05", cadence: CADENCE.MANUAL }));
    }
    const due = dueRoutines(now, cands);
    expect(due.map((d) => `${d.accountId}:${d.routineId}`).sort()).toEqual(["a:D01-W02", "a:D02-W04", "b:D01-W02", "b:D02-W04"]);
  });
});
