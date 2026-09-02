"use client";
/* Account facts — the real state the founder-facing chrome (Sidebar, Strategy, the corner
   buddy) and the Unc chat context render from in ACCOUNTS mode. One shared client-side store:
   every subscriber sees the same rows, fetched once (and again on `refreshAccountFacts()` or
   when the tab comes back into view).

   Mode resolution (docs/PRODUCT-EXPERIENCE.md — "Demo sandbox stays only for … when not signed in"):
     - no Supabase env                     → "demo", synchronously, never touches the network
     - Sidebar publishes the app's own persistence (publishPersistence) when it has an account
     - otherwise the session decides: a signed-in user is "account" (the proxy already keeps
       /app behind /login), no session is "demo"

   Reads run in the browser under RLS with the founder's own session (the same pattern as
   src/lib/db/accountState.ts). Every failure degrades to `facts: null` + `error` — a view then
   shows its honest empty state, never a demo number. Nothing here is imported by the server. */

import { useSyncExternalStore } from "react";
import { listMemberships } from "@/lib/db/accountState";
import { asDb, getBrowserSupabase, isDbConfigured } from "@/lib/db/client";
import type { PlanPhaseJson } from "@/lib/db/mapping";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import { unwrap, type DbClient } from "@/lib/db/types";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";

export type AccountMode = "unknown" | "demo" | "account";

export type ConnectorStatus = "connected" | "disconnected" | "needs_reconnect" | "connecting" | "error";

export interface ConnectorFact {
  platform: string;
  /** Card name (Shopify, Klaviyo …) when the platform has a card; the slug otherwise. */
  name: string;
  status: ConnectorStatus;
  lastSyncAt: string | null;
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
  resources: { budgetMonthly: number; hoursWeekly: number; skills: string[]; postures: string[] } | null;
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

const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));
const NAME_BY_ROUTINE: Record<string, string> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, s.name]));

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

function emit(next: Partial<AccountFactsState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function db(): DbClient {
  return asDb(getBrowserSupabase());
}

/** Sidebar hands in the app's own persistence (authoritative when it has an account). Passing
    null or a non-account persistence leaves the session fallback in charge. */
export function publishPersistence(p: { mode: string; accountId: string | null } | null): void {
  published = p;
  if (p && p.mode === "account" && p.accountId) {
    if (state.mode !== "account" || state.accountId !== p.accountId) emit({ mode: "account", accountId: p.accountId });
    void fetchFacts();
  }
}

async function resolveMode(): Promise<void> {
  if (state.mode === "demo") return;
  if (published && published.mode === "account" && published.accountId) {
    emit({ mode: "account", accountId: published.accountId });
    return;
  }
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      emit({ mode: "demo", accountId: null });
      return;
    }
    // Signed in ⇒ accounts mode even before the membership row exists (a brand-new account is
    // being created by the app); the id fills in when it can.
    let accountId: string | null = null;
    try {
      const memberships = await listMemberships(db());
      accountId = memberships[0]?.accountId ?? null;
    } catch {
      accountId = null;
    }
    emit({ mode: "account", accountId });
  } catch {
    emit({ mode: "demo", accountId: null });
  }
}

function ensureResolved(): void {
  if (state.mode !== "unknown" || resolving) return;
  resolving = resolveMode().finally(() => {
    resolving = null;
    if (state.mode === "account" && state.accountId) void fetchFacts();
  });
}

