/** Content reuses the shared saved-schedule path. Simulated only — no SQL, n8n or provider.
 * Catalog WEEKLY_MON (`0 8 * * 1`) is not a Content schedule. Do not call this from loop.ts. */
import { describe, expect, it } from "vitest";
import { contentApprovalFromSavedSchedule, CONTENT_SCHEDULE_REUSE, type SavedContentScheduleClaim } from "../contentSchedule";

const now = () => new Date("2026-09-06T12:00:03.000Z");
const claim = (over: Partial<SavedContentScheduleClaim> = {}): SavedContentScheduleClaim => ({
  scheduleId: "c0a1e000-0000-4000-8000-00000000d102", revision: 0, localDate: "2026-09-06",
  slotAt: "2026-09-06T03:30:00.000Z", routineId: "D01-W02", market: "US", contextGeneration: 1,
  enabled: true, timezone: "Pacific/Auckland", ...over,
});

describe("Content saved-schedule reuse (no Monday 08:00 loop)", () => {
  it("maps an already-claimed customer slot onto admission without selecting weekday or hour", () => {
    const approval = contentApprovalFromSavedSchedule(claim(), "74802c60-149a-4405-b719-dc058d174072", now());
    expect(approval.idempotencyKey).toBe("schedule:c0a1e000-0000-4000-8000-00000000d102:0:2026-09-06");
    expect(approval.approvalReference).toBe(approval.idempotencyKey);
    expect(approval.routineId).toBe("D01-W02");
    expect(approval.market).toBe("US");
    expect(approval.maxProviderCalls).toBe(1);
    expect(CONTENT_SCHEDULE_REUSE.table).toBe("routine_schedules");
    expect(CONTENT_SCHEDULE_REUSE.claims).toBe("routine_schedule_claims");
    expect(CONTENT_SCHEDULE_REUSE.doNotAssume).toEqual({ weekday: 1, hour: 8, cadence: "0 8 * * 1" });
    expect(CONTENT_SCHEDULE_REUSE.timing).toContain("customer-selected");
  });
  it("keeps hooks and questions independent; refuses a switched-off or non-Content claim", () => {
    const questions = contentApprovalFromSavedSchedule(claim({ routineId: "D01-W03", market: "NZ" }),
      "74802c60-149a-4405-b719-dc058d174072", now());
    expect(questions.routineId).toBe("D01-W03");
    expect(questions.market).toBe("NZ");
    expect(questions.idempotencyKey).toBe("schedule:c0a1e000-0000-4000-8000-00000000d102:0:2026-09-06");
    expect(() => contentApprovalFromSavedSchedule(claim({ enabled: false }),
      "74802c60-149a-4405-b719-dc058d174072", now())).toThrow(/switched off/);
    expect(() => contentApprovalFromSavedSchedule(claim({ routineId: "D03-W01" as "D01-W02" }),
      "74802c60-149a-4405-b719-dc058d174072", now())).toThrow(/not a Content routine/);
  });
});
