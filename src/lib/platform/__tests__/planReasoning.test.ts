/* The judgement under the plan (src/lib/platform/plan.ts §Reasoning, 2026-09-03): per-phase
   why-this-order / evidence gate / risk / weekly, and the one pushback line when the founder's
   posture and the evidence disagree. Deterministic over the scoring inputs; the phases and
   weeks the scorer produces are untouched (plan.test.ts still locks them).

   The numbers contract, same as the narrative's: every number literal in the prose is one of
   the founder's inputs (budget/day, hours), a count of 12 or under, or the paid gate the scorer
   already applies (NZ$50/day). Nothing else. */

import { describe, expect, it } from "vitest";
import { PAID_GATE_PER_DAY, planReasoning, postureDisagreement, reasonChannel, reasonOrganization, scoreChannels, type ChannelKey, type ReasoningInput } from "../plan";

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

function allowed(input: ReasoningInput): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i <= 12; i++) set.add(String(i));
  set.add(String(Math.round(input.budgetMo / 30)));
  set.add(String(PAID_GATE_PER_DAY));
  if (input.hoursWk !== null) set.add(String(input.hoursWk));
  return set;
}

function numbersOnlyFromInputs(input: ReasoningInput) {
  const r = planReasoning(input);
  const texts = [...Object.values(r.byChannel).flatMap((p) => [p.whyThisOrder, p.evidenceGate, p.risk, p.whatIDoWeekly]), r.pushback ?? ""];
  const ok = allowed(input);
  for (const t of texts) for (const m of t.match(NUM_RE) ?? []) expect(ok.has(m.replace(/,/g, "")), `${m} in "${t}"`).toBe(true);
}

const acme: ReasoningInput = { posture: "brand", strengths: ["Writing", "Email"], budgetMo: 3600, hoursWk: 8, businessType: "ecommerce" };

