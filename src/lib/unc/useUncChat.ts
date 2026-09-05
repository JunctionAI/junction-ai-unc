"use client";

/* Client wiring for the live Unc chat: optimistic user bubble + typing placeholder,
   one POST to /api/unc/chat, reply swapped in as an Unc bubble. On { fallback: true }
   or any error the canned reply (passed by the caller in derive.ts) is used instead —
   the chat is never dead. */

import { useCallback, useEffect, useRef } from "react";
import type { UncSend } from "@/lib/platform/derive";
import { initialState, type Msg, type PlatformState, type Setter } from "@/lib/platform/state";
import { refreshAccountFacts, stripDemoSeed, useAccountFacts } from "./accountFacts";
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
  const pendingPolls = useRef(new Set<AbortController>());
  const sending = useRef(new Set<string>());
  useEffect(() => () => {
    for (const controller of pendingPolls.current) controller.abort();
    pendingPolls.current.clear();
  }, [account.accountId, S.contextGeneration]);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  return useCallback<UncSend>(
    ({ surface, text, canned }) => {
      const key = THREAD_KEY[surface];
      const s0 = stateRef.current;
      if (sending.current.has(key) || s0[key].some((m) => m.typing)) return;
      sending.current.add(key); // synchronous guard: rapid taps cannot create two command IDs
      const inAccount = accountRef.current.mode === "account";
      const sendingAccountId = accountRef.current.accountId;
      const sendingGeneration = s0.contextGeneration ?? 0;
      const stillHere = () => accountRef.current.accountId === sendingAccountId && (stateRef.current.contextGeneration ?? 0) === sendingGeneration;
      const requestId = crypto.randomUUID();

      // Optimistic user bubble + typing indicator.
      set((s) => ({ [key]: [...s[key], { from: "u", text }, { from: "j", text: "", typing: true }] }) as Partial<PlatformState>);

      const thread = inAccount ? stripDemoSeed(s0[key], DEMO_SEED[surface]) : s0[key];
      const history = [...thread, { from: "u", text } as Msg]
        .filter((m) => !m.typing && m.text)
        .map((m) => ({ role: m.from === "u" ? "user" : "assistant", content: m.text }));

      const finish = (reply: string) =>
        set((s) => stillHere() && (s.contextGeneration ?? 0) === sendingGeneration ? ({ [key]: s[key].map((m) => (m.typing ? { from: "j", text: reply } : m)) }) as Partial<PlatformState> : {});

      const context = inAccount ? buildUncContext(s0, { mode: "account", facts: accountRef.current.facts }) : buildUncContext(s0);
      const requestController = new AbortController();
      pendingPolls.current.add(requestController);
      const requestTimeout = setTimeout(() => requestController.abort(), 60_000);
      fetch("/api/unc/chat", {
        method: "POST",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json", "x-unc-context-generation": String(sendingGeneration), ...(sendingAccountId ? { "x-unc-account-id": sendingAccountId } : {}) },
        body: JSON.stringify({ surface, messages: history, context, requestId }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (r.ok) return data;
          if (r.status === 409 && data.code === "context_changed") throw new Error("context_changed");
          throw new Error(`HTTP ${r.status}`);
        })
        .then((data: { reply?: string; fallback?: boolean; commandId?: string }) => {
          if (!stillHere()) return;
          const reply = !data.fallback && typeof data.reply === "string" ? data.reply.trim() : "";
          finish(reply || (inAccount ? "i couldn’t confirm a response. no completed work has been verified." : canned));
          if (data.commandId) {
            const controller = new AbortController();
            pendingPolls.current.add(controller);
            const poll = async () => {
              let lastReply = reply;
              try {
                for (let i = 0; i < 120 && !controller.signal.aborted; i++) {
                  await new Promise<void>((resolve) => {
                    const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
                    const timer = setTimeout(done, 3000);
                    controller.signal.addEventListener("abort", done, { once: true });
                  });
                  if (controller.signal.aborted || !stillHere()) return;
                  const lookup = new AbortController();
                  const abortLookup = () => lookup.abort();
                  controller.signal.addEventListener("abort", abortLookup, { once: true });
                  const lookupTimeout = setTimeout(abortLookup, 10_000);
                  let result: { status: string; reply: string };
                  try {
                    const response = await fetch(`/api/unc/commands?id=${encodeURIComponent(data.commandId!)}`, { signal: lookup.signal, cache: "no-store", headers: { "x-unc-context-generation": String(sendingGeneration), ...(sendingAccountId ? { "x-unc-account-id": sendingAccountId } : {}) } });
                    if (!response.ok) throw new Error("status unavailable");
                    result = await response.json() as { status: string; reply: string };
                  } finally { clearTimeout(lookupTimeout); controller.signal.removeEventListener("abort", abortLookup); }
                  if (controller.signal.aborted || !stillHere()) return;
                  if (typeof result.reply !== "string" || !["queued", "running", "waiting", "done", "blocked", "failed", "uncertain"].includes(result.status)) throw new Error("invalid status");
                  if (!["queued", "running"].includes(result.status) && result.reply !== lastReply) {
                    set((s) => stillHere() && (s.contextGeneration ?? 0) === sendingGeneration ? ({ [key]: [...s[key], { from: "j", text: result.reply }] }) as Partial<PlatformState> : {});
                    lastReply = result.reply;
                    refreshAccountFacts(true);
                  }
                  if (["done", "blocked", "failed", "uncertain"].includes(result.status)) return;
                }
                if (!controller.signal.aborted) throw new Error("status wait expired");
              } catch {
                if (!controller.signal.aborted && stillHere()) set((s) => stillHere() && (s.contextGeneration ?? 0) === sendingGeneration ? ({ [key]: [...s[key], { from: "j", text: "i can’t confirm this run’s status right now. check Routines before requesting the same work again." }] }) as Partial<PlatformState> : {});
              }
              finally { pendingPolls.current.delete(controller); }
            };
            void poll();
          }
        })
        .catch((error: unknown) => {
          if (stillHere()) finish(error instanceof Error && error.message === "context_changed"
            ? "your business context changed. reload unc before continuing — this reply wasn’t accepted for the new context."
            : inAccount ? "i couldn’t confirm whether your message was processed. check Unc before requesting the same work again." : canned);
        }).finally(() => { clearTimeout(requestTimeout); pendingPolls.current.delete(requestController); sending.current.delete(key); });
    },
    [set],
  );
}
