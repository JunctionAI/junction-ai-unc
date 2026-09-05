/** All verified events are persisted with their arrival binding BEFORE acknowledgement. */
import { unwrap, type DbClient } from "../db/types";
import { acceptInboundEvent, claimAcceptedInbound } from "./acceptedInbox";
import type { CapturedInbound } from "./binding";
import type { InboundEvent } from "./types";

export async function saveInboundEvents(db: DbClient, events: InboundEvent[]): Promise<void> {
  for (const event of events) {
    await acceptInboundEvent(db, event);
  }
}

export async function drainInboundEvents(db: DbClient, handle: (message: CapturedInbound) => Promise<unknown>, maxMs = 10_000): Promise<void> {
  const started = Date.now();
  // Claim exactly one at a time; a second consumer cannot race a JS-side preflight.
  for (let count = 0; count < 10 && Date.now() - started < maxMs; count++) {
    const row = await claimAcceptedInbound(db);
    if (!row) break;
    try {
      await handle(row);
      await unwrap("inbox.done", db.from("channel_inbox").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running"));
    } catch {
      await unwrap("inbox.uncertain", db.from("channel_inbox").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running"));
    }
  }
}
