/** Trusted server envelope, not provider-controlled fields in InboundEvent. Captured once
 * by accept_channel_inbound BEFORE acknowledgement; never resolve a new identity on drain. */
import { unwrap, type DbClient, type Row } from "../db/types";
import { runtimeGeneration, RuntimeContextError } from "../runtime/contextFence";
import { rowToLink } from "./links";
import { AUTOMATION_PAUSED_MESSAGE } from "../db/automationPause";
import type { ChannelLink, InboundEvent } from "./types";

export type InboundBinding = Readonly<{ version: 1; kind: "unlinked" }> | Readonly<{
  version: 1;
  kind: "linked" | "link_code";
  accountId: string;
  contextGeneration: number;
  linkId: string;
  bindingVersion: number;
  userId: string;
}>;

export interface CapturedInbound { readonly id: string; readonly event: InboundEvent; readonly binding: InboundBinding }

export type InboundControl = { kind: "unsubscribed"; accountId: string } |
  { kind: "linked" | "handoff" | "opened"; link: ChannelLink; captured: CapturedInbound };

/** Only the database may perform a captured code/STOP/handoff transition. Its immutable
 * receipt proves the new verified revision, while preserving the original arrival binding. */
export async function applyInboundControl(db: DbClient, captured: CapturedInbound): Promise<InboundControl> {
  const b = captured.binding;
  if (b.kind === "unlinked") throw invalid();
  const result = await unwrap<Row>("channel.control", db.rpc("apply_channel_inbound_control", { inbox_id: captured.id }));
  if (result.contextGeneration !== b.contextGeneration) throw invalid();
  if (result.kind === "unsubscribed") {
    if (result.accountId !== b.accountId) throw invalid();
    return { kind: "unsubscribed", accountId: b.accountId };
  }
  if (!result.link || typeof result.link !== "object" || !["linked", "handoff", "opened"].includes(String(result.kind))) throw invalid();
  const link = rowToLink(result.link as Row);
  if (link.id !== b.linkId || link.accountId !== b.accountId || link.userId !== b.userId || link.channel !== captured.event.channel ||
      link.externalId !== captured.event.externalId || !link.verifiedAt || link.bindingVersion < b.bindingVersion ||
      (result.kind === "linked" && b.kind !== "link_code") ||
      (result.kind !== "linked" && b.kind !== "linked") ||
      (result.kind === "opened" && link.bindingVersion !== b.bindingVersion)) throw invalid();
  return { kind: result.kind as "linked" | "handoff" | "opened", link,
    captured: Object.freeze({ ...captured, binding: Object.freeze({ ...b, kind: "linked", bindingVersion: link.bindingVersion }) }) };
}

const invalid = () => new RuntimeContextError("context_unavailable", "The message's original channel identity is unavailable.");
export function readInboundBinding(value: unknown): InboundBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const b = value as Row;
  if (b.version !== 1) throw invalid();
  if (b.kind === "unlinked") return Object.freeze({ version: 1, kind: "unlinked" });
  if (b.kind !== "linked" && b.kind !== "link_code") throw invalid();
  for (const key of ["accountId", "linkId", "userId"])
    if (typeof b[key] !== "string" || !b[key]) throw invalid();
  // Unlike legacy run snapshots, accepted messages never default a missing generation to 0.
  if (b.contextGeneration == null || b.bindingVersion == null) throw invalid();
  return Object.freeze({ version: 1, kind: b.kind, accountId: b.accountId as string,
    contextGeneration: runtimeGeneration(b.contextGeneration), linkId: b.linkId as string,
    bindingVersion: runtimeGeneration(b.bindingVersion), userId: b.userId as string });
}

export function readCapturedInbound(row: Row): CapturedInbound {
  if (typeof row.id !== "string" || !row.event || typeof row.event !== "object" || Array.isArray(row.event)) throw invalid();
  // Retain only the separately authenticated envelope. Payload properties cannot override it.
  return Object.freeze({ id: row.id, event: Object.freeze({ ...row.event as InboundEvent }), binding: readInboundBinding(row.binding) });
}

/** Short preflight, not a lock across model/provider work. Call again at consequential
 * boundaries; database writers and outbound claims must also carry this same identity. */
export async function assertInboundBinding(db: DbClient, captured: CapturedInbound, opts: { allowPaused?: boolean } = { allowPaused: true }): Promise<ChannelLink | null> {
  const b = captured.binding;
  if (b.kind === "unlinked") return null; // Never promote an unknown arrival to a new link.
  let result;
  try { result = await db.rpc("verify_channel_inbound_binding", { expected: b, inbound_event: captured.event, allow_paused: opts.allowPaused === true }); }
  catch { throw invalid(); }
  if (result.error) {
    if (result.error.code === "40001") throw new RuntimeContextError("context_changed", "The original channel connection or business context changed.");
    if (result.error.code === "P0001" && result.error.message === "automation_paused") throw new RuntimeContextError("automation_paused", AUTOMATION_PAUSED_MESSAGE);
    throw invalid();
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw invalid();
  return rowToLink(result.data as Row);
}
