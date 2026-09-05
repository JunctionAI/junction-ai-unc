/** Durable intent -> one send attempt -> confirmed or uncertain outcome. No blind retries.
 * Provider acceptance is not device delivery. A reset cannot rewrite the original receipt. */
import { randomUUID } from "node:crypto";
import { unwrap, type DbClient, type Row } from "../db/types";
import { runtimeGeneration } from "../runtime/contextFence";
import { rowToLink } from "./links";
import type { ChannelLink, OutboundKind, OutboundPayload, SendResult } from "./types";

export type DeliveryStatus = "queued" | "sending" | "sent" | "failed" | "uncertain" | "cancelled";
export interface ReplyContext { live: boolean; inReplyTo: string; conversationId?: string; threadId?: string }
export interface OutboxOperation {
  contextGeneration?: number;
  ref?: string | null;
  appendToThread?: boolean;
  allowTemplate?: boolean;
  allowPaused?: boolean;
  replyContext?: ReplyContext;
}
export interface ClaimedSend { row: Row; claimed: boolean; link?: ChannelLink; template?: boolean; attempt: string }

export async function enqueueOutbound(db: DbClient, link: ChannelLink, kind: OutboundKind, payload: OutboundPayload, opts: OutboxOperation): Promise<Row> {
  if (!opts.ref || !link.userId || !link.externalId) throw new Error("A captured delivery identity and stable operation reference are required");
  if (link.slackRouteId && (!opts.replyContext?.conversationId || !opts.replyContext.threadId)) throw new Error("Original Slack conversation/thread required");
  const binding = { version: 1, kind: "linked", accountId: link.accountId,
    contextGeneration: runtimeGeneration(opts.contextGeneration), linkId: link.id, bindingVersion: runtimeGeneration(link.bindingVersion),
    userId: link.userId, channel: link.channel, externalId: link.externalId,
    ...(link.channel === "slack" ? { scopeId: link.meta.team_id } : {}),
    ...(link.channel === "slack" && opts.replyContext?.conversationId ? { conversationId: opts.replyContext.conversationId, threadId: opts.replyContext.threadId } : {}),
  };
  return unwrap<Row>("channel.enqueue", db.rpc("enqueue_channel_outbound", { operation: {
    binding, kind, ref: opts.ref, payload, appendThread: opts.appendToThread ?? true,
    allowTemplate: opts.allowTemplate ?? false, allowPaused: opts.allowPaused ?? false,
    replyContext: opts.replyContext ?? null,
  } }));
}

export async function claimOutbound(db: DbClient, id: string): Promise<ClaimedSend> {
  const attempt = randomUUID();
  const result = await unwrap<{ claimed: boolean; row: Row; link?: Row; template?: boolean }>("channel.claim",
    db.rpc("claim_channel_outbound", { outbound_id: id, send_attempt: attempt }));
  return { ...result, attempt, link: result.link ? rowToLink(result.link) : undefined };
}

export async function finishOutbound(db: DbClient, id: string, attempt: string, result: SendResult | null): Promise<Row> {
  return unwrap<Row>("channel.finish", db.rpc("finish_channel_outbound", {
    outbound_id: id, send_attempt: attempt, delivery_status: result?.ok ? "sent" : "uncertain",
    provider_id: result?.ok ? result.externalMsgId : null,
  }));
}

export async function projectOutbound(db: DbClient, id: string): Promise<void> {
  await unwrap("channel.project", db.rpc("project_channel_outbound", { outbound_id: id }));
}

/** Receipt/history repair only; never sends, retries or resolves uncertain provider facts. */
export async function maintainOutbound(db: DbClient): Promise<{ uncertain: number; expired: number; projected: number }> {
  return unwrap("channel.maintain", db.rpc("maintain_channel_outbound", { batch_limit: 50 }));
}

export const SEND_TIMEOUT_MS = 30_000;
export async function boundedSend(send: () => Promise<SendResult>): Promise<SendResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(send).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), SEND_TIMEOUT_MS); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
  // Timeout is uncertainty, not cancellation or proof that the provider did nothing.
}
