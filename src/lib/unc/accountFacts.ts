"use client";
/* Account facts — the real state the founder-facing chrome (Sidebar, Strategy, the corner
   buddy) and the Unc chat context render from in ACCOUNTS mode. One shared client-side store:
   every subscriber sees the same rows, fetched once (and again on `refreshAccountFacts()` or
   when the tab comes back into view).

   Mode resolution (docs/PRODUCT-EXPERIENCE.md — "Demo sandbox stays only for … when not signed in"):
     - no Supabase env                     → "demo", synchronously, never touches the network
     - Sidebar publishes the app's own persistence (publishPersistence) when it has an account
     - otherwise a single session membership may resolve the client; ambiguous membership or
       lost auth leaves empty account mode, never demo data in a configured deployment

   Reads run in the browser under RLS with the founder's own session (the same pattern as
   src/lib/db/accountState.ts). Every failure degrades to `facts: null` + `error` — a view then
   shows its honest empty state, never a demo number. Nothing here is imported by the server. */

import { useSyncExternalStore } from "react";
import { connectorHasRealSync } from "../connectors/sync";
import { listMemberships } from "../db/accountState";
import { selectAccountMembership } from "../db/accountSelection";
import { asDb, getBrowserSupabase, isDbConfigured } from "../db/client";
import type { PlanPhaseJson } from "../db/mapping";
import type { DbClient } from "../db/types";
import { loadAccountFacts } from "./loadAccountFacts";

export type AccountMode = "unknown" | "demo" | "account";

export type ConnectorStatus = "connected" | "disconnected" | "needs_reconnect" | "connecting" | "error";

export interface ConnectorFact {
  platform: string;
  /** Card name (Shopify, Klaviyo …) when the platform has a card; the slug otherwise. */
  name: string;
  status: ConnectorStatus;
  lastSyncAt: string | null;
  /** ok | empty | error:<code> | null (never read). Null is in-flight — not connected. */
  lastSyncResult: string | null;
  externalRef?: string | null;
}

export interface RoutineStateFact {
  routineId: string;
  name: string;
  enabled: boolean;
}

export interface ApprovalFact {
  id: string;
  routineId: string | null;
  title: string;
  detail: string;
  before: string;
  after: string;
  reasoning: string;
  status: "pending" | "approved" | "held" | "expired";
  expiresAt: string | null;
  decidedAt: string | null;
}

export interface RunFact {
  id: string;
  routineId: string;
  mode: "live" | "dry_run";
  status: string;
  startedAt: string;
}

export interface AccountFacts {
  accountId: string;
  connectors: ConnectorFact[];
  routineStates: RoutineStateFact[];
  plan: { title: string; phases: PlanPhaseJson[]; agreedAt: string | null } | null;
  resources: { budgetMonthly: number | null; hoursWeekly: number | null; skills: string[]; postures: string[] } | null;
  /** Pending, newest first. */
  approvals: ApprovalFact[];
  /** Decided (approved / held / expired), newest first, ≤ 10. */
  decided: ApprovalFact[];
  /** Newest first, ≤ 50. */
  runs: RunFact[];
  receipts: { id: string; kind: string; text: string; createdAt: string }[];
  fetchedAt: string;
}

export interface AccountFactsState {
  mode: AccountMode;
  accountId: string | null;
  facts: AccountFacts | null;
  loading: boolean;
  error: string | null;
}

const DAY_MS = 86_400_000;
const REFRESH_MIN_MS = 30_000;

// ---------- the store ----------

type Listener = () => void;

const initialMode = (): AccountMode => {
  try {
    return isDbConfigured() ? "unknown" : "demo";
  } catch {
    return "demo";
  }
};

let state: AccountFactsState = { mode: initialMode(), accountId: null, facts: null, loading: false, error: null };
const listeners = new Set<Listener>();
let resolving: Promise<void> | null = null;
let fetching: Promise<void> | null = null;
let lastFetchAt = 0;
let published: { mode: string; accountId: string | null } | null = null;
let visibilityHooked = false;
let identityRevision = 0;
let publicationRevision = 0;

function emit(next: Partial<AccountFactsState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function db(): DbClient {
  return asDb(getBrowserSupabase());
}

function setIdentity(mode: AccountMode, accountId: string | null): void {
  if (state.mode === mode && state.accountId === accountId) return;
  identityRevision++;
  fetching = null;
  lastFetchAt = 0;
  emit({ mode, accountId, facts: null, loading: false, error: null });
}

/** App persistence is authoritative, including loss of account access. Only an absent
    publisher permits the single-membership fallback; never guess among multiple clients. */
export function publishPersistence(p: { mode: string; accountId: string | null } | null): void {
  publicationRevision++;
  published = p;
  if (p) {
    setIdentity(p.mode === "demo" ? "demo" : "account", p.mode === "account" ? p.accountId : null);
    void fetchFacts();
  } else {
    setIdentity(initialMode(), null);
    ensureResolved();
  }
}

async function resolveMode(): Promise<void> {
  if (state.mode === "demo") return;
  if (published) {
    setIdentity(published.mode === "demo" ? "demo" : "account", published.mode === "account" ? published.accountId : null);
    return;
  }
  const revision = publicationRevision;
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (revision !== publicationRevision) return;
    if (!data.session) {
      setIdentity("account", null);
      return;
    }
    // Signed in ⇒ accounts mode even before the membership row exists (a brand-new account is
    // being created by the app); the id fills in when it can.
    let accountId: string | null = null;
    try {
      const memberships = await listMemberships(db(), data.session.user.id);
      const selection = selectAccountMembership(memberships);
      accountId = selection.ok ? selection.membership.accountId : null;
    } catch {
      accountId = null;
    }
    if (revision === publicationRevision) setIdentity("account", accountId);
  } catch {
    if (revision === publicationRevision) setIdentity("account", null);
  }
}

