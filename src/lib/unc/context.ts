/* Serializes the client-side platform state into the compact JSON context Unc
   reasons over. Everything here is data the UI already shows the founder —
   functions and styling are stripped, lists are capped. This is the ONLY
   source of numbers Unc is allowed to use in replies.

   Two modes (docs/PRODUCT-EXPERIENCE.md — "Real only"):
     demo     the prototype's dataset verbatim: demo approvals, signals, levers, receipts, the
              catalog's default connector / routine states.
     account  nothing from derive.ts' demo constants. Approvals, receipts, connector and routine
              states come from the account's rows (src/lib/unc/accountFacts.ts) and from the
              hydrated state; signals and levers are empty until a certified read exists; the
              strategy rationale is built from the founder's own budget / hours / strengths, with
              no invented date or evidence gate. */

import { connectorHasRealSync } from "@/lib/connectors/sync";
import { ALL_SYSTEMS, CATEGORIES, CONNECTOR_DEFS } from "@/lib/platform/catalog";
import { AP_DATA, AP_WHY_TEXTS, COMPLETED_DEFS, LEVER_DEFS, SIGNAL_DEFS, postureDefs } from "@/lib/platform/derive";
import { DEMO_TODAY, goalMath } from "@/lib/platform/goal";
import { scoreChannels, span, weekSplit } from "@/lib/platform/plan";
import type { PlatformState } from "@/lib/platform/state";
import type { AccountFacts, ApprovalFact } from "./accountFacts";

const LIST_CAP = 10;

export interface ContextOptions {
  /** "account" ⇒ no demo furniture. Defaults to demo (the prototype's behaviour). */
  mode?: "demo" | "account";
  /** The account's rows (accounts mode). null/undefined ⇒ the hydrated state alone. */
  facts?: AccountFacts | null;
  now?: Date;
}

const expiryLabel = (iso: string | null, now: Date): string => {
  if (!iso) return "no expiry";
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "no expiry";
  if (ms <= 0) return "expired";
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `expires in ${Math.max(1, h)}h` : `expires in ${Math.round(h / 24)}d`;
};

const approvalFromFact = (a: ApprovalFact, now: Date) => ({
  routine: a.routineId ?? "",
  title: a.title,
  detail: a.detail,
  before: a.before,
  after: a.after,
  expiry: a.status === "pending" ? expiryLabel(a.expiresAt, now) : a.decidedAt ? `decided ${a.decidedAt.slice(0, 10)}` : "decided",
  status: a.status,
  reasoning: a.reasoning,
});

/** The accounts-mode "why this play" line — the founder's own numbers, no invented date. */
export function accountStrategyWhy(S: { posture: PlatformState["posture"]; budgetMonthly: number; hoursWk: number; obStrengths: string[]; currency: string }, agreedAt: string | null): string {
  const pd = postureDefs[S.posture];
  const sym = S.currency === "NZD" ? "NZ$" : S.currency === "USD" ? "US$" : S.currency === "AUD" ? "A$" : S.currency === "GBP" ? "£" : "€";
  const skills = S.obStrengths.length ? `strengths: ${S.obStrengths.join(", ").toLowerCase()}` : "no strengths picked yet";
  const agreed = agreedAt ? `Agreed with the founder on ${agreedAt.slice(0, 10)}.` : "Not agreed yet — a draft until the founder agrees it.";
  return `${pd.label}: ${pd.thesis} Shaped by ${sym}${S.budgetMonthly.toLocaleString("en-NZ")}/mo for paid, ${S.hoursWk} h/wk of the founder's time, and ${skills}. ${agreed}`;
}

