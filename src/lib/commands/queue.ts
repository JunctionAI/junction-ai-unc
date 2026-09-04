import { createHash } from "node:crypto";
import { unwrap, type DbClient, type Row } from "../db/types";
import type { CommandActor, CommandQueue, CommandStatus, RoutineCommand } from "./types";

export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function commandId(actor: CommandActor): string {
  const hash = digest([actor.accountId, actor.userId, actor.channel, actor.linkId ?? null, actor.requestId]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function encode(c: RoutineCommand): Row {
  return { id: c.id, account_id: c.actor.accountId, user_id: c.actor.userId, channel: c.actor.channel, request_id: c.actor.requestId, link_id: c.actor.linkId ?? null, request_hash: c.requestHash, routine_id: c.routineId, spec_hash: c.specHash, workflow_hash: c.workflowHash, version: c.version, request: c.request, status: c.status, reply: c.reply, run_id: c.runId, created_at: c.createdAt, updated_at: c.updatedAt };
}

function decode(r: Row): RoutineCommand {
  return { id: String(r.id), actor: { accountId: String(r.account_id), userId: String(r.user_id), channel: r.channel as CommandActor["channel"], requestId: String(r.request_id), ...(r.link_id ? { linkId: String(r.link_id) } : {}) }, requestHash: String(r.request_hash), routineId: String(r.routine_id), specHash: String(r.spec_hash), workflowHash: String(r.workflow_hash), version: Number(r.version), request: String(r.request), status: r.status as CommandStatus, reply: String(r.reply), runId: r.run_id ? String(r.run_id) : null, createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

/** Service-side only. Browser roles have no table access; GET uses an owner-bound API. */
export class DbCommandQueue implements CommandQueue {
  constructor(private readonly db: DbClient) {}
  async get(accountId: string, id: string) {
    const row = await unwrap<Row | null>("commands.get", this.db.from("routine_commands").select("*").eq("account_id", accountId).eq("id", id).maybeSingle());
    return row ? decode(row) : null;
  }
  async enqueue(c: RoutineCommand) {
    const { error } = await this.db.from("routine_commands").insert({ ...encode(c), notification_status: "pending" });
    if (error && error.code !== "23505") throw new Error("Command could not be saved");
    const saved = await this.get(c.actor.accountId, c.id);
    if (!saved || saved.requestHash !== c.requestHash) throw new Error("Request ID was reused with different content");
    return saved;
  }
  async list(status: CommandStatus, limit: number) {
    const rows = await unwrap<Row[]>("commands.list", this.db.from("routine_commands").select("*").eq("status", status).order(status === "queued" ? "created_at" : "updated_at").limit(limit));
    return rows.map(decode);
  }
  async transition(c: RoutineCommand, expected: CommandStatus, patch: Partial<Pick<RoutineCommand, "status" | "reply" | "runId" | "updatedAt">>) {
    const wire: Row = {};
    if (patch.status !== undefined) wire.status = patch.status;
    if (patch.status !== undefined && patch.status !== c.status) wire.notification_status = "pending";
    if (patch.reply !== undefined) wire.reply = patch.reply;
    if (patch.runId !== undefined) wire.run_id = patch.runId;
    if (patch.updatedAt !== undefined) wire.updated_at = patch.updatedAt;
    const row = await unwrap<Row | null>("commands.transition", this.db.from("routine_commands").update(wire).eq("account_id", c.actor.accountId).eq("id", c.id).eq("status", expected).eq("updated_at", c.updatedAt).select("*").maybeSingle());
    return row ? decode(row) : null;
  }
}
