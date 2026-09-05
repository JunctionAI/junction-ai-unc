"use client";
/* The ONE conversation, from the app's side (docs/CHANNELS.md §The chip). The corner chat keeps
   rendering its own `S.messages` (channel 'app', persisted by the autosave); turns said on
   Telegram / WhatsApp / Slack / text never enter that array, so while the corner is open in
   accounts mode this hook polls a bounded current-context snapshot (on open, then every
   20 s). `mergeThread` (pure) then
   interleaves them with the local bubbles by time — the app's own rows in the answer are the
   anchors: a channel row said after k app turns sits after the k-th local bubble.

   Demo mode never polls. Temporary transport errors retain only the same identity's snapshot;
   rejected identity or unavailable authoritative reads clear it. `initial` is scoped to the
   identity supplied on the first render, never reused as another account's seed. */

import { useEffect, useState } from "react";
import { CHANNEL_LABEL, type Channel, type MessageChannel } from "@/lib/channels/types";

export const THREAD_POLL_MS = 20_000;

export interface ThreadRow {
  id: string;
  at: string;
  sender: "user" | "unc" | "staff";
  body: string;
  channel: MessageChannel;
  appPosition?: number;
}

export interface ThreadIdentity { accountId: string; contextGeneration: number }
type ThreadResponse = { accountId?: string; contextGeneration?: number; messages?: ThreadRow[]; fallback?: boolean };
export const threadIdentityKey = (identity: ThreadIdentity | null): string | null => identity
  ? JSON.stringify([identity.accountId, identity.contextGeneration]) : null;

/** "via Telegram" / "via WhatsApp" / "via Slack" / "via Text"; null for the app's own turns. */
export function viaLabel(channel: MessageChannel): string | null {
  if (channel === "app") return null;
  return `via ${CHANNEL_LABEL[channel as Channel] ?? channel}`;
}

// Keep the server's position order on equal timestamps; UUID ordering is not chronology.
const byTime = (a: ThreadRow, b: ThreadRow) => new Date(a.at).getTime() - new Date(b.at).getTime();

/** Interleave channel rows into the local (app) bubbles by time. `local` is the corner's own list
    (possibly with a leading demo seed already stripped; possibly with unsaved turns at the end).
    Staff rows never sit on this thread. Result: one list, oldest first. */
export function mergeThread<L>(local: L[], remote: ThreadRow[], toBubble: (r: ThreadRow) => L, localOffset?: number): L[] {
  const sorted = [...remote].sort(byTime);
  const appCount = sorted.filter((r) => r.channel === "app" && r.sender !== "staff").length;
  // more app rows than local bubbles ⇒ the extra ones are leading rows the corner dropped (the demo seed)
  const offset = Math.max(0, appCount - local.length);
  const buckets = new Map<number, L[]>();
  const firstAnchor = sorted.find(r => r.channel === "app" && r.sender !== "staff" && Number.isSafeInteger(r.appPosition));
  let seenApp = localOffset !== undefined && firstAnchor ? Math.max(0, firstAnchor.appPosition! - localOffset) + offset : 0;
  for (const r of sorted) {
    if (r.sender === "staff") continue;
    if (r.channel === "app") {
      seenApp = localOffset !== undefined && Number.isSafeInteger(r.appPosition)
        ? Math.max(0, r.appPosition! + 1 - localOffset) + offset : seenApp + 1;
      continue;
    }
    const k = Math.min(local.length, Math.max(0, seenApp - offset));
    const b = buckets.get(k);
    if (b) b.push(toBubble(r));
    else buckets.set(k, [toBubble(r)]);
  }
  const out: L[] = [];
  for (let i = 0; i <= local.length; i++) {
    const b = buckets.get(i);
    if (b) out.push(...b);
    if (i < local.length) out.push(local[i]);
  }
  return out;
}

/** One poller's immutable identity. Disposal fences promises even if fetch ignores abort.
 * Full bounded snapshots include app anchors and late commits with earlier timestamps;
 * a wall-clock `since=now` cursor would silently lose those messages. */
export function createThreadPoller(identity: ThreadIdentity, accept: (rows: ThreadRow[]) => void, transport: typeof fetch = fetch) {
  let disposed = false;
  let inFlight = false;
  const controller = new AbortController();
  return {
    async pull() {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const response = await transport("/api/channels/thread?limit=500", {
          cache: "no-store", signal: controller.signal,
          headers: { "x-unc-account-id": identity.accountId, "x-unc-context-generation": String(identity.contextGeneration) },
        });
        const body = await response.json().catch(() => ({})) as ThreadResponse;
        if (disposed) return;
        if (!response.ok) {
          if ([401, 403, 409, 503].includes(response.status)) accept([]);
          return;
        }
        if (body.accountId !== identity.accountId || body.contextGeneration !== identity.contextGeneration || body.fallback || !Array.isArray(body.messages)) {
          accept([]);
          return;
        }
        accept(body.messages);
      } catch { /* A temporary network failure preserves only this identity's prior snapshot. */ }
      finally { inFlight = false; }
    },
    dispose() { disposed = true; controller.abort(); },
  };
}

export function visibleThreadRows(snapshot: { key: string | null; rows: ThreadRow[] }, key: string | null): ThreadRow[] {
  return key !== null && snapshot.key === key ? snapshot.rows : [];
}

export function useChannelThread(enabled: boolean, open: boolean, identity: ThreadIdentity | null, initial: ThreadRow[] | null = null): ThreadRow[] {
  const key = threadIdentityKey(identity);
  const [snapshot, setSnapshot] = useState(() => ({ key, rows: initial ?? [] }));
  const accountId = identity?.accountId;
  const generation = identity?.contextGeneration;

  useEffect(() => {
    if (!enabled || !open || !accountId || generation === undefined) return;
    const poller = createThreadPoller({ accountId, contextGeneration: generation }, rows => setSnapshot({ key, rows }));
    void poller.pull();
    const t = setInterval(() => void poller.pull(), THREAD_POLL_MS);
    return () => {
      poller.dispose();
      clearInterval(t);
    };
  }, [enabled, open, accountId, generation, key]);

  // Mask old rows during render, before effect cleanup runs on an identity change.
  return enabled ? visibleThreadRows(snapshot, key) : [];
}
