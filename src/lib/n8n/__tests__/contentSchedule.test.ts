/** Proposed schedule interface tests. Simulated clock only — no SQL, n8n or provider. */
import { describe, expect, it } from "vitest";
import { AVGAR_PILOT_ACCOUNT } from "../shadowContract";
import { CONTENT_SCHEDULE, contentScheduleApproval, contentScheduleDue, contentScheduleIdempotencyKey,
  contentWeeklySlotUtc, type ContentScheduleCandidate } from "../contentSchedule";

const candidate = (over: Partial<ContentScheduleCandidate> = {}): ContentScheduleCandidate => ({
  accountId: AVGAR_PILOT_ACCOUNT, contextGeneration: 1, routineId: "D01-W02", enabled: true,
  timezone: "Pacific/Auckland", market: "US", ...over,
});

describe("proposed AVGAR Content weekly schedule (interface only; not wired)", () => {
  it("uses local Monday 08:00, not the UTC catalog WEEKLY_MON slot", () => {
    const auckland = contentWeeklySlotUtc(new Date("2026-09-07T19:00:00Z"), "Pacific/Auckland");
    const utc = contentWeeklySlotUtc(new Date("2026-09-07T19:00:00Z"), "UTC");
    expect(auckland.toISOString()).toBe("2026-09-06T20:00:00.000Z");
    expect(utc.toISOString()).toBe("2026-09-07T08:00:00.000Z");
    expect(auckland.toISOString()).not.toBe(utc.toISOString());
  });
  it("fires inside lookback and not before the local slot", () => {
    const c = candidate();
    expect(contentScheduleDue(new Date("2026-09-06T20:00:30Z"), [c])).toHaveLength(1);
    expect(contentScheduleDue(new Date("2026-09-06T19:59:59Z"), [c])).toHaveLength(0);
    expect(contentScheduleDue(new Date("2026-09-06T20:16:00Z"), [c])).toHaveLength(0);
    expect(contentScheduleDue(new Date("2026-09-06T20:16:00Z"), [c], 60 * 60_000)).toHaveLength(1);
  });
  it("dedups by last run and last served slot; never stacks in-flight", () => {
    const now = new Date("2026-09-06T20:01:00Z");
    expect(contentScheduleDue(now, [candidate({ lastRunStartedAt: "2026-09-06T20:00:10.000Z" })])).toHaveLength(0);
    expect(contentScheduleDue(now, [candidate({ lastServedSlot: "2026-09-06T20:00:00.000Z" })])).toHaveLength(0);
    expect(contentScheduleDue(now, [candidate({ lastRunInFlight: true })])).toHaveLength(0);
    expect(contentScheduleDue(now, [candidate({ lastRunStartedAt: "2026-08-30T20:00:00.000Z" })])).toHaveLength(1);
  });
  it("skips disabled routines, other tenants and unknown jobs", () => {
    const now = new Date("2026-09-06T20:00:30Z");
    expect(contentScheduleDue(now, [candidate({ enabled: false })])).toHaveLength(0);
    expect(contentScheduleDue(now, [candidate({ accountId: "00000000-0000-4000-8000-000000000099" })])).toHaveLength(0);
  });
  it("treats hooks and questions as independent due rows with distinct idempotency keys", () => {
    const now = new Date("2026-09-06T20:00:30Z");
    const due = contentScheduleDue(now, [candidate(), candidate({ routineId: "D01-W03", market: "NZ" })]);
    expect(due.map((d) => d.routineId).sort()).toEqual(["D01-W02", "D01-W03"]);
    expect(due[0].idempotencyKey).not.toBe(due[1].idempotencyKey);
    expect(due[0].idempotencyKey).toBe(contentScheduleIdempotencyKey("D01-W02", "US", due[0].slot));
    const approval = contentScheduleApproval(due[0], "74802c60-149a-4405-b719-dc058d174072", now);
    expect(approval).toMatchObject({ routineId: "D01-W02", market: "US", maxProviderCalls: 1, idempotencyKey: due[0].idempotencyKey });
    expect(CONTENT_SCHEDULE.routines).toEqual(["D01-W02", "D01-W03"]);
  });
});