async function readFacts(accountId: string): Promise<AccountFacts> {
  const client = db();
  const by = (table: string, columns: string) => client.from(table).select(columns).eq("account_id", accountId);
  type ConnRow = { platform: string; status: ConnectorStatus; last_sync_at: string | null };
  type RsRow = { routine_id: string; enabled: boolean };
  type PlanRow = { title: string; phases: PlanPhaseJson[]; agreed_at: string | null } | null;
  type RpRow = { budget_monthly: number | string; hours_weekly: number | string; skills: string[] | null; postures: string[] | null } | null;
  type ApRow = { id: string; routine_id: string | null; title: string; detail: string | null; before_state: string | null; after_state: string | null; reasoning: string | null; status: ApprovalFact["status"]; expires_at: string | null; decided_at: string | null };
  type RunRow = { id: string; routine_id: string; mode: "live" | "dry_run"; status: string; started_at: string };
  type RcRow = { id: string; kind: string; description: string; created_at: string };
  const [conns, rs, plan, rp, aps, runs, rcs] = await Promise.all([
    unwrap<ConnRow[]>("connectors.select", by("connectors", "platform, status, last_sync_at")),
    unwrap<RsRow[]>("routine_states.select", by("routine_states", "routine_id, enabled")),
    unwrap<PlanRow>("plans.select", by("plans", "title, phases, agreed_at").order("created_at", { ascending: false }).limit(1).maybeSingle()),
    unwrap<RpRow>("resource_profiles.select", by("resource_profiles", "budget_monthly, hours_weekly, skills, postures").maybeSingle()),
    unwrap<ApRow[]>("approvals.select", by("approvals", "id, routine_id, title, detail, before_state, after_state, reasoning, status, expires_at, decided_at").order("created_at", { ascending: false }).limit(40)),
    unwrap<RunRow[]>("routine_runs.select", by("routine_runs", "id, routine_id, mode, status, started_at").order("started_at", { ascending: false }).limit(50)),
    unwrap<RcRow[]>("receipts.select", by("receipts", "id, kind, description, created_at").order("created_at", { ascending: false }).limit(10)),
  ]);
  const approvals = (aps ?? []).map<ApprovalFact>((a) => ({
    id: a.id,
    routineId: a.routine_id,
    title: a.title,
    detail: a.detail ?? "",
    before: a.before_state ?? "",
    after: a.after_state ?? "",
    reasoning: a.reasoning ?? "",
    status: a.status,
    expiresAt: a.expires_at,
    decidedAt: a.decided_at,
  }));
  return {
    accountId,
    connectors: (conns ?? []).map((c) => ({ platform: c.platform, name: NAME_BY_PLATFORM[c.platform] ?? c.platform, status: c.status, lastSyncAt: c.last_sync_at })),
    routineStates: (rs ?? []).map((r) => ({ routineId: r.routine_id, name: NAME_BY_ROUTINE[r.routine_id] ?? r.routine_id, enabled: !!r.enabled })),
    plan: plan ? { title: plan.title, phases: Array.isArray(plan.phases) ? plan.phases : [], agreedAt: plan.agreed_at } : null,
    resources: rp ? { budgetMonthly: Number(rp.budget_monthly), hoursWeekly: Number(rp.hours_weekly), skills: rp.skills ?? [], postures: rp.postures ?? [] } : null,
    approvals: approvals.filter((a) => a.status === "pending"),
    decided: approvals.filter((a) => a.status !== "pending").slice(0, 10),
    runs: (runs ?? []).map((r) => ({ id: r.id, routineId: r.routine_id, mode: r.mode, status: r.status, startedAt: r.started_at })),
    receipts: (rcs ?? []).map((r) => ({ id: r.id, kind: r.kind, text: r.description, createdAt: r.created_at })),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFacts(force = false): Promise<void> {
  if (state.mode !== "account" || !state.accountId) return;
  if (fetching) return fetching;
  if (!force && Date.now() - lastFetchAt < REFRESH_MIN_MS) return;
  const accountId = state.accountId;
  emit({ loading: true });
  fetching = (async () => {
    try {
      const facts = await readFacts(accountId);
      lastFetchAt = Date.now();
      emit({ facts, loading: false, error: null });
    } catch (e) {
      emit({ loading: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      fetching = null;
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
  state = next ?? { mode: initialMode(), accountId: null, facts: null, loading: false, error: null };
  for (const l of listeners) l();
}

// ---------- derived, pure (exported for the views and their tests) ----------

/** "2 connected · Klaviyo needs attention" / "1 connected" / "Nothing connected yet". */
export function connectorSummary(facts: Pick<AccountFacts, "connectors"> | null): string {
  if (!facts) return "Nothing connected yet";
  const ok = facts.connectors.filter((c) => c.status === "connected");
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
  if (!on) return "Nothing running yet — turn on your first routine and I’ll have a draft here within the hour.";
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