describe("planReasoning — shape and order", () => {
  it("follows the scorer's ranking: phase reasoning in ranked order, every channel keyed, positions 1/2/later", () => {
    const r = planReasoning(acme);
    const ranked = scoreChannels("brand", ["Writing", "Email"], 3600).map((c) => c.k);
    expect(ranked).toEqual(["Content", "Email & SMS", "SEO", "Paid ads", "Sales"]);
    expect(r.phases.map((p) => p.channel)).toEqual(["Content", "Email & SMS", "SEO"]);
    expect(Object.keys(r.byChannel).sort()).toEqual([...ranked].sort());
    expect(r.byChannel.Content.whyThisOrder).toMatch(/^Content first because Writing is your strength/);
    expect(r.byChannel.Content.whyThisOrder).toContain("One channel proven before two.");
    expect(r.byChannel["Email & SMS"].whyThisOrder).toMatch(/^Email second because it's owned/);
    expect(r.byChannel["Email & SMS"].whyThisOrder).toContain("content earns");
    expect(r.byChannel["Paid ads"].whyThisOrder).toMatch(/^Paid later because it should only scale creative already proven/);
    expect(r.byChannel.SEO.whyThisOrder).toMatch(/^SEO later/);
    expect(r.byChannel.Sales.whyThisOrder).toContain("8 h/wk");
  });

  it("every phase carries the four fields, gates are evidence not calendar, weekly lines are first person", () => {
    const r = planReasoning(acme);
    for (const p of Object.values(r.byChannel)) {
      for (const f of [p.whyThisOrder, p.evidenceGate, p.risk, p.whatIDoWeekly]) expect(f.length).toBeGreaterThan(30);
      expect(p.whatIDoWeekly).toMatch(/^I /);
      expect(p.evidenceGate).not.toMatch(/\bweek \d/i);
    }
    expect(r.byChannel.Content.evidenceGate).toContain("not the week number");
    expect(r.byChannel["Paid ads"].evidenceGate).toContain("NZ$120/day");
    expect(r.byChannel["Paid ads"].evidenceGate).toContain("cost per order");
    expect(r.byChannel.Content.risk).toContain("8 h/wk");
    expect(r.byChannel.Sales.risk).toContain("8 h/wk");
  });

  it("business type changes the demand unit (orders vs booked conversations), nothing else", () => {
    const shop = planReasoning({ ...acme, businessType: "ecommerce" });
    const svc = planReasoning({ ...acme, businessType: "services" });
    expect(shop.byChannel["Paid ads"].evidenceGate).toContain("cost per order");
    expect(svc.byChannel["Paid ads"].evidenceGate).toContain("cost per booked conversation");
    expect(shop.byChannel["Email & SMS"].evidenceGate).toContain("repeat rate");
    expect(svc.byChannel["Email & SMS"].evidenceGate).toContain("replies and rebookings");
    expect(svc.phases.map((p) => p.channel)).toEqual(shop.phases.map((p) => p.channel));
    expect(planReasoning({ ...acme, businessType: null }).byChannel["Paid ads"].evidenceGate).toContain("cost per order");
  });

  it("hours unknown: the prose leaves hours out rather than inventing them", () => {
    const r = planReasoning({ ...acme, hoursWk: null });
    expect(r.byChannel.Content.risk).not.toMatch(/h\/wk/);
    expect(r.byChannel.Sales.risk).not.toMatch(/h\/wk/);
    expect(r.byChannel.Sales.whyThisOrder).not.toMatch(/h\/wk/);
  });

  it("the paid gate reads differently under NZ$50/day (probe, noise) and over it (scale a proven winner)", () => {
    const under = reasonChannel("Paid ads", { ...acme, budgetMo: 900 }, 3);
    const over = reasonChannel("Paid ads", acme, 3);
    expect(under.whyThisOrder).toContain("NZ$30/day is under the NZ$50/day");
    expect(under.risk).toContain("never leave learning");
    expect(over.risk).toContain("second-best creative eats NZ$120/day");
    const first = reasonChannel("Paid ads", { posture: "paid", strengths: ["Paid media"], budgetMo: 6000, hoursWk: 5 }, 1);
    expect(first.whyThisOrder).toContain("NZ$200/day is enough to buy learning fast and paid media is your strength");
  });

  it("the organization phase: last, paid for by the phases before, gated on the goal number", () => {
    const o = reasonOrganization();
    expect(o.channel).toBe("org");
    expect(o.whyThisOrder).toMatch(/^Last because the phases before it pay for it/);
    expect(o.risk).toContain("Hiring ahead of proof");
    expect(o.whatIDoWeekly).toMatch(/^Nothing yet\./);
  });
});

describe("postureDisagreement — what I'd push back on", () => {
  it("is null when posture and evidence agree", () => {
    expect(postureDisagreement(acme)).toBeNull();
    expect(postureDisagreement({ posture: "paid", strengths: ["Paid media"], budgetMo: 6000, hoursWk: 5 })).toBeNull();
    expect(postureDisagreement({ posture: "sales", strengths: ["Cold calls"], budgetMo: 0, hoursWk: 10 })).toBeNull();
  });

  it("paid-led under NZ$50/day: names the gate, the channel it would start on instead, and leaves the call", () => {
    const line = postureDisagreement({ posture: "paid", strengths: ["Paid media"], budgetMo: 900, hoursWk: 6 });
    expect(line).toBe("Paid-led on NZ$30/day: under NZ$50/day the platforms never leave learning, so the spend buys noise. I'd start on email & sms and stage a paid probe once it has something proven to amplify. Your call.");
    // email & sms is the scorer's best non-paid channel for this founder (1.2 × 1.2 = 1.44 beats Content 1.1 with no content strength)
    // the scorer still puts paid first for this founder (2.5 × 2 × 0.3 = 1.5 > Content 1.1) — the plan stays, the pushback is the judgement
    expect(scoreChannels("paid", ["Paid media"], 900)[0].k).toBe("Paid ads");
  });

  it("paid-led without paid media; sales-led without outreach; brand-led on too few hours; brand-led with a paid strength and budget", () => {
    expect(postureDisagreement({ posture: "paid", strengths: ["Writing"], budgetMo: 6000, hoursWk: 5 })).toMatch(/^Paid-led without paid media among your strengths: .* I'd run content first to find the hook, then put NZ\$200\/day behind what wins\. Your call\.$/);
    expect(postureDisagreement({ posture: "sales", strengths: [], budgetMo: 3000, hoursWk: 10 })).toMatch(/^Sales-led without calls or DMs among your strengths: the pipeline runs on your hours\. I'd run email & sms first .* Your call\.$/);
    // with Writing as a strength the scorer already puts Content ahead of Sales, so that is the channel it names
    expect(postureDisagreement({ posture: "sales", strengths: ["Writing"], budgetMo: 3000, hoursWk: 10 })).toContain("I'd run content first");
    expect(postureDisagreement({ posture: "brand", strengths: ["Writing"], budgetMo: 3000, hoursWk: 2 })).toBe("Brand-led on 2 h/wk: organic costs hours, and that many starves it. I'd lean on email & sms first and keep content to what you can record. Your call.");
    expect(postureDisagreement({ posture: "brand", strengths: ["Paid media"], budgetMo: 3000, hoursWk: 8 })).toMatch(/^Brand-led, but paid media is your strength and NZ\$100\/day is enough to test: .* Your call\.$/);
    // hours unknown never triggers the hours pushback
    expect(postureDisagreement({ posture: "brand", strengths: ["Writing"], budgetMo: 3000, hoursWk: null })).toBeNull();
  });

  it("every pushback ends with the founder's call", () => {
    const cases: ReasoningInput[] = [
      { posture: "paid", strengths: [], budgetMo: 300, hoursWk: 4 },
      { posture: "paid", strengths: ["Video"], budgetMo: 9000, hoursWk: 4 },
      { posture: "sales", strengths: [], budgetMo: 0, hoursWk: 4 },
      { posture: "brand", strengths: [], budgetMo: 0, hoursWk: 1 },
    ];
    for (const c of cases) expect(postureDisagreement(c)).toMatch(/Your call\.$/);
  });
});

describe("numbers contract — only the founder's inputs, counts ≤ 12, and the NZ$50/day gate", () => {
  const founders: ReasoningInput[] = [
    acme,
    { ...acme, hoursWk: null },
    { posture: "paid", strengths: ["Paid media"], budgetMo: 900, hoursWk: 6 },
    { posture: "paid", strengths: [], budgetMo: 12000, hoursWk: 20, businessType: "saas" },
    { posture: "sales", strengths: ["DMs & outreach"], budgetMo: 0, hoursWk: 15, businessType: "b2b" },
    { posture: "sales", strengths: [], budgetMo: 1500, hoursWk: 3, businessType: "local" },
    { posture: "brand", strengths: ["SEO", "Community"], budgetMo: 2400, hoursWk: 2, businessType: "creator" },
    { posture: "brand", strengths: ["Paid media"], budgetMo: 4500, hoursWk: 40, businessType: "other", currencySymbol: "A$" },
  ];
  for (const f of founders) it(`${f.posture} · ${f.strengths.join("+") || "no strengths"} · ${f.budgetMo}/mo · ${f.hoursWk ?? "?"} h`, () => numbersOnlyFromInputs(f));

  it("the currency symbol follows the input", () => {
    const r = planReasoning({ ...acme, currencySymbol: "A$" });
    expect(r.byChannel["Paid ads"].evidenceGate).toContain("A$120/day");
    expect(r.byChannel["Paid ads"].evidenceGate).not.toContain("NZ$");
  });

  it("reasonChannel covers every channel at every position without throwing", () => {
    const keys: ChannelKey[] = ["Content", "Sales", "Paid ads", "Email & SMS", "SEO"];
    for (const k of keys) for (const pos of [1, 2, 3, 4]) expect(reasonChannel(k, acme, pos, "Content").whyThisOrder.length).toBeGreaterThan(20);
  });
});