export function buildUncContext(S: PlatformState, opts: ContextOptions = {}) {
  const account = opts.mode === "account";
  const facts = account ? (opts.facts ?? null) : null;
  const now = opts.now ?? new Date();
  const gm = goalMath({ goalTitle: S.goalTitle, baselineNum: S.baselineNum, deadline: S.deadline, currency: S.currency });
  const baselineSet = S.baselineNum !== null;

  const demoApprovals = AP_DATA.slice(0, LIST_CAP).map((a, i) => ({
    routine: a.sys,
    title: a.title,
    detail: a.detail,
    before: a.before,
    after: a.after,
    expiry: a.expiry,
    status: S.apStatus[i] ?? "pending",
    reasoning: AP_WHY_TEXTS[i],
  }));
  const approvalsPending = account ? (facts?.approvals ?? []).slice(0, LIST_CAP).map((a) => approvalFromFact(a, now)) : demoApprovals.filter((a) => a.status === "pending");
  const approvalsRecent = account ? (facts?.decided ?? []).slice(0, LIST_CAP).map((a) => approvalFromFact(a, now)) : demoApprovals.filter((a) => a.status !== "pending").slice(0, LIST_CAP);

  const pd = postureDefs[S.posture];
  const agreedAt = account ? (facts?.plan?.agreedAt ?? null) : null;
  const factEnabled = facts ? new Set(facts.routineStates.filter((r) => r.enabled).map((r) => r.name)) : null;
  // demo: the catalog's default "Active" flags stand in; account: only what is actually enabled
  const isOn = (n: string) => (account ? (factEnabled ? factEnabled.has(n) || S.routineOn[n] === true : S.routineOn[n] === true) : (S.routineOn[n] ?? ALL_SYSTEMS.find((x) => x.name === n)?.state === "Active"));
  const phaseDefs = account && facts?.plan?.phases?.length ? facts.plan.phases.map((p, i) => ({ n: p.n ?? String(i + 1), name: p.name, routines: p.routines ?? [], you: p.from_you ?? "" })) : pd.phases.map((ph, pi) => ({ n: ph.n, name: ph.name, routines: S.routineEdits[`${S.posture}.${pi}`] ?? ph.routines, you: ph.you, st: ph.st }));
  const phases = phaseDefs.map((ph, i) => {
    const onHere = ph.routines.filter(isOn).length;
    const status = account ? (onHere ? "active" : i === 0 ? "start here" : "ready when you are") : ((ph as { st?: string }).st ?? "");
    return { phase: ph.n, name: ph.name, status, routines: ph.routines, founderPart: ph.you };
  });

  const routinesOn = ALL_SYSTEMS.filter((s) => isOn(s.name)).map((s) => s.name);

  const connectors = account
    ? (() => {
        const byName = new Map((facts?.connectors ?? []).map((c) => [c.name, c]));
        const fromState: Record<string, string> = { ok: "connected", off: "disconnected", expired: "needs_reconnect" };
        return CONNECTOR_DEFS.map((d) => {
          const row = byName.get(d.name);
          const raw = row?.status ?? (S.connState[d.name] ? fromState[S.connState[d.name]] : "disconnected");
          const status = connectorHasRealSync(raw, row?.lastSyncResult) ? "connected" : raw === "connected" ? "connecting" : raw;
          return { name: d.name, status, reads: d.note };
        });
      })()
    : CONNECTOR_DEFS.map((d) => ({ name: d.name, status: S.connState[d.name] || d.st, reads: d.note }));

  const chans = scoreChannels(S.posture, S.obStrengths || [], S.budgetMo);
  const { weeksLeft, w1, w2end } = weekSplit(S.deadline);

  return {
    today: account ? now.toISOString().slice(0, 10) : DEMO_TODAY.slice(0, 10),
    goal: {
      title: S.goalTitle,
      currency: S.currency,
      target: gm.target,
      // baseline NULL in the account → these are unknown, not the demo 28,400 (Unc must ask, not invent)
      baseline: baselineSet ? gm.baseline : null,
      current: baselineSet ? gm.cur : null,
      deadline: S.deadline,
      daysLeft: gm.daysLeftN,
      pacePerDay: baselineSet ? Math.round(gm.pace) : null,
      neededPerDay: baselineSet ? Math.round(gm.needed) : null,
      projectedAtDeadline: baselineSet ? gm.proj : null,
      gapAtDeadline: baselineSet ? Math.round(gm.gap) : null,
      onTrack: baselineSet ? gm.onTrack : null,
      progress: baselineSet ? gm.goalPct : null,
      otherGoals: S.obCats.slice(1).map((k) => S.goalTexts[k]).filter(Boolean),
    },
    founder: {
      profile: { budget: S.profile.budget, time: S.profile.time, strength: S.profile.strength, belief: S.profile.belief },
      strengths: S.obStrengths,
      platforms: S.obPlatforms,
      hoursPerWeek: S.hoursWk,
      adBudgetPerMonth: S.budgetMo,
      adBudgetPerDay: Math.round(S.budgetMo / 30),
      marginPct: S.marginPct,
      reinvest: S.reinvest,
      breadth: S.obBreadth,
      pace: S.obPace,
      team: S.team.slice(0, LIST_CAP).map((p) => ({ name: p.name, role: p.role, approvalAreas: p.areas })),
    },
    strategy: {
      posture: S.posture,
      postureLabel: pd.label,
      thesis: pd.thesis,
      why: account ? accountStrategyWhy({ posture: S.posture, budgetMonthly: S.budgetMo, hoursWk: S.hoursWk, obStrengths: S.obStrengths, currency: S.currency }, agreedAt) : pd.why,
      agreedAt,
      phases,
      channelRanking: chans.map((c) => ({ channel: c.k, why: c.why })),
      rolloutWeeks: { total: weeksLeft, phase1: span(1, w1), phase2: span(w1 + 1, w2end), phase3: `${span(w2end + 1, weeksLeft)}+` },
    },
    approvalsPending,
    approvalsRecent,
    routines: {
      active: routinesOn.slice(0, 40),
      activeCount: routinesOn.length,
      libraryTotal: ALL_SYSTEMS.length,
      categories: CATEGORIES.map((c) => ({ name: c.name, on: c.systems.filter(isOn).length, total: c.systems.length })),
    },
    connectors,
    // certified reads only: no demo signals or levers for a real account until a KPI snapshot exists
    signals: account ? [] : SIGNAL_DEFS.map((s) => ({ label: s.label, value: s.value, note: s.delta })),
    levers: account ? [] : LEVER_DEFS.map((l) => ({ name: l.name, impact: l.impact, cost: l.cost, status: l.conf })),
    recentReceipts: account ? (facts?.receipts ?? []).slice(0, LIST_CAP).map((r) => ({ text: r.text, receipt: `Receipt ${r.id.slice(0, 8)} · ${r.kind} · ${r.createdAt.slice(0, 10)}` })) : COMPLETED_DEFS.slice(0, LIST_CAP),
    onboarded: S.onboarded,
  };
}

