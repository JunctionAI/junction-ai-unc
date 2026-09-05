/** Date-only calendar arithmetic shared by Unc validation and the receiver bundle.
 * Even on Monday, start NEXT Monday. No elapsed-hour/DST assumptions. */
export function calendarWeekStarts(startedAt: string, zone: string): string[] {
  const instant = new Date(startedAt);
  if (!Number.isFinite(instant.getTime())) throw new Error("invalid calendar run clock");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
  const date = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const days = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return Array.from({ length: 6 }, (_, i) => new Date(date.getTime() + i * 7 * 86400000).toISOString().slice(0, 10));
}
