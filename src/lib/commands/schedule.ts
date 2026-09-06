import type { DbClient, Row } from "../db/types";
import { unwrap } from "../db/types";
import type { CommandActor, RoutineCommand } from "./types";
import { commandId, digest } from "./queue";
import { commandChannelBinding } from "./binding";

export interface RoutineSchedule {
  id: string; revision: number; accountId: string; contextGeneration: number; userId: string;
  routineId: string; version: number; specHash: string; workflowHash: string;
  enabled: boolean; timezone: string; hour: number; minute: number; weekday: number | null;
  startsAt: string; onDate?: string | null; actor: Omit<CommandActor, "requestId">;
}
/** Scan actual UTC minutes, interpret in the saved IANA zone. The local date is
 * the durable slot key, so the repeated DST hour cannot produce two daily runs.
 * A skipped spring-forward time is skipped, never silently moved to another hour. */
export function dueSchedule(s: RoutineSchedule, now: Date): { at: string; localDate: string } | null {
  if (!s.enabled || !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(s.startsAt)) ||
      !Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23 || !Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59 ||
      s.weekday !== null && (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6)) return null;
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }); } catch { return null; }
  for (let t = Math.floor(now.getTime() / 60_000) * 60_000; t > now.getTime() - 15 * 60_000; t -= 60_000) {
    if (t < Date.parse(s.startsAt)) break;
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map(p => [p.type, p.value]));
    if (s.onDate && s.onDate !== `${p.year}-${p.month}-${p.day}`) continue;
    if (+p.hour !== s.hour || +p.minute !== s.minute || s.weekday !== null && ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) !== s.weekday) continue;
    return { at: new Date(t).toISOString(), localDate: `${p.year}-${p.month}-${p.day}` };
  }
  return null;
}

export function scheduleCommand(s: RoutineSchedule, slot: NonNullable<ReturnType<typeof dueSchedule>>, now: Date): RoutineCommand {
  const actor: CommandActor = { ...s.actor, accountId: s.accountId, contextGeneration: s.contextGeneration, userId: s.userId,
    requestId: `schedule:${s.id}:${s.revision}:${slot.localDate}` };
  const request = "Scheduled routine using its saved settings.";
  return { id: commandId(actor), actor, contextGeneration: s.contextGeneration, routineId: s.routineId,
    version: s.version, specHash: s.specHash, workflowHash: s.workflowHash, request, requestHash: digest(request),
    status: "queued", reply: "Your scheduled routine is queued; it has not completed yet.", runId: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function scheduleFromRow(r: Row): RoutineSchedule {
  const b = r.channel_binding as Row | null;
  return { id: String(r.id), revision: Number(r.revision), accountId: String(r.account_id), contextGeneration: Number(r.context_generation),
    userId: String(r.user_id), routineId: String(r.routine_id), version: Number(r.version), specHash: String(r.spec_hash), workflowHash: String(r.workflow_hash),
    enabled: r.enabled === true, timezone: String(r.timezone), hour: Number(r.hour), minute: Number(r.minute), weekday: r.weekday === null ? null : Number(r.weekday),
    startsAt: String(r.starts_at), onDate: typeof r.on_date === "string" ? r.on_date : null, actor: { accountId: String(r.account_id), userId: String(r.user_id), contextGeneration: Number(r.context_generation),
      channel: r.channel as CommandActor["channel"], ...(b ? { linkId: String(b.linkId), channelBinding: {
        bindingVersion: Number(b.bindingVersion), externalId: String(b.externalId), scopeId: String(b.scopeId),
        conversationId: String(b.conversationId), threadId: String(b.threadId),
      } } : {}) } };
}

/** DB transaction owns the claim + enqueue together. Never retry provider calls.
 * The scheduler invokes the same command consumer, not a second workflow engine. */
export async function enqueueSchedule(db: DbClient, s: RoutineSchedule, now: Date): Promise<boolean> {
  const slot = dueSchedule(s, now); if (!slot) return false;
  const c = scheduleCommand(s, slot, now);
  return await unwrap<boolean>("schedule.claim", db.rpc("claim_routine_schedule", { input: {
    scheduleId: s.id, revision: s.revision, slotAt: slot.at, localDate: slot.localDate,
    command: { id: c.id, account_id: s.accountId, user_id: s.userId, context_generation: s.contextGeneration,
      routine_id: s.routineId, version: s.version, spec_hash: s.specHash, workflow_hash: s.workflowHash,
      request_id: c.actor.requestId, channel: c.actor.channel, link_id: c.actor.linkId ?? null,
      channel_binding: commandChannelBinding(c.actor), request: c.request, request_hash: c.requestHash,
      status: c.status, reply: c.reply, created_at: c.createdAt, updated_at: c.updatedAt },
  } })) === true;
}
