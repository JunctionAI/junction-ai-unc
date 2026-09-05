/** Durable ingress contract shared by every authenticated channel webhook. */
import { digest } from "../commands/queue";
import { unwrap, type DbClient, type Row } from "../db/types";
import { readCapturedInbound, type CapturedInbound } from "./binding";
import type { InboundEvent } from "./types";

/** Select fields explicitly: provider JSON cannot inject an account, binding or generation.
 * accountScope/lifecycle are populated only by authenticated, configured provider adapters. */
export function verifiedEventSnapshot(event: InboundEvent): InboundEvent {
  return Object.freeze({
    channel: event.channel, externalId: event.externalId, externalMsgId: event.externalMsgId,
    ...(event.text !== undefined ? { text: event.text } : {}),
    ...(event.action !== undefined ? { action: event.action } : {}),
    ...(event.ackRef !== undefined ? { ackRef: event.ackRef } : {}),
    ...(event.handle !== undefined ? { handle: event.handle } : {}),
    ...(event.displayName !== undefined ? { displayName: event.displayName } : {}),
    ...(event.scopeId !== undefined ? { scopeId: event.scopeId } : {}),
    ...(event.accountScope !== undefined ? { accountScope: event.accountScope } : {}),
    ...(event.lifecycle !== undefined ? { lifecycle: event.lifecycle } : {}),
    ...(event.at !== undefined ? { at: event.at } : {}),
  });
}

export async function acceptInboundEvent(db: DbClient, input: InboundEvent): Promise<CapturedInbound> {
  const event = verifiedEventSnapshot(input);
  if (JSON.stringify(event).length > 16_000) throw new Error("Inbound event exceeds size limit");
  const id = digest([event.channel, event.scopeId ?? null, event.externalId, event.externalMsgId]);
  const saved = await unwrap<Row>("inbox.accept", db.rpc("accept_channel_inbound", { inbox_id: id, inbound_event: event }));
  const captured = readCapturedInbound(saved);
  // jsonb normalizes object key order, so compare the canonical field projection.
  if (captured.id !== id || digest(verifiedEventSnapshot(captured.event)) !== digest(event)) throw new Error("Persisted message does not match its verified ingress");
  return captured;
}

/** Returns a single durably claimed message. Never falls back to raw event processing. */
export async function claimAcceptedInbound(db: DbClient): Promise<CapturedInbound | null> {
  const row = await unwrap<Row | null>("inbox.claim_accepted", db.rpc("claim_channel_inbound"));
  return row ? readCapturedInbound(row) : null;
}
