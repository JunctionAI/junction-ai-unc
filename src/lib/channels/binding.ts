/** Trusted server envelope, not provider-controlled fields in InboundEvent. Captured once
 * by accept_channel_inbound BEFORE acknowledgement; never resolve a new identity on drain. */
import { unwrap, type DbClient, type Row } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { runtimeGeneration, RuntimeContextError } from "../runtime/contextFence";
import { getLink } from "./links";
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
export async function assertInboundBinding(db: DbClient, captured: CapturedInbound): Promise<ChannelLink | null> {
  const b = captured.binding;
  if (b.kind === "unlinked") return null; // Never promote an unknown arrival to a new link.
  await assertRuntimeContext(db, b, { allowPaused: true }); // STOP/unlink still needs to work while paused.
  const link = await getLink(db, b.linkId);
  if (!link || link.accountId !== b.accountId || link.userId !== b.userId || link.bindingVersion !== b.bindingVersion ||
      link.channel !== captured.event.channel ||
      (captured.event.accountScope && captured.event.accountScope !== b.accountId) ||
      (link.channel === "slack" && (!captured.event.scopeId || link.meta.team_id !== captured.event.scopeId)) ||
      (b.kind === "linked" && (!link.verifiedAt || link.externalId !== captured.event.externalId)) ||
      (b.kind === "link_code" && (link.verifiedAt || !link.linkCode || link.linkCodeGeneration !== b.contextGeneration)))
    throw new RuntimeContextError("context_changed", "The original channel connection changed. This message cannot move to another connection.");
  const member = await unwrap<Row | null>("channel.member", db.from("account_members").select("role").eq("account_id", b.accountId).eq("user_id", b.userId).maybeSingle());
  if (!member) throw new RuntimeContextError("context_changed", "The original sender no longer has access to this account.");
  await assertRuntimeContext(db, b, { allowPaused: true });
  return link;
}
