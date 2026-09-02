"use client";

import { CATEGORIES } from "@/lib/platform/catalog";
import type { PlatformVals } from "@/lib/platform/derive";
import { planReasoning, reasonOrganization, type ChannelKey, type PhaseReasoning, type PlanReasoning, type Posture, type ReasoningInput } from "@/lib/platform/plan";
import { enabledRoutines, useAccountFacts, type AccountFacts } from "@/lib/unc/accountFacts";

/* Accounts mode (docs/PRODUCT-EXPERIENCE.md): every date, count and pill on this screen comes
   from the account's rows — the agreed `plans` row, `routine_states`, `resource_profiles` —
   never from derive.ts' demo constants ("agreed 12 Aug", "GATED · repeat ≥ 18%"). No evidence
   gate exists in the product yet, so no phase ever shows a gated pill for a real account: a
   phase is ACTIVE (something in it is on), START HERE (phase 1, nothing on yet) or READY WHEN
   YOU ARE. Demo mode renders the prototype verbatim. */

export interface StrategyPhaseView {
  n: string;
  name: string;
  routines: string[];
  you: string;
  /** How many of this phase's routines are on. */
  on: number;
  /** ACTIVE | START HERE | READY WHEN YOU ARE */
  st: string;
  active: boolean;
  go: () => void;
}

const fmtDay = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
};

/** The build-out phases for a real account: the agreed plan's phases (or the current play's
    defaults while none is saved) with on-counts from the account's routine states. */
export function accountPhases(V: Pick<PlatformVals, "phases" | "goSystems">, facts: Pick<AccountFacts, "plan" | "routineStates"> | null): StrategyPhaseView[] {
  const on = new Set(enabledRoutines(facts).map((r) => r.name));
  const defs = facts?.plan?.phases?.length
    ? facts.plan.phases.map((p, i) => ({ n: p.n ?? String(i + 1), name: p.name, routines: p.routines ?? [], you: p.from_you ?? "", go: V.phases[i]?.goRoutines ?? V.goSystems }))
    : V.phases.map((p) => ({ n: p.n, name: p.name, routines: p.routines.map((r) => r.name), you: p.you, go: p.goRoutines }));
  return defs.map((d, i) => {
    const onHere = d.routines.filter((r) => on.has(r)).length;
    const active = onHere > 0;
    return { ...d, on: onHere, active, st: active ? "ACTIVE" : i === 0 ? "START HERE" : "READY WHEN YOU ARE" };
  });
}

/* ---- The judgement under each phase (2026-09-03) — plan.ts §Reasoning rendered collapsed:
   "Why this order · What flips it · The risk", plus one "What I'd push back on" line when the
   founder's posture and the evidence disagree. Inputs are the founder's own (resource_profiles
   in accounts mode, the state's onboarding answers in demo); never a number from anywhere else. */

const CHANNEL_WORDS: [RegExp, ChannelKey][] = [
  [/paid|amplif|creative test|spend/i, "Paid ads"],
  [/email|retention|lifecycle|flow|follow-up|referral/i, "Email & SMS"],
  [/seo|search/i, "SEO"],
  [/pipeline|sales|outbound/i, "Sales"],
  [/content|organic|brand/i, "Content"],
];

/** Which channel a build-out phase belongs to: the majority category of its routines (catalog),
    else a word in its name; null for the organization phase (no catalog routines). */
