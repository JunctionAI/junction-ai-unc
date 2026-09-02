"use client";

/* Client wiring for the live Unc chat: optimistic user bubble + typing placeholder,
   one POST to /api/unc/chat, reply swapped in as an Unc bubble. On { fallback: true }
   or any error the canned reply (passed by the caller in derive.ts) is used instead —
   the chat is never dead. */

import { useCallback, useEffect, useRef } from "react";
import type { UncSend } from "@/lib/platform/derive";
import type { Msg, PlatformState, Setter } from "@/lib/platform/state";
import { buildUncContext } from "./context";

const THREAD_KEY = { corner: "messages", onboarding: "obThread" } as const;

export function useUncChat(S: PlatformState, set: Setter): UncSend {
  // Always read the freshest state when a send fires (derive closures re-run per render).
  const stateRef = useRef(S);
  useEffect(() => {
    stateRef.current = S;
  }, [S]);

  return useCallback<UncSend>(
    ({ surface, text, canned }) => {
      const key = THREAD_KEY[surface];
      const s0 = stateRef.current;
      if (s0[key].some((m) => m.typing)) return; // one in-flight reply per thread

      // Optimistic user bubble + typing indicator.
      set((s) => ({ [key]: [...s[key], { from: "u", text }, { from: "j", text: "", typing: true }] }) as Partial<PlatformState>);

      const history = [...s0[key], { from: "u", text } as Msg]
        .filter((m) => !m.typing && m.text)
        .map((m) => ({ role: m.from === "u" ? "user" : "assistant", content: m.text }));

      const finish = (reply: string) =>
        set((s) => ({ [key]: s[key].map((m) => (m.typing ? { from: "j", text: reply } : m)) }) as Partial<PlatformState>);

      fetch("/api/unc/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface, messages: history, context: buildUncContext(s0) }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: { reply?: string; fallback?: boolean }) => {
          const reply = !data.fallback && typeof data.reply === "string" ? data.reply.trim() : "";
          finish(reply || canned);
        })
        .catch(() => finish(canned));
    },
    [set],
  );
}
