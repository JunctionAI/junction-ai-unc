/** Verified Slack/SMS events are persisted BEFORE HTTP acknowledgement. No model/network
 * execution inside the ingress request. Provider retries dedupe by channel/sender/event. */
import { unwrap, type DbClient } from "../db/types";
import { digest } from "../commands/queue";
import type { InboundEvent } from "./types";

export async function saveInboundEvents(db: DbClient, events: InboundEvent[]): Promise<void> {
  for (const event of events) {
    if (JSON.stringify(event).length > 16_000) throw new Error("Inbound event exceeds size limit");
    const id = digest([event.channel, event.scopeId ?? null, event.externalId, event.externalMsgId]);
    const { error } = await db.from("channel_inbox").insert({ id, channel: event.channel, event, status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error && error.code !== "23505") throw new Error("Inbound event could not be persisted");
  }
}

export async function drainInboundEvents(db: DbClient, handle: (event: InboundEvent) => Promise<unknown>, maxMs = 10_000): Promise<void> {
  const started = Date.now();
  // A crash may follow a provider call. Surface the uncertainty, never resend blindly.
  await unwrap("inbox.stranded", db.from("channel_inbox").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("status", "running").lte("updated_at", new Date(Date.now() - 10 * 60_000).toISOString()));
  const rows = await unwrap<{ id: string; event: InboundEvent }[]>("inbox.list", db.from("channel_inbox").select("id, event").eq("status", "queued").order("created_at").limit(10));
  for (const row of rows) {
    if (Date.now() - started >= maxMs) break;
    const claimed = await unwrap<{ id: string } | null>("inbox.claim", db.from("channel_inbox").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "queued").select("id").maybeSingle());
    if (!claimed) continue;
    try {
      await handle(row.event);
      await unwrap("inbox.done", db.from("channel_inbox").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running"));
    } catch {
      await unwrap("inbox.uncertain", db.from("channel_inbox").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running"));
    }
  }
}
