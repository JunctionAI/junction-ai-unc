"use client";
/* Wires the platform state to the founder's account when — and only when — Supabase is
   configured AND a session exists. Otherwise it is a no-op and the app stays in demo mode
   (client-side state, exactly as before Phase 2).

   Sequence on mount (configured):
     1. getUser()            no user → demo mode (the proxy normally redirects /app first)
     2. ensureAccount()      existing account → hydrate state from rows (over the empty account seed,
                             so a partially populated account keeps honest blanks, never demo numbers)
                             none / never saved → create + seed from the EMPTY account state
                             (accountInitialState — never the prototype's founder), currency from
                             the unc_country cookie / browser language
     3. autosave             every change after that persists, debounced 800 ms */

import { useEffect, useState } from "react";
import { COUNTRY_COOKIE, cookieValue } from "@/lib/locale/resolve";
import { accountInitialState, currencyForLocale, type PlatformState, type Setter } from "@/lib/platform/state";
import { ensureAccount, saveAccountState } from "./accountState";
import { asDb, getBrowserSupabase, isDbConfigured } from "./client";
import { persistedProjection } from "./mapping";
import { useAutosave, type AutosaveStatus } from "./useAutosave";

export type PersistenceMode = "demo" | "connecting" | "account" | "error";

export interface Persistence {
  mode: PersistenceMode;
  accountId: string | null;
  userEmail: string | null;
  /** accounts.name — '' until the plan is agreed (then the scan's business name / website host / goal text). */
  accountName: string;
  /** "Agree the plan" names the account server-side; the response hands the name back here. */
  setAccountName: (name: string) => void;
  autosave: AutosaveStatus;
  error: string | null;
}

/** The state a real account is created from / hydrated over: no goal, baseline, budget, hours or seeded chat
    (docs/PRODUCT-EXPERIENCE.md "Real only"); currency from where the founder is. */
export function accountSeed(): PlatformState {
  const cookie = typeof document !== "undefined" ? cookieValue(document.cookie, COUNTRY_COOKIE) : null;
  const language = typeof navigator !== "undefined" ? navigator.language : null;
  return accountInitialState(currencyForLocale({ country: cookie, language }));
}

export function useAccountPersistence(S: PlatformState, set: Setter): Persistence {
  const configured = isDbConfigured();
  const [mode, setMode] = useState<PersistenceMode>(configured ? "connecting" : "demo");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        const res = await ensureAccount(db, accountSeed(), { userId: data.user.id });
        if (cancelled) return;
        setUserId(data.user.id);
        setUserEmail(data.user.email ?? null);
        setAccountId(res.accountId);
        setAccountName(res.name ?? "");
        // created → the empty seed; existing → the rows hydrated over that seed. Either way, never the demo state.
        set(() => res.state);
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

  return { mode, accountId, userEmail, accountName, setAccountName, autosave: autosave.status, error: error ?? autosave.error };
}