export type UncContext = ReturnType<typeof buildUncContext>;

/* ---------- Client Brain (server-side only) ----------
   The browser builds the context above from its own state; the chat route then attaches what
   Unc remembers about this founder (src/lib/brain/retrieve.ts recallForContext, keyed on the
   latest founder message), how they like to work (src/lib/brain/profile.ts) and the Junction
   playbook notes relevant to the question (src/lib/brain/playbooks.ts via prompt.ts
   recallPlaybookNotes). All three are rendered by buildUncSystemPrompt as their own sections,
   never as raw JSON. Anything the client sent under these keys is dropped first — the brain is
   server truth. */

export const BRAIN_CONTEXT_KEYS = ["memories", "profile", "playbooks", "certifiedMetrics"] as const;

export interface BrainContext {
  /** "[kind] text" lines from recallForContext — the founder's stated truth, compact. */
  memories: string[];
  /** renderProfileForPrompt output; "" when the profile is empty. */
  profile: string;
  /** The rendered JUNCTION PLAYBOOK NOTES block (prompt.ts recallPlaybookNotes); "" when none apply. */
  playbooks?: string;
  /** renderCertifiedMetrics output (catalog snapshots). Client-sent values are dropped. */
  certifiedMetrics?: string;
}

export type UncContextWithBrain = UncContext & Partial<BrainContext>;

export function attachBrain(context: unknown, brain: BrainContext | null): Record<string, unknown> {
  const base = context && typeof context === "object" && !Array.isArray(context) ? { ...(context as Record<string, unknown>) } : {};
  for (const k of BRAIN_CONTEXT_KEYS) delete base[k];
  if (!brain) return base;
  const out: Record<string, unknown> = { ...base, memories: brain.memories.filter((m) => typeof m === "string" && m.trim()), profile: brain.profile ?? "" };
  if (brain.playbooks && brain.playbooks.trim()) out.playbooks = brain.playbooks;
  if (brain.certifiedMetrics && brain.certifiedMetrics.trim()) out.certifiedMetrics = brain.certifiedMetrics;
  return out;
}

/** Pull the brain sections back out of a context object (the prompt renders them separately). */
export function splitBrain(context: unknown): { context: Record<string, unknown>; brain: BrainContext | null } {
  const base = context && typeof context === "object" && !Array.isArray(context) ? { ...(context as Record<string, unknown>) } : {};
  const memories = Array.isArray(base.memories) ? base.memories.filter((m): m is string => typeof m === "string" && !!m.trim()) : [];
  const profile = typeof base.profile === "string" ? base.profile : "";
  const playbooks = typeof base.playbooks === "string" ? base.playbooks.trim() : "";
  const certifiedMetrics = typeof base.certifiedMetrics === "string" ? base.certifiedMetrics.trim() : "";
  for (const k of BRAIN_CONTEXT_KEYS) delete base[k];
  if (!memories.length && !profile.trim() && !playbooks && !certifiedMetrics) return { context: base, brain: null };
  const brain: BrainContext = { memories, profile };
  if (playbooks) brain.playbooks = playbooks;
  if (certifiedMetrics) brain.certifiedMetrics = certifiedMetrics;
  return { context: base, brain };
}
