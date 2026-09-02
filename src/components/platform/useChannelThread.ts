"use client";
/* The ONE conversation, from the app's side (docs/CHANNELS.md §The chip). The corner chat keeps
   rendering its own `S.messages` (channel 'app', persisted by the autosave); turns said on
   Telegram / WhatsApp / Slack / text never enter that array, so while the corner is open in
   accounts mode this hook polls GET /api/channels/thread?since=<last now> (on open, then every
   20 s) and hands back every non-app row it has seen, oldest first. `mergeThread` (pure) then
   interleaves them with the local bubbles by time — the app's own rows in the answer are the
   anchors: a channel row said after k app turns sits after the k-th local bubble.

   Demo mode never polls ({ fallback: true } would come back anyway). Errors are silent: the
   thread simply shows what it has. `initial` lets a server render / test start with rows. */

import { useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL, type Channel, type MessageChannel } from "@/lib/channels/types";

export const THREAD_POLL_MS = 20_000;

export interface ThreadRow {
  id: string;
  at: string;
  sender: "user" | "unc" | "staff";
  body: string;
  channel: MessageChannel;
}

type ThreadResponse = { messages?: ThreadRow[]; now?: string; fallback?: boolean; error?: string };

/** "via Telegram" / "via WhatsApp" / "via Slack" / "via Text"; null for the app's own turns. */
export function viaLabel(channel: MessageChannel): string | null {
  if (channel === "app") return null;
  return `via ${CHANNEL_LABEL[channel as Channel] ?? channel}`;
}

const byTime = (a: ThreadRow, b: ThreadRow) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id);

/** Interleave channel rows into the local (app) bubbles by time. `local` is the corner's own list
    (possibly with a leading demo seed already stripped; possibly with unsaved turns at the end).
    Staff rows never sit on this thread. Result: one list, oldest first. */
export function mergeThread<L>(local: L[], remote: ThreadRow[], toBubble: (r: ThreadRow) => L): L[] {
  const sorted = [...remote].sort(byTime);
  const appCount = sorted.filter((r) => r.channel === "app").length;
  // more app rows than local bubbles ⇒ the extra ones are leading rows the corner dropped (the demo seed)
  const offset = Math.max(0, appCount - local.length);
  const buckets = new Map<number, L[]>();
  let seenApp = 0;
  for (const r of sorted) {
    if (r.channel === "app") {
      seenApp++;
      continue;
    }
    if (r.sender === "staff") continue;
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

export function useChannelThread(enabled: boolean, open: boolean, initial: ThreadRow[] | null = null): ThreadRow[] {
  const [rows, setRows] = useState<ThreadRow[]>(() => (initial ?? []).filter((r) => r.channel !== "app"));
  const since = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set((initial ?? []).map((r) => r.id)));

  useEffect(() => {
    if (!enabled || !open) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const res = await fetch(`/api/channels/thread${q}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as ThreadResponse;
        if (cancelled || !res.ok || body.fallback || !Array.isArray(body.messages)) return;
        if (typeof body.now === "string") since.current = body.now;
        const fresh = body.messages.filter((m) => m.channel !== "app" && !seen.current.has(m.id));
        if (!fresh.length) return;
        for (const m of fresh) seen.current.add(m.id);
        setRows((prev) => [...prev, ...fresh].sort(byTime));
      } catch {
        /* the thread shows what it has; the next tick tries again */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), THREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, open]);

  return rows;
}