function ensureResolved(): void {
  if (state.mode !== "unknown" || resolving) return;
  resolving = resolveMode().finally(() => {
    resolving = null;
    if (state.mode === "unknown") ensureResolved();
    if (state.mode === "account" && state.accountId) void fetchFacts();
  });
}

async function readFacts(accountId: string): Promise<AccountFacts> {
  return loadAccountFacts(db(), accountId);
}

async function fetchFacts(force = false): Promise<void> {
  if (state.mode !== "account" || !state.accountId) return;
  if (fetching) return fetching;
  if (!force && Date.now() - lastFetchAt < REFRESH_MIN_MS) return;
  const accountId = state.accountId;
  const revision = identityRevision;
  emit({ loading: true });
  fetching = (async () => {
    try {
      const facts = await readFacts(accountId);
      if (revision !== identityRevision) return;
      lastFetchAt = Date.now();
      emit({ facts, loading: false, error: null });
    } catch (e) {
      if (revision !== identityRevision) return;
      emit({ loading: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (revision === identityRevision) fetching = null;
    }
  })();
  return fetching;
}

/** Re-read the account (after a connect, a routine toggle, a decision). Throttled to one read per 30 s unless `force`. */
export function refreshAccountFacts(force = false): void {
  void fetchFacts(force);
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  ensureResolved();
  if (state.mode === "account" && state.accountId && !state.facts) void fetchFacts();
  if (!visibilityHooked && typeof document !== "undefined") {
    visibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void fetchFacts();
    });
  }
  return () => {
    listeners.delete(l);
  };
}

/* One snapshot for server render and hydration alike: the store only moves after `subscribe`
   (post-hydration) or an explicit publish, so both sides see the same initial value. */
const getSnapshot = () => state;
const getServerSnapshot = () => state;

/** "demo" | "account" | "unknown" (still resolving). */
export function useAccountMode(): AccountMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).mode;
}

export function useAccountFacts(): AccountFactsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Tests only: pin the store to a state (no network). */
export function __setAccountFactsForTests(next: AccountFactsState | null): void {
  identityRevision++;
  publicationRevision++;
  fetching = null;
  lastFetchAt = 0;
  published = null;
  state = next ?? { mode: initialMode(), accountId: null, facts: null, loading: false, error: null };
  for (const l of listeners) l();
}

// ---------- derived, pure (exported for the views and their tests) ----------

/** "2 connected · Klaviyo needs attention" / "1 connected" / "Nothing connected yet". */
export function connectorSummary(facts: Pick<AccountFacts, "connectors"> | null): string {
  if (!facts) return "Nothing connected yet";
  const ok = facts.connectors.filter((c) => connectorHasRealSync(c.status, c.lastSyncResult));
  const attention = facts.connectors.filter((c) => c.status === "needs_reconnect" || c.status === "error");
  if (!ok.length && !attention.length) return "Nothing connected yet";
  const parts: string[] = [];
  if (ok.length) parts.push(`${ok.length} connected`);
  if (attention.length === 1) parts.push(`${attention[0].name} needs attention`);
  else if (attention.length > 1) parts.push(`${attention.length} need attention`);
  return parts.join(" · ");
}

export function enabledRoutines(facts: Pick<AccountFacts, "routineStates"> | null): RoutineStateFact[] {
  return facts ? facts.routineStates.filter((r) => r.enabled) : [];
}

export const enabledCount = (facts: Pick<AccountFacts, "routineStates"> | null): number => enabledRoutines(facts).length;

/** Dry-run receipts that landed in the last `days` days — "drafts waiting". */
export function draftsThisWeek(facts: Pick<AccountFacts, "runs"> | null, now: Date = new Date(), days = 7): number {
  if (!facts) return 0;
  const since = now.getTime() - days * DAY_MS;
  return facts.runs.filter((r) => r.mode === "dry_run" && r.status === "done" && new Date(r.startedAt).getTime() >= since).length;
}

export const pendingCount = (facts: Pick<AccountFacts, "approvals"> | null): number => (facts ? facts.approvals.length : 0);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The corner buddy's line for the Home view in accounts mode — real counts, or the honest first step. */
export function homeBubble(facts: AccountFacts | null, now: Date = new Date()): string {
  const on = enabledCount(facts);
  if (!on) return "No routines are enabled. Choose a ready routine when your setup is verified.";
  const parts = [`${plural(on, "routine")} on`];
  const pending = pendingCount(facts);
  const drafts = draftsThisWeek(facts, now);
  if (pending) parts.push(`${plural(pending, "decision")} waiting`);
  if (drafts) parts.push(`${plural(drafts, "draft")} this week`);
  if (!pending && !drafts) parts.push("nothing waiting on you");
  return `${parts.join(" · ")}.`;
}

/** Drop a demo-seeded prefix from a thread (an account created from the client's demo state
    saved the prototype's opening lines as real rows). Only an exact leading run is removed. */
export function stripDemoSeed<T extends { text: string }>(msgs: T[], seedTexts: string[]): T[] {
  if (!seedTexts.length || msgs.length < seedTexts.length) return msgs;
  for (let i = 0; i < seedTexts.length; i++) if (msgs[i].text !== seedTexts[i]) return msgs;
  return msgs.slice(seedTexts.length);
}
