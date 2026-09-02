import { describe, expect, it } from "vitest";
import { cronMatches, floorToMinute, isCronExpression, latestSlotBetween, parseCron } from "../cron";

const at = (iso: string) => new Date(iso);

describe("cronMatches", () => {
  // [expression, ISO minute, expected]
  const cases: [string, string, boolean][] = [
    // wildcards
    ["* * * * *", "2026-09-02T07:00:00Z", true],
    ["* * * * *", "2026-09-02T23:59:00Z", true],
    // fixed minute + hour (the catalog's DAILY_0700)
    ["0 7 * * *", "2026-09-02T07:00:00Z", true],
    ["0 7 * * *", "2026-09-02T07:01:00Z", false],
    ["0 7 * * *", "2026-09-02T08:00:00Z", false],
    ["0 7 * * *", "2026-09-02T07:00:45Z", true], // seconds ignored
    // weekly Monday 08:00 (WEEKLY_MON) — 2026-09-07 is a Monday
    ["0 8 * * 1", "2026-09-07T08:00:00Z", true],
    ["0 8 * * 1", "2026-09-08T08:00:00Z", false],
    ["0 8 * * 1", "2026-09-07T09:00:00Z", false],
    // every 6 hours (EVERY_6H)
    ["0 */6 * * *", "2026-09-02T00:00:00Z", true],
    ["0 */6 * * *", "2026-09-02T06:00:00Z", true],
    ["0 */6 * * *", "2026-09-02T18:00:00Z", true],
    ["0 */6 * * *", "2026-09-02T07:00:00Z", false],
    ["0 */6 * * *", "2026-09-02T06:30:00Z", false],
    // hourly
    ["0 * * * *", "2026-09-02T13:00:00Z", true],
    ["0 * * * *", "2026-09-02T13:30:00Z", false],
    // step minutes
    ["*/15 * * * *", "2026-09-02T07:45:00Z", true],
    ["*/15 * * * *", "2026-09-02T07:50:00Z", false],
    // lists
    ["0 7,19 * * *", "2026-09-02T19:00:00Z", true],
    ["0 7,19 * * *", "2026-09-02T12:00:00Z", false],
    // ranges (weekdays)
    ["30 9 * * 1-5", "2026-09-04T09:30:00Z", true], // Friday
    ["30 9 * * 1-5", "2026-09-05T09:30:00Z", false], // Saturday
    // stepped range
    ["0 9-17/4 * * *", "2026-09-02T13:00:00Z", true], // 9, 13, 17
    ["0 9-17/4 * * *", "2026-09-02T11:00:00Z", false],
    // day of month + month
    ["0 0 1 * *", "2026-10-01T00:00:00Z", true],
    ["0 0 1 * *", "2026-10-02T00:00:00Z", false],
    ["0 0 1 1 *", "2026-10-01T00:00:00Z", false], // wrong month
    ["0 0 1 1 *", "2027-01-01T00:00:00Z", true],
    // sunday as 0 and as 7 — 2026-09-06 is a Sunday
    ["0 6 * * 0", "2026-09-06T06:00:00Z", true],
    ["0 6 * * 7", "2026-09-06T06:00:00Z", true],
    // vixie dom/dow OR rule: 1st of month OR Monday
    ["0 0 1 * 1", "2026-09-07T00:00:00Z", true], // Monday, not the 1st
    ["0 0 1 * 1", "2026-10-01T00:00:00Z", true], // 1st (a Thursday)
    ["0 0 1 * 1", "2026-09-08T00:00:00Z", false], // neither
    // value-with-step means "from value to end, every step"
    ["5/20 * * * *", "2026-09-02T07:45:00Z", true], // 5, 25, 45
    ["5/20 * * * *", "2026-09-02T07:15:00Z", false],
  ];

  it.each(cases)("%s @ %s → %s", (expr, iso, expected) => {
    expect(cronMatches(expr, at(iso))).toBe(expected);
  });

  it("evaluates in UTC, not local time", () => {
    // 07:00Z is not 07:00 in most local zones; the matcher must not care.
    const d = new Date(Date.UTC(2026, 8, 2, 7, 0));
    expect(cronMatches("0 7 * * *", d)).toBe(true);
    expect(cronMatches(`0 ${(d.getHours() + 1) % 24} * * *`, d)).toBe(false);
  });
});

describe("parseCron", () => {
  it("expands fields into sets", () => {
    const c = parseCron("0 */6 * * 1-5");
    expect([...c.hour]).toEqual([0, 6, 12, 18]);
    expect([...c.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(c.domAny).toBe(true);
    expect(c.dowAny).toBe(false);
  });

  it.each([
    ["0 7 * *", "expected 5 fields"],
    ["60 * * * *", "out of range"],
    ["* 24 * * *", "out of range"],
    ["* * 0 * *", "out of range"],
    ["* * * 13 *", "out of range"],
    ["* * * * 8", "out of range"],
    ["a * * * *", "not a number"],
    ["*/0 * * * *", "step must be >= 1"],
    ["*/ * * * *", "missing step"],
    ["5-3 * * * *", "backwards"],
    ["1,,2 * * * *", "empty list item"],
  ])("rejects %s", (expr, message) => {
    expect(() => parseCron(expr)).toThrow(message);
    expect(isCronExpression(expr)).toBe(false);
  });

  it("accepts the catalog cadences", () => {
    for (const expr of ["0 7 * * *", "0 8 * * 1", "0 */6 * * *", "0 * * * *"]) expect(isCronExpression(expr)).toBe(true);
    expect(isCronExpression("manual")).toBe(false);
    expect(isCronExpression("event:shopify:order_created")).toBe(false);
  });
});

describe("latestSlotBetween", () => {
  it("returns the newest matching minute in (from, to]", () => {
    const slot = latestSlotBetween("0 7 * * *", at("2026-09-02T06:50:00Z"), at("2026-09-02T07:03:20Z"));
    expect(slot?.toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });

  it("is exclusive of `from` and inclusive of `to`", () => {
    expect(latestSlotBetween("0 7 * * *", at("2026-09-02T07:00:00Z"), at("2026-09-02T07:05:00Z"))).toBeNull();
    expect(latestSlotBetween("0 7 * * *", at("2026-09-02T06:59:00Z"), at("2026-09-02T07:00:00Z"))?.toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });

  it("returns null when nothing matched in the window", () => {
    expect(latestSlotBetween("0 8 * * 1", at("2026-09-02T07:00:00Z"), at("2026-09-02T07:15:00Z"))).toBeNull();
  });

  it("picks the most recent of several matches", () => {
    const slot = latestSlotBetween("*/5 * * * *", at("2026-09-02T07:00:00Z"), at("2026-09-02T07:14:59Z"));
    expect(slot?.toISOString()).toBe("2026-09-02T07:10:00.000Z");
  });

  it("floorToMinute drops seconds", () => {
    expect(floorToMinute(at("2026-09-02T07:00:59.900Z")).toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });
});
