import { z } from "zod";
import type { AgentContext } from "../agents/client";
import { artifactHeaders } from "../artifacts/client";

export const calendarTimezone = z.string().min(1).max(100).refine(value => {
  if (value.trim() !== value) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
});
const timestamp = z.string().datetime({ offset: true });
export const calendarPreferencesSave = z.object({ timezone: calendarTimezone, expectedUpdatedAt: timestamp.nullable() }).strict();
export const calendarPreferencesView = z.object({
  accountId: z.string().uuid(), actorId: z.string().uuid(), contextGeneration: z.number().int().nonnegative(),
  routineId: z.literal("D05-W07"), timezone: calendarTimezone.nullable(), updatedAt: timestamp.nullable(),
  canEdit: z.boolean(), bound: z.boolean(), paused: z.boolean(), executedAction: z.literal("none"),
}).strict().refine(v => (v.timezone === null) === (v.updatedAt === null) && (!v.bound || !v.canEdit));
export type CalendarPreferencesView = z.infer<typeof calendarPreferencesView>;
export type CalendarPreferencesSave = z.infer<typeof calendarPreferencesSave>;
export function readCalendarPreferences(value: unknown, ctx: AgentContext): CalendarPreferencesView {
  const v = calendarPreferencesView.parse(value);
  if (!ctx.actorId || v.accountId !== ctx.accountId || v.actorId !== ctx.actorId || v.contextGeneration !== ctx.contextGeneration)
    throw Error("Calendar settings identity changed");
  return v;
}
export async function calendarPreferencesRequest(ctx: AgentContext, save?: CalendarPreferencesSave,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<CalendarPreferencesView> {
  if (!ctx.actorId) throw Error("Verified account owner required");
  if (save) calendarPreferencesSave.parse(save);
  const res = await fetcher("/api/routines/calendar-preferences", { method: save ? "POST" : "GET", cache: "no-store", signal,
    headers: { ...artifactHeaders(ctx.accountId, ctx.contextGeneration), "x-unc-actor-id": ctx.actorId,
      ...(save ? { "content-type": "application/json" } : {}) }, ...(save ? { body: JSON.stringify(save) } : {}) });
  if (!res.ok) throw Error("Calendar settings not confirmed; refresh before another change");
  const v = readCalendarPreferences(await res.json(), ctx);
  if (save && (v.timezone !== save.timezone || !v.updatedAt || v.updatedAt === save.expectedUpdatedAt))
    throw Error("Calendar save not confirmed; refresh before another change");
  return v;
}
