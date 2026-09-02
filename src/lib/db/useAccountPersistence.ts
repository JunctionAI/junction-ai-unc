"use client";
/* Wires the platform state to the founder's account when — and only when — Supabase is
   configured AND a session exists. Otherwise it is a no-op and the app stays in demo mode
   (client-side state, exactly as before Phase 2).

   Sequence on mount (configured):
     1. getUser()            no user → demo mode (the proxy normally redirects /app first)
     2. ensureAccount()      existing account → hydrate state from rows
                             none / never saved → create + seed from the current client state
     3. autosave             every change after that persists, debounced 800 ms */

import { useEffect, useRef, useState } from "react";
import type { PlatformState, Setter } from "@/lib/platform/state";
import { ensureAccount, saveAccountState } from "./accountState";
import { asDb, getBrowserSupabase, isDbConfigured } from "./client";
import { persistedProjection } from "./mapping";
import { useAutosave, type AutosaveStatus } from "./useAutosave";

export type PersistenceMode = "demo" | "connecting" | "account" | "error";

export interface Persistence {
  mode: PersistenceMode;
  accountId: string | null;
  userEmail: string | null;
  autosave: AutosaveStatus;
  error: string | null;
}

export function useAccountPersistence(S: PlatformState, set: Setter): Persistence {
  const configured = isDbConfigured();
  const [mode, setMode] = useState<PersistenceMode>(configured ? "connecting" : "demo");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seedRef = useRef(S);
  useEffect(() => {
    seedRef.current = S;
  }, [S]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data, error: authErr } = await supabase.auth.getUser();
        if (authErr || !data.user) {
          if (!cancelled) setMode("demo");
          return;
        }
        const db = asDb(supabase);
        const res = await ensureAccount(db, seedRef.current, { userId: data.user.id });
        if (cancelled) return;
        setUserId(data.user.id);
        setUserEmail(data.user.email ?? null);
        setAccountId(res.accountId);
        if (!res.created) set(() => res.state);
        setMode("account");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setMode("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, set]);

  const enabled = mode === "account" && !!accountId;
  const autosave = useAutosave(
    S,
    enabled,
    async (state) => {
      if (!accountId) return;
      await saveAccountState(asDb(getBrowserSupabase()), accountId, state, { userId: userId ?? undefined });
    },
    persistedProjection,
  );

  return { mode, accountId, userEmail, autosave: autosave.status, error: error ?? autosave.error };
}
