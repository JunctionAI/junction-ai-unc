"use client";

/* Client wiring for the live Unc chat: optimistic user bubble + typing placeholder,
   one POST to /api/unc/chat, reply swapped in as an Unc bubble. On { fallback: true }
   or any error the canned reply (passed by the caller in derive.ts) is used instead —
   the chat is never dead. */

import { useCallback, useEffect, useRef } from "react";
import type { UncSend } from "@/lib/platform/derive";
import { initialState, type Msg, type PlatformState, type Setter } from "@/lib/platform/state";
import { stripDemoSeed, useAccountFacts } from "./accountFacts";
import { buildUncContext } from "./context";

const THREAD_KEY = { corner: "messages", onboarding: "obThread" } as const;
/* Accounts mode: an account seeded from the demo state may carry the prototype's opening lines
   as real rows — they never reach the model as history (src/lib/unc/accountFacts.ts). */
const DEMO_SEED: Record<keyof typeof THREAD_KEY, string[]> = { corner: initialState.messages.map((m) => m.text), onboarding: initialState.obThread.map((m) => m.text) };

export function useUncChat(S: PlatformState, set: Setter): UncSend {
  // Always read the freshest state when a send fires (derive closures re-run per render).
  const stateRef = useRef(S);
  useEffect(() => {
    stateRef.current = S;
  }, [S]);
  // Accounts vs demo, and the account's rows: the context Unc reasons over must never carry demo furniture for a real account.
  const account = useAccountFacts();
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  return useCallback<UncSend>(
    ({ surface, text, canned }) => {
      const key = THREAD_KEY[surface];
      const s0 = stateRef.current;
      if (s0[key].some((m) => m.typing)) return; // one in-flight reply per thread
      const inAccount = accountRef.current.mode === "account";

      // Optimistic user bubble + typing indicator.
      set((s) => ({ [key]: [...s[key], { from: "u", text }, { from: "j", text: "", typing: true }] }) as Partial<PlatformState>);

      const thread = inAccount ? stripDemoSeed(s0[key], DEMO_SEED[surface]) : s0[key];
      const history = [...thread, { from: "u", text } as Msg]
        .filter((m) => !m.typing && m.text)
        .map((m) => ({ role: m.from === "u" ? "user" : "assistant", content: m.text }));

      const finish = (reply: string) =>
        set((s) => ({ [key]: s[key].map((m) => (m.typing ? { from: "j", text: reply } : m)) }) as Partial<PlatformState>);

      const context = inAccount ? buildUncContext(s0, { mode: "account", facts: accountRef.current.facts }) : buildUncContext(s0);
      fetch("/api/unc/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface, messages: history, context }),
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
