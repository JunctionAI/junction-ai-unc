/* StrategyView — the judgement under each phase (2026-09-03): plan.ts §Reasoning rendered as a
   collapsed "Why this order · What flips it · The risk" block per build-out phase, and the one
   "What I'd push back on" line when the founder's posture and the evidence disagree. Rendered
   to a string (react-dom/server). The inputs are the founder's own — resource_profiles in
   accounts mode, the state's onboarding answers in demo — and no amber is spent on it. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { derive } from "@/lib/platform/derive";
import { planReasoning } from "@/lib/platform/plan";
import { initialState, type PlatformState } from "@/lib/platform/state";
import { __setAccountFactsForTests, type AccountFacts, type AccountFactsState } from "@/lib/unc/accountFacts";
import StrategyView, { phaseChannel, phaseReasoning, reasoningInputs } from "../StrategyView";

const noop = () => {};
const state = (over: Partial<PlatformState> = {}): PlatformState => ({ ...initialState, ...over });
const V = (s: PlatformState) => derive(s, noop);

const facts = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  accountId: "acct-1",
  connectors: [],
  routineStates: [],
  plan: null,
  resources: { budgetMonthly: 900, hoursWeekly: 6, skills: ["Paid media"], postures: ["Paid-led scale"] },
  approvals: [],
  decided: [],
  runs: [],
  receipts: [],
  fetchedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});
const account = (over: Partial<AccountFactsState> = {}): AccountFactsState => ({ mode: "account", accountId: "acct-1", facts: facts(), loading: false, error: null, ...over });

afterEach(() => __setAccountFactsForTests(null));

describe("phaseChannel", () => {
  it("reads the channel from the phase's routines (catalog majority), then from its name, and null for the organization phase", () => {
    expect(phaseChannel("Organic brand engine", ["Founder content engine", "Social repurposing", "Customer-question mining"])).toBe("Content");
    expect(phaseChannel("Retention & lifecycle", ["Winback campaign prep", "Welcome flow tuning", "Review request timing"])).toBe("Email & SMS");
    expect(phaseChannel("Paid amplification", ["Daily paid decisioning", "Organic-to-paid promotion"])).toBe("Paid ads");
    expect(phaseChannel("Referral & expansion", ["Review request timing", "Winback campaign prep"])).toBe("Email & SMS");
    expect(phaseChannel("Pipeline engine", ["Lead research & scoring", "Supervised outbound drafts"])).toBe("Sales");
    expect(phaseChannel("Scale the organization", ["Specialist agents", "First human hire"])).toBeNull();
    expect(phaseChannel("Creative testing engine", [])).toBe("Paid ads");
    expect(phaseChannel("Search foundations", [])).toBe("SEO");
    expect(phaseChannel("Something else entirely", [])).toBeNull();
  });
});

describe("reasoningInputs", () => {
  it("accounts mode: the resource profile (posture from its label, skills, budget, hours); demo: the state's onboarding answers", () => {
    const v = V(state());
    const acct = reasoningInputs(v, facts());
    expect(acct).toMatchObject({ posture: "paid", strengths: ["Paid media"], budgetMo: 900, hoursWk: 6, businessType: null });
    const demo = reasoningInputs(v, null);
    expect(demo).toMatchObject({ posture: v.realInputs.posture, strengths: v.realInputs.obStrengths, budgetMo: v.realInputs.budgetMo, hoursWk: v.obHoursWk });
    expect(demo.currencySymbol).toBe(v.curSym);
    // a posture key stored directly still works; an unknown label falls back to the state's posture
    expect(reasoningInputs(v, facts({ resources: { budgetMonthly: 0, hoursWeekly: 2, skills: [], postures: ["sales"] } })).posture).toBe("sales");
    expect(reasoningInputs(v, facts({ resources: { budgetMonthly: 0, hoursWeekly: 2, skills: [], postures: ["nope"] } })).posture).toBe(v.realInputs.posture);
    // no resource profile row yet → the state's answers, never a made-up number
    expect(reasoningInputs(v, facts({ resources: null })).budgetMo).toBe(v.realInputs.budgetMo);
  });
});

describe("StrategyView — the judgement under the phases", () => {
  it("demo mode: every phase carries a collapsed why block; the brand-led demo founder gets no pushback", () => {
    __setAccountFactsForTests(null);
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect((html.match(/data-testid="strategy-phase-why"/g) ?? []).length).toBe(4);
    expect((html.match(/Why this order · What flips it · The risk/g) ?? []).length).toBe(4);
    expect(html).toContain("Content first because Writing is your strength");
    expect(html).toContain("Email second because it");
    expect(html).toContain("Last because the phases before it pay for it");
    expect(html).toContain("Weekly, from me");
    expect(html).not.toContain('data-testid="strategy-pushback"');
    expect(html).not.toContain("var(--amber");
    // the prototype's own furniture is untouched
    expect(html).toContain("GATED · repeat ≥ 18%");
    expect(html).toContain("Chosen with you on 12 Aug");
  });

  it("accounts mode, paid-led on NZ$30/day: the pushback line names the gate and leaves the call; phases read from the routines", () => {
    __setAccountFactsForTests(account());
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect(html).toContain('data-testid="strategy-pushback"');
    expect(html).toContain("What I’d push back on");
    expect(html).toContain("Paid-led on NZ$30/day: under NZ$50/day the platforms never leave learning");
    expect(html).toContain("Your call.");
    expect(html).not.toContain("var(--amber");
    expect((html.match(/data-testid="strategy-phase-why"/g) ?? []).length).toBe(4);
    // the demo posture's phases (no plan row) are reasoned by their routines, with the account's own numbers
    expect(html).toContain("NZ$30/day is testing money");
    expect(html).toContain("6 h/wk");
    expect(html).not.toContain("8 h/wk");
  });

  it("accounts mode with an agreed plan row: reasoning follows the saved phases' routines", () => {
    __setAccountFactsForTests(
      account({
        facts: facts({
          resources: { budgetMonthly: 3600, hoursWeekly: 8, skills: ["Writing", "Email"], postures: ["Brand-led organic"] },
          plan: {
            title: "Brand-led organic",
            agreedAt: "2026-08-20T00:00:00.000Z",
            phases: [
              { n: "1", name: "Organic brand engine", status: "ACTIVE", routines: ["Founder content engine"], from_you: "clips" },
              { n: "2", name: "Retention & lifecycle", status: "NOW", routines: ["Welcome flow tuning"], from_you: "okays" },
              { n: "3", name: "Scale the organization", status: "GATED", routines: ["Specialist agents"], from_you: "hires" },
            ],
          },
        }),
      }),
    );
    const html = renderToStaticMarkup(createElement(StrategyView, { V: V(state({ view: "strategy" })) }));
    expect((html.match(/data-testid="strategy-phase-why"/g) ?? []).length).toBe(3);
    expect(html).toContain("Content first because Writing is your strength");
    expect(html).toContain("Email second because it");
    expect(html).toContain("Hiring ahead of proof");
    expect(html).not.toContain('data-testid="strategy-pushback"');
  });

  it("phaseReasoning is pure: channel phases from byChannel, the organization phase from reasonOrganization", () => {
    const r = planReasoning({ posture: "brand", strengths: ["Writing"], budgetMo: 3600, hoursWk: 8 });
    expect(phaseReasoning(r, "Organic brand engine", ["Founder content engine"])).toBe(r.byChannel.Content);
    expect(phaseReasoning(r, "Paid amplification", ["Daily paid decisioning"])).toBe(r.byChannel["Paid ads"]);
    expect(phaseReasoning(r, "Scale the organization", ["Specialist agents"]).channel).toBe("org");
  });
});
