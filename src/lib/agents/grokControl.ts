/** Server-side control transport. No provider actions and no implicit client release. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DbClient, Row } from "../db/types";

export const changeSchema = z.object({
  changeId: z.uuid(), accountId: z.uuid(), routineId: z.string().regex(/^D0[1-5]-W0[1-9]$/),
  contextGeneration: z.number().int().nonnegative(), workerId: z.string().min(1).max(120),
  stateUpdatedAt: z.iso.datetime({ offset: true }), enabled: z.boolean(),
  schedule: z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Invalid timezone") }).strict(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type GrokChange = z.infer<typeof changeSchema>;
export const ackSchema = z.object({
  changeId: z.uuid(), workerId: z.string().min(1).max(120),
  status: z.enum(["applied", "blocked", "failed"]), enabled: z.boolean(),
  schedule: changeSchema.shape.schedule,
  blocker: z.enum(["connection_required", "skill_missing", "policy_required", "runtime_error"]).nullable(),
}).strict();
export type GrokAck = z.infer<typeof ackSchema>;
export type ControlView = { status: "setting_up" | "stopping" | "active" | "off" | "needs_attention";
  message: string; teamActionRequired: boolean };
export function controlView(change: GrokChange, ack: GrokAck | null, now: number): ControlView {
  if (ack?.status === "applied") return { status: ack.enabled ? "active" : "off",
    message: ack.enabled ? "Schedule confirmed by your agent." : "Future runs are paused.", teamActionRequired: false };
  if (ack || Date.parse(change.expiresAt) <= now) return { status: "needs_attention",
    message: ack?.blocker === "connection_required" ? "We’re finishing your connection setup." : "Our team needs to check this setup.", teamActionRequired: true };
  return { status: change.enabled ? "setting_up" : "stopping",
    message: change.enabled ? "Setting up—we’ll notify you when it’s ready." : "Waiting for your agent to confirm the pause.", teamActionRequired: false };
}

function mac(secret: string, value: string) {
  if (secret.length < 32) throw new Error("Control signing secret unavailable");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
export function callbackToken(change: GrokChange, secret: string): string {
  return mac(secret, `junction-grok-control-v1:${JSON.stringify(changeSchema.parse(change))}`);
}
function matchesToken(value: string, expected: string) {
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function validTime(change: GrokChange, now: number) {
  const start = Date.parse(change.stateUpdatedAt), end = Date.parse(change.expiresAt);
  return start <= now && now < end && end - start <= 60 * 60 * 1000 && end > start;
}
function timestampKey(value: string) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return `${Math.floor(epoch / 1000)}:${fraction.padEnd(6, "0")}`;
}
const REQUEST = "grok_control_request";
const RESULT = "grok_control_result";
const RECORDS = "grok_control_records";
async function requestRow(db: DbClient, id: string) {
  const r = await db.from(RECORDS).select("id,account_id,context_generation,payload").eq("id", id).eq("platform", REQUEST).maybeSingle();
  if (r.error) throw new Error("Control storage unavailable");
  return r.data as { id: string; account_id: string; context_generation:number; payload: { change: unknown } } | null;
}
// Stable separate UUID for the one immutable acknowledgement of a change.
export function resultId(changeId: string) {
  const hex = createHmac("sha256", "junction-grok-result-id-v1").update(changeId).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
async function resultRow(db: DbClient, change: GrokChange) {
  const r = await db.from(RECORDS).select("payload").eq("id", resultId(change.changeId))
    .eq("account_id", change.accountId).eq("context_generation",change.contextGeneration).eq("platform", RESULT).maybeSingle();
  if (r.error) throw new Error("Control storage unavailable");
  return r.data as { payload: { ack: unknown } } | null;
}
export async function currentChange(db: DbClient, change: GrokChange): Promise<boolean> {
  const [a,s] = await Promise.all([
    db.from("accounts").select("context_generation,automation_paused").eq("id", change.accountId).maybeSingle(),
    db.from("routine_states").select("enabled,updated_at").eq("account_id", change.accountId).eq("routine_id", change.routineId).maybeSingle(),
  ]);
  if (a.error || s.error) throw new Error("Control storage unavailable");
  const account = a.data as Row | null, state = s.data as Row | null;
  return !!account && !!state && account.context_generation === change.contextGeneration &&
    (!change.enabled || account.automation_paused === false) && state.enabled === change.enabled &&
    timestampKey(String(state.updated_at)) === timestampKey(change.stateUpdatedAt);
}

/** Called only by a server-authorized, registered sender. Never pass browser-supplied URLs. */
export async function dispatchGrokChange(db: DbClient, input: GrokChange, config: {
  webhookUrl: string; webhookKey: string; callbackOrigin: string; signingSecret: string;
}, fetcher: typeof fetch = fetch, now = Date.now()) {
  const change = changeSchema.parse(input);
  const target = new URL(config.webhookUrl), origin = new URL(config.callbackOrigin);
  if (target.protocol !== "https:" || target.hostname !== "api2.cursor.sh" || target.username || target.password || target.hash ||
      origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      !config.webhookKey || !validTime(change, now)) throw new Error("Invalid control configuration");
  const token = callbackToken(change, config.signingSecret);
  if (!await currentChange(db, change)) throw new Error("Saved settings changed");
  // Insert before network. Concurrent duplicate callers cannot dispatch twice.
  // A crash afterwards is deliberately ambiguous, not permission to resend.
  const inserted = await db.from(RECORDS).insert({ id: change.changeId, account_id: change.accountId, context_generation:change.contextGeneration,
    kind: "notification", platform: REQUEST, description: "Agent configuration requested; not yet confirmed.", payload: { change } });
  if (inserted.error?.code === "23505") {
    const prior = await requestRow(db, change.changeId);
    const parsed = changeSchema.safeParse(prior?.payload.change);
    if (!parsed.success || prior?.context_generation!==change.contextGeneration || JSON.stringify(parsed.data) !== JSON.stringify(change)) throw new Error("Conflicting change ID");
    return { status: "already_requested" as const };
  }
  if (inserted.error) throw new Error("Control storage unavailable");
  try {
    const response = await fetcher(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${config.webhookKey}`, "content-type": "application/json" },
      body: JSON.stringify({ contract: "junction.grok-control.v1", change,
        authority: { url: new URL(`/api/external-agents/control/${change.changeId}/authority`, origin).href,
          authorization: `Bearer ${token}`, method: "GET" },
        callback: { url: new URL(`/api/external-agents/control/${change.changeId}`, origin).href,
          authorization: `Bearer ${token}`, method: "POST" } }) });
    // Do not surface arbitrary provider bodies or claim that accepted means applied.
    return { status: response.ok ? "accepted" as const : "needs_reconciliation" as const };
  } catch { return { status: "needs_reconciliation" as const }; }
}

const json = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { "cache-control": "no-store", vary: "Authorization" } });

/** Recheck immediately before changing native configuration. Not provider-action authority
 * or an atomic lock across the remote operation; the callback rechecks again. */
export async function receiveGrokAuthority(request: Request, changeId: string, deps: {
  db: () => DbClient; secret: string; enabled: boolean; now?: () => number;
}) {
  if (!deps.enabled) return json({ error: "Control callback not released" }, 503);
  const supplied = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied) || !z.uuid().safeParse(changeId).success)
    return json({ error: "Unauthorized" }, 401);
  try {
    const db = deps.db(), row = await requestRow(db, changeId);
    const parsed = changeSchema.safeParse(row?.payload.change);
    if (!parsed.success || row?.account_id !== parsed.data.accountId ||
        row.context_generation !== parsed.data.contextGeneration ||
        !matchesToken(supplied, `Bearer ${callbackToken(parsed.data, deps.secret)}`))
      return json({ error: "Unauthorized" }, 401);
    const change = parsed.data;
    if (!validTime(change, deps.now?.() ?? Date.now())) return json({ error: "Change expired" }, 410);
    if (!await currentChange(db, change)) return json({ error: "Settings superseded this change" }, 409);
    if (await resultRow(db, change)) return json({ error: "Change already acknowledged; do not reapply" }, 409);
    return json({ authorized: true, scope: "routine_configuration_only", change });
  } catch { return json({ error: "Control storage unavailable" }, 503); }
}
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON required");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const r = await reader.read(); if (r.done) break;
    total += r.value.length; if (total > 4096) { await reader.cancel(); throw new Error("Body too large"); } chunks.push(r.value);
  } return JSON.parse(Buffer.concat(chunks).toString("utf8")); } finally { reader.releaseLock(); }
}
export async function receiveGrokAck(request: Request, changeId: string, deps: {
  db: () => DbClient; secret: string; enabled: boolean; now?: () => number;
}) {
  if (!deps.enabled) return json({ error: "Control callback not released" }, 503);
  const supplied = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied) || !z.uuid().safeParse(changeId).success) return json({ error: "Unauthorized" }, 401);
  try {
    const db = deps.db(), row = await requestRow(db, changeId);
    const parsed = changeSchema.safeParse(row?.payload.change);
    if (!parsed.success || row?.account_id !== parsed.data.accountId || row?.context_generation!==parsed.data.contextGeneration ||
      !matchesToken(supplied, `Bearer ${callbackToken(parsed.data, deps.secret)}`)) return json({ error: "Unauthorized" }, 401);
    const change = parsed.data;
    if (!validTime(change, deps.now?.() ?? Date.now())) return json({ error: "Change expired" }, 410);
    let ack: GrokAck;
    try { ack = ackSchema.parse(await readBody(request)); } catch { return json({ error: "Invalid acknowledgement" }, 400); }
    if (ack.changeId !== changeId || ack.workerId !== change.workerId ||
        (ack.status === "applied" && (ack.enabled !== change.enabled || ack.blocker !== null ||
          ack.schedule.time !== change.schedule.time || ack.schedule.timezone !== change.schedule.timezone)) ||
        (ack.status !== "applied" && !ack.blocker)) return json({ error: "Acknowledgement does not match the requested change" }, 409);
    if (!validTime(change, deps.now?.() ?? Date.now()) || !await currentChange(db, change)) return json({ error: "Settings superseded this change" }, 409);
    const insert = await db.from(RECORDS).insert({ id: resultId(changeId), account_id: change.accountId, context_generation:change.contextGeneration,
      kind: "notification", platform: RESULT, description: "Agent-reported configuration result.",
      payload: { ack, requestId: changeId, evidence: "agent_reported" } });
    if (insert.error?.code === "23505") {
      const prior = ackSchema.safeParse((await resultRow(db, change))?.payload.ack);
      if (!prior.success || JSON.stringify(prior.data) !== JSON.stringify(ack)) return json({ error: "Conflicting acknowledgement" }, 409);
      return json({ saved: true, duplicate: true });
    }
    if (insert.error) throw new Error("Control storage unavailable");
    return json({ saved: true, duplicate: false }, 201);
  } catch { return json({ error: "Control storage unavailable" }, 503); }
}

export async function readGrokChange(db: DbClient, changeId: string, accountId: string, now = Date.now()) {
  const row = await requestRow(db, changeId);
  if (!row || row.account_id !== accountId) return null;
  const change = changeSchema.parse(row.payload.change);
  if (change.accountId !== accountId || row.context_generation!==change.contextGeneration) return null;
  if (!await currentChange(db, change)) return { changeId, status: "superseded", message: "Settings changed after this request.", teamActionRequired: false };
  const stored = await resultRow(db, change);
  const ack = stored ? ackSchema.parse(stored.payload.ack) : null;
  return { changeId, routineId: change.routineId, ...controlView(change, ack, now), evidence: ack ? "agent_reported" : "pending" };
}
