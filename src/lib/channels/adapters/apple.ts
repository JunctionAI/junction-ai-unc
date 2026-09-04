import type { ChannelAdapter, InboundEvent, SendResult } from "../types";

export const APPLE_SETUP_NOTE = "Apple Messages is awaiting provider setup and verification. Use the app for now.";

/** Deliberately cannot be enabled by an env flag alone. No credentials or network calls.
 * Replace only after approved Infobip payload/auth, closure and delivery contracts are captured. */
export class AppleAdapter implements ChannelAdapter {
  readonly channel = "apple" as const;
  readonly configured = false;
  async send(): Promise<SendResult> {
    return { ok: false, error: APPLE_SETUP_NOTE };
  }
}

/** INTERNAL contract, NOT an Infobip webhook schema. A future authenticated receiver maps
 * documented provider fields into this shape, then persists the event before acknowledging.
 * Opaque IDs must never be treated as phone numbers, emails or app user IDs. */
export interface VerifiedAppleMessage {
  businessId: string;
  opaqueId: string;
  messageId: string;
  at: string;
  kind: "text" | "conversation_closed";
  text?: string;
}
export function normaliseAppleEvent(input: VerifiedAppleMessage, expectedBusinessId: string): InboundEvent | null {
  if (!expectedBusinessId || input.businessId !== expectedBusinessId) return null;
  if (![input.businessId, input.opaqueId, input.messageId].every(v => typeof v === "string" && /^[A-Za-z0-9:_-]{1,256}$/.test(v))) return null;
  if (!Number.isFinite(Date.parse(input.at))) return null;
  if (input.kind !== "text" && input.kind !== "conversation_closed") return null;
  if (input.kind === "text" && (typeof input.text !== "string" || !input.text.trim() || input.text.length > 4000)) return null;
  // JSON tuples avoid delimiter collisions between business and opaque customer identifiers.
  return { channel: "apple", scopeId: input.businessId, externalId: JSON.stringify([input.businessId, input.opaqueId]), externalMsgId: JSON.stringify([input.businessId, input.opaqueId, input.messageId]), at: input.at,
    ...(input.kind === "conversation_closed" ? { lifecycle: "conversation_closed" as const } : { text: input.text }) };
}
