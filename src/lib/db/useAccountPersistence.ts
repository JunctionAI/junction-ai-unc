"use client";
/* Wires the platform state to the signed-in account when — and only when — Supabase is
   configured AND a verified session exists. Only a build without Supabase stays in demo mode;
   a configured build with no valid session fails closed on the account-recovery surface.

   Sequence on mount (configured):
     1. getUser()            no verified user → blocking account recovery
     2. GET account/state    invited account → hydrate one atomic row snapshot (over the empty account seed,
                             so a partially populated account keeps honest blanks, never demo numbers)
                             no invite/membership → fail closed; private beta never self-provisions
     3. versioned autosave   every owner change persists atomically through PUT, debounced 800 ms;
                             members stay on the hydrated account in explicit read-only mode */

import { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRY_COOKIE, cookieValue } from "@/lib/locale/resolve";
import { accountInitialState, currencyForLocale, type PlatformState, type Setter } from "@/lib/platform/state";
import type { MembershipRole } from "./accountState";
import { getBrowserSupabase, isDbConfigured } from "./client";
import { createAccountStateSaver } from "./stateSave";
import { persistedProjection } from "./mapping";
import { useAutosave, type AutosaveStatus } from "./useAutosave";

export type PersistenceMode = "demo" | "connecting" | "account" | "error";

export interface Persistence {
  mode: PersistenceMode;
  accountId: string | null;
  /** Server-derived account membership. Members hydrate real rows but never use browser writes. */
  role: MembershipRole | null;
  userEmail: string | null;
  /** accounts.name — '' until the plan is agreed (then the scan's business name / website host / goal text). */
  accountName: string;
  /** "Agree the plan" names the account server-side; the response hands the name back here. */
  setAccountName: (name: string) => void;
  autosave: AutosaveStatus;
  error: string | null;
  /** Re-runs account hydration, or retries the current account save after an autosave error. */
  retry: () => void;
}

/** The state a real account is created from / hydrated over: no goal, baseline, budget, hours or seeded chat
    (docs/PRODUCT-EXPERIENCE.md "Real only"); currency from where the founder is. */
export function accountSeed(): PlatformState {
  const cookie = typeof document !== "undefined" ? cookieValue(document.cookie, COUNTRY_COOKIE) : null;
  const language = typeof navigator !== "undefined" ? navigator.language : null;
  return accountInitialState(currencyForLocale({ country: cookie, language }));
}

/** In a configured deployment, absence of a verified user is never permission to show demo
    fixtures. The no-database build is the only demo path; session expiry/races fail closed. */
export function accountAuthProblem(user: { id: string } | null | undefined, error: { message?: string } | null): string | null {
  if (error) return `Couldn't verify your signed-in account: ${error.message || "authentication failed"}`;
  if (!user) return "Your sign-in session is no longer available. Try again or sign out, then sign in again.";
  return null;
}

/** Pure policy seam used by the hook and tests: only a hydrated owner account may autosave. */
export function accountAutosaveEnabled(mode: PersistenceMode, accountId: string | null, role: MembershipRole | null): boolean {
  return mode === "account" && !!accountId && role === "owner";
}

export function useAccountPersistence(S: PlatformState, set: Setter): Persistence {
  const configured = isDbConfigured();
  const [mode, setMode] = useState<PersistenceMode>(configured ? "connecting" : "demo");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [role, setRole] = useState<MembershipRole | null>(null);
  const saver = useRef<ReturnType<typeof createAccountStateSaver> | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data, error: authErr } = await supabase.auth.getUser();
        const authProblem = accountAuthProblem(data.user, authErr);
        if (authProblem) throw new Error(authProblem);
        if (!data.user) return; // narrowed by accountAuthProblem; defensive for future client types
        if (!cancelled) {
          setUserEmail(data.user.email ?? null);
        }
        const response = await fetch("/api/account/state", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("Couldn't load your account. Try again or sign in again.");
        const res = await response.json() as { accountId: string; role: MembershipRole; name: string; state: PlatformState; revision: number };
        if (!res.accountId || (res.role !== "owner" && res.role !== "member") || !res.state || !Number.isSafeInteger(res.revision))
          throw new Error("The account could not be verified. Please try again.");
        if (cancelled) return;
        saver.current = createAccountStateSaver(res.accountId, res.revision, { initialState: res.state });
        setAccountId(res.accountId);
        setRole(res.role);
        setAccountName(res.name ?? "");
        // The server's snapshot hydrates over an empty account seed, never demo state.
        set(() => res.state);
        setMode("account");
      } catch (e) {
        if (cancelled) return;
        setAccountId(null);
        setRole(null);
        setError(e instanceof Error ? e.message : String(e));
        setMode("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, configured, set]);

  const enabled = accountAutosaveEnabled(mode, accountId, role);
  const autosave = useAutosave(
    S,
    enabled,
    async (state) => {
      if (!accountId) return;
      if (!saver.current) throw new Error("Load the account before saving.");
      await saver.current.save(state);
    },
    persistedProjection,
  );

  const retry = useCallback(() => {
    if (enabled && autosave.error) {
      void autosave.flush();
      return;
    }
    setError(null);
    setAccountId(null);
    setRole(null);
    setMode(configured ? "connecting" : "demo");
    if (configured) setAttempt((n) => n + 1);
  }, [autosave, configured, enabled]);

  // A stale owner save error must not block a user who subsequently hydrates as a read-only
  // member. Member mode never reports a save status for work it is forbidden to persist.
  const autosaveError = role === "owner" ? autosave.error : null;
  const autosaveStatus: AutosaveStatus = role === "member" ? "idle" : autosave.status;
  return { mode, accountId, role, userEmail, accountName, setAccountName, autosave: autosaveStatus, error: error ?? autosaveError, retry };
}
