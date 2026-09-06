import { describe, it, expect } from "vitest";
import { dueSchedule, scheduleCommand, type RoutineSchedule } from "../schedule";

const base: RoutineSchedule = { id: "schedule-1", revision: 0, accountId: "account", userId: "owner", contextGeneration: 1,
  routineId: "D03-W01", version: 2, specHash: "spec", workflowHash: "workflow", enabled: true, timezone: "Pacific/Auckland",
  hour: 9, minute: 0, weekday: null, startsAt: "2026-01-01T00:00:00Z", actor: { accountId: "account", userId: "owner", channel: "app", contextGeneration: 1 } };
describe("saved schedule selection", () => {
  it("runs at the client's local time in winter and summer", () => {
    expect(dueSchedule(base,new Date("2026-09-06T21:00:10Z"))?.localDate).toBe("2026-09-07");
    expect(dueSchedule(base,new Date("2026-12-06T20:00:10Z"))?.localDate).toBe("2026-12-07");
  });
  it("honours weekday, off switch, start time and bounded catchup", () => {
    const now=new Date("2026-09-06T21:00:10Z");
    expect(dueSchedule({...base,weekday:1},now)).not.toBeNull();
    expect(dueSchedule({...base,weekday:2},now)).toBeNull();
    expect(dueSchedule({...base,enabled:false},now)).toBeNull();
    expect(dueSchedule({...base,startsAt:now.toISOString()},now)).toBeNull();
    expect(dueSchedule(base,new Date("2026-09-06T21:16:00Z"))).toBeNull();
  });
  it("does not silently substitute UTC for an invalid timezone", () => {
    expect(dueSchedule({...base,timezone:"Wrong/Zone"},new Date("2026-09-06T09:00:00Z"))).toBeNull();
  });
  it("uses one request identity for both occurrences of a repeated DST hour", () => {
    const s={...base,hour:2,minute:30};
    const first=new Date("2026-04-04T13:30:05Z"),second=new Date("2026-04-04T14:30:05Z");
    const a=dueSchedule(s,first)!,b=dueSchedule(s,second)!;
    expect(a.localDate).toBe("2026-04-05"); expect(b.localDate).toBe(a.localDate);
    expect(scheduleCommand(s,a,first).id).toBe(scheduleCommand(s,b,second).id);
  });
  it("separates account, schedule revision and date", () => {
    const now=new Date("2026-09-06T21:00:10Z"),slot=dueSchedule(base,now)!;
    const id=scheduleCommand(base,slot,now).id;
    expect(scheduleCommand({...base,revision:1},slot,now).id).not.toBe(id);
    expect(scheduleCommand({...base,accountId:"other"},slot,now).id).not.toBe(id);
    expect(scheduleCommand(base,{...slot,localDate:"2026-09-08"},now).id).not.toBe(id);
  });
});