export function phaseChannel(name: string, routines: string[]): ChannelKey | null {
  const counts = new Map<ChannelKey, number>();
  for (const r of routines) {
    const cat = CATEGORIES.find((c) => c.systems.includes(r));
    if (cat) counts.set(cat.name as ChannelKey, (counts.get(cat.name as ChannelKey) ?? 0) + 1);
  }
  let best: ChannelKey | null = null;
  for (const [k, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = k;
  if (best) return best;
  if (/scale the organi[sz]ation/i.test(name)) return null;
  for (const [re, k] of CHANNEL_WORDS) if (re.test(name)) return k;
  return null;
}

const POSTURE_BY_LABEL: Record<string, Posture> = { "Brand-led organic": "brand", "Sales-led outbound": "sales", "Paid-led scale": "paid" };

/** The scoring inputs for the reasoning: the account's resource profile when it has one, else
    the state's own onboarding answers (demo, or an account still in onboarding). */
export function reasoningInputs(V: Pick<PlatformVals, "realInputs" | "obHoursWk" | "obScan" | "curSym" | "postureName">, facts: Pick<AccountFacts, "resources"> | null): ReasoningInput {
  const res = facts?.resources ?? null;
  const posture = (res?.postures?.[0] && POSTURE_BY_LABEL[res.postures[0]]) || (res?.postures?.[0] as Posture | undefined) || V.realInputs.posture;
  const profile = V.obScan?.status === "done" ? V.obScan.profile : null;
  return {
    posture: posture === "brand" || posture === "sales" || posture === "paid" ? posture : V.realInputs.posture,
    strengths: res ? res.skills : V.realInputs.obStrengths,
    budgetMo: res ? res.budgetMonthly : V.realInputs.budgetMo,
    hoursWk: res ? res.hoursWeekly : typeof V.obHoursWk === "number" && Number.isFinite(V.obHoursWk) ? V.obHoursWk : null,
    businessType: profile?.businessType ?? null,
    currencySymbol: V.curSym,
  };
}

/** The reasoning for one build-out phase: by its channel, at its position; the organization phase has its own. */
export function phaseReasoning(reasoning: PlanReasoning, name: string, routines: string[]): PhaseReasoning {
  const k = phaseChannel(name, routines);
  return k ? reasoning.byChannel[k] : reasonOrganization();
}

function PhaseWhy({ r, testId }: { r: PhaseReasoning; testId: string }) {
  const row = (label: string, text: string) => (
    <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
      <span style={{ flex: "none", width: 92, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, color: "oklch(0.4 0.04 262)", paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
  return (
    <details data-testid={testId} style={{ marginTop: 12, borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--cyan-link)", listStyle: "none" }}>Why this order · What flips it · The risk</summary>
      {row("Why this order", r.whyThisOrder)}
      {row("What flips it", r.evidenceGate)}
      {row("The risk", r.risk)}
      {row("Weekly, from me", r.whatIDoWeekly)}
    </details>
  );
}

/** "Why this is yours" for a real account — the founder's own budget, hours and strengths, and
    whether the plan is agreed. No invented dates, no invented gates. */
export function accountWhy(V: Pick<PlatformVals, "postureName" | "obBudgetLabel" | "obHoursLabel" | "obStrengthSummary">, agreedAt: string | null, strengths: string[]): string {
  const when = fmtDay(agreedAt);
  const skills = strengths.length ? `your strengths: ${strengths.slice(0, 4).join(", ").toLowerCase()}` : "your strengths (none picked yet — add them any time)";
  const agreed = when ? `We agreed it on ${when}.` : "It stays a draft until you agree it from Home.";
  return `${V.postureName} is the play. It’s shaped by ${V.obBudgetLabel} for paid, ${V.obHoursLabel} of your time, and ${skills}. ${agreed} Change any of those and I reshape the plan — the routines follow it.`;
}

export default function StrategyView({ V }: { V: PlatformVals }) {
  const { mode, facts, loading } = useAccountFacts();
  const acct = mode === "account";
  const agreedAt = acct ? (facts?.plan?.agreedAt ?? null) : null;
  const agreedDay = fmtDay(agreedAt);
  const phasesAcct = acct ? accountPhases(V, facts) : null;
  const strengths = acct ? (facts?.resources?.skills ?? []) : [];
  const onTotal = phasesAcct ? phasesAcct.reduce((n, p) => n + p.on, 0) : 0;
  const headerLine = !acct
    ? "agreed 12 Aug · reviewed monthly · persists until superseded"
    : loading && !facts
      ? "reading your plan…"
      : agreedDay
        ? `agreed ${agreedDay} · persists until superseded`
        : "draft — not agreed yet";
  const buddy = !acct
    ? "We agree the strategy once — then the routines carry it. Your job becomes clearing agreed work, not remembering it."
    : onTotal
      ? `${onTotal} routine${onTotal === 1 ? "" : "s"} on under this play. Change the play here and the routines follow — nothing sends without you.`
      : "Nothing is on yet. Agree the play, turn on the first routine, and I carry it from there.";
  const why = acct ? accountWhy(V, agreedAt, strengths.length ? strengths : V.obStrengthSummary.split(" · ").filter(Boolean)) : V.postureWhy;
  const reasoning = planReasoning(reasoningInputs(V, acct ? facts : null));
  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}>
      <div data-buddy={buddy} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Strategy</h1>
        <div data-testid="strategy-header-line" style={{ fontSize: 12.5, color: "var(--muted)" }}>{headerLine}</div>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, maxWidth: 600, lineHeight: 1.55 }}>
        The macro play, shaped around how you add the most value. Junction holds it, derives every routine from it, and comes to you with agreed work — never a daily scramble.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 26 }}>
        {V.postures.map((po) => (
          <button
            key={po.label}
            onClick={po.pick}
            className="hov-border-cyan"
            style={{ textAlign: "left", background: "white", border: `1.5px solid ${po.border}`, borderRadius: 14, padding: "18px 19px", cursor: "pointer", boxShadow: po.shadow }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--cyan-link)", fontWeight: 700 }}>{po.tag}</span>
              {po.selected && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" }}>YOURS</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, color: "var(--ink)" }}>{po.label}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5, lineHeight: 1.5 }}>{po.thesis}</div>
            <div style={{ fontSize: 11.5, color: "var(--cyan-text)", marginTop: 8, fontWeight: 500 }}>{acct ? po.match : po.fit}</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14, background: "var(--navy)", color: "var(--on-navy)", borderRadius: 16, padding: "22px 26px", display: "flex", gap: 20, alignItems: "flex-start" }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 56, height: 60, objectFit: "contain", flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-navy-dim)", fontWeight: 600 }}>Why this is yours</div>
          <div data-testid="strategy-why" style={{ fontSize: 14.5, lineHeight: 1.6, marginTop: 9, color: "oklch(0.93 0.012 250)" }}>{why}</div>
          <div style={{ fontSize: 12, color: "var(--faint-on-navy)", marginTop: 12 }}>Shaped by your budget, hours and strengths from onboarding — tell me when they change.</div>
        </div>
      </div>
      {reasoning.pushback && (
        <div data-testid="strategy-pushback" style={{ marginTop: 12, background: "var(--cyan-wash)", border: "1px solid oklch(0.85 0.06 225)", borderRadius: 12, padding: "14px 18px", display: "flex", gap: 12, alignItems: "baseline" }}>
          <span style={{ flex: "none", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: "var(--cyan-text)" }}>What I’d push back on</span>
          <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>{reasoning.pushback}</span>
        </div>
      )}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>The build-out</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{acct ? "— one phase at a time, on your say-so" : "— unlocks on evidence, not optimism"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {phasesAcct
            ? phasesAcct.map((ph) => (
                <div key={ph.n} data-testid="strategy-phase" style={{ background: "white", border: `1px solid ${ph.active ? "oklch(0.78 0.13 220 / 0.6)" : "oklch(0.91 0.01 260)"}`, borderRadius: 14, padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: ph.active ? "oklch(0.27 0.055 262)" : "oklch(0.93 0.008 260)", color: ph.active ? "oklch(0.78 0.13 220)" : "oklch(0.55 0.03 260)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      {ph.n}
                    </span>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{ph.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: ph.active ? "oklch(0.45 0.1 240)" : "oklch(0.52 0.03 260)", background: ph.active ? "oklch(0.94 0.03 225)" : "oklch(0.945 0.008 260)", borderRadius: 5, padding: "3px 8px" }}>{ph.st}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cyan-link)", fontWeight: 500, marginTop: 11 }}>
                    {ph.on} of {ph.routines.length} routines on ·{" "}
                    <button
                      onClick={ph.go}
                      style={{ border: "none", background: "transparent", padding: 0, color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                    >
                      manage
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 11, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: "oklch(0.4 0.04 262)" }}>From you:</span> {ph.you}
                  </div>
                  <PhaseWhy r={phaseReasoning(reasoning, ph.name, ph.routines)} testId="strategy-phase-why" />
                </div>
              ))
            : V.phases.map((ph) => (
                <div key={ph.n} style={{ background: "white", border: `1px solid ${ph.border}`, borderRadius: 14, padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: ph.nBg, color: ph.nFg, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      {ph.n}
                    </span>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{ph.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: ph.stColor, background: ph.stBg, borderRadius: 5, padding: "3px 8px" }}>{ph.st}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cyan-link)", fontWeight: 500, marginTop: 11 }}>
                    {ph.count} routines ·{" "}
                    <button
                      onClick={ph.goRoutines}
                      style={{ border: "none", background: "transparent", padding: 0, color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                    >
                      manage
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 11, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: "oklch(0.4 0.04 262)" }}>From you:</span> {ph.you}
                  </div>
                  <PhaseWhy r={phaseReasoning(reasoning, ph.name, ph.routines.map((r) => r.name))} testId="strategy-phase-why" />
                </div>
              ))}
        </div>
      </div>
      <div style={{ marginTop: 28, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 640 }}>
        Over time the build-out grows past routines: specialist agents under Junction, then people where judgement and relationships win. Same strategy, same receipts, bigger organization.
      </div>
    </div>
  );
}
