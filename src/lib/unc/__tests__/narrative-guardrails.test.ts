/* The code-enforced guardrails around Unc's plan narrative (src/lib/unc/narrative.ts).

   The plan is deterministic; Sonnet only writes words around it. These tests feed crafted,
   LLM-like outputs straight into the pure validators (no model, no network) and lock:
     - numbers-only-from-input: a field carrying a number that is not in the request falls back;
     - exactly one note per phase (an extra or missing note rejects the whole list);
     - the footnote must open with the verbatim "I do the work — you bring taste and okays.";
     - a leading "Weeks X–Y:" / "Phase N:" prefix is stripped (the client prepends the real span);
     - each note must still name its phase's channel.

   The request fixture is the demo dataset's real onboarding request (locked against derive()). */

import { describe, expect, it } from "vitest";
import { derive } from "@/lib/platform/derive";
import { planReasoning, type PhaseReasoning } from "@/lib/platform/plan";
import { initialState } from "@/lib/platform/state";
import { DEFAULT_FOOTNOTE, allowedNumbers, buildNarrativeUserMessage, coerceNarrativeRequest, extractJsonObject, numbersOk, parseNarrative, type NarrativeRequest, type PlanNarrative } from "../narrative";
import type { BusinessProfile } from "../scan";

/* plan.ts §Reasoning for the demo founder (brand-led, Writing + Product, NZ$3,600/mo, 6 h/wk) — the
   request carries the three fields the narrative may use, from the same function derive() calls. */
const DEMO_REASONING = planReasoning({ posture: "brand", strengths: ["Writing", "Product"], budgetMo: 3600, hoursWk: 6, businessType: null, currencySymbol: "NZ$" });
const reasoningOf = (r: PhaseReasoning) => ({ whyThisOrder: r.whyThisOrder, evidenceGate: r.evidenceGate, risk: r.risk });

/* The demo founder's request, exactly as derive() builds it from state.ts. */
const REQ: NarrativeRequest = {
  goal: {
    title: "NZ$40,000 MRR",
    deadline: "2026-09-30",
    deadlineLabel: "30 Sept",
    currency: "NZD",
    currencySymbol: "NZ$",
    target: 40000,
    baseline: 28400,
    gap: 11600,
    gapLabel: "NZ$11,600",
    otherGoals: [],
  },
  resources: {
    budgetPerMonth: 3600,
    budgetPerDay: 120,
    hoursPerWeek: 6,
    strengths: ["Writing", "Product"],
    platforms: ["Instagram"],
    postures: ["Brand-led organic"],
    breadth: "focused",
    team: [{ name: "You", role: "Founder" }],
  },
  plan: {
    title: "Brand-led organic, focused where you’re strongest",
    mathLine: "Your goal needs NZ$11,600 of new ground by 30 Sept. With NZ$120/day and 6 h/wk of you, here’s the shortest path I can see:",
    footnote: DEFAULT_FOOTNOTE,
    weeksTotal: 4,
    phases: [
      {
        n: 1,
        spanLabel: "Weeks 1–2",
        channel: "Content",
        why: "organic compounds and costs hours, not dollars",
        text: "Weeks 1–2: our world-class content routines, built around what you do best. Focus: a working engine — drafts flowing, your taste applied, first wins on the board.",
        reasoning: reasoningOf(DEMO_REASONING.byChannel["Content"]),
      },
      {
        n: 2,
        spanLabel: "Week 3",
        channel: "Email & SMS",
        why: "the cheapest revenue is the customers you already have",
        text: "Week 3: we add email & sms — the cheapest revenue is the customers you already have. Focus: converting the momentum into revenue.",
        reasoning: reasoningOf(DEMO_REASONING.byChannel["Email & SMS"]),
      },
      {
        n: 3,
        spanLabel: "Week 4 and beyond",
        channel: "SEO, Paid ads, Sales",
        why: "switch on as their numbers earn it",
        text: "Week 4 and beyond: SEO, Paid ads, Sales switch on as their numbers earn it. Focus: scaling what’s proven, straight through your goal.",
        reasoning: reasoningOf(DEMO_REASONING.byChannel["SEO"]), // phase 3 = the first of the rest
      },
    ],
  },
  profile: null,
};

/* What the deterministic fallback notes look like once the span prefix is stripped. */
const FALLBACK_NOTES = [
  "our world-class content routines, built around what you do best. Focus: a working engine — drafts flowing, your taste applied, first wins on the board.",
  "we add email & sms — the cheapest revenue is the customers you already have. Focus: converting the momentum into revenue.",
  "SEO, Paid ads, Sales switch on as their numbers earn it. Focus: scaling what’s proven, straight through your goal.",
];

/* A well-behaved model output: every number is in the input, one note per phase, channels named, footnote verbatim. */
const GOOD: PlanNarrative = {
  title: "Brand-led organic, content first",
  mathLine: "NZ$11,600 to close by 30 Sept, with NZ$120/day and 6 hours a week from you — here is the path:",
  phaseNotes: [
    "Content runs first: your writing is the engine and 6 hours a week keeps drafts flowing.",
    "Email & SMS joins once there is momentum — the cheapest revenue is the customers you already have.",
    "SEO, paid ads and sales switch on as their numbers earn it.",
  ],
  footnote: "I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.",
};

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (t: string) => (t.match(NUM_RE) ?? []).map((m) => m.replace(/,/g, ""));

describe("the fixture is the demo's real request", () => {
  it("derive(initialState).obNarrativeRequest equals the inline fixture", () => {
    expect(derive(initialState, () => {}).obNarrativeRequest).toEqual(REQ);
  });
});

describe("a well-behaved output passes every field through", () => {
  it("returns all four fields live", () => {
    const r = parseNarrative(GOOD, REQ)!;
    expect(r.liveFields).toBe(4);
    expect(r.narrative).toEqual(GOOD);
  });
});

describe("numbers-only-from-input", () => {
  it("the allowed set is exactly the request's number literals plus the counts 1–12", () => {
    const a = allowedNumbers(REQ);
    for (let i = 1; i <= 12; i++) expect(a.has(String(i))).toBe(true);
    for (const n of ["40000", "28400", "11600", "3600", "120", "2026", "09", "30"]) expect(a.has(n)).toBe(true);
    for (const n of ["13", "14000", "500", "1.5", "3218", "171", "278"]) expect(a.has(n)).toBe(false);
  });

  it("commas are normalised so 'NZ$11,600' and '11600' are the same number", () => {
    const a = allowedNumbers(REQ);
    expect(numbersOk("NZ$11,600 by 30 Sept", a)).toBe(true);
    expect(numbersOk("11600", a)).toBe(true);
  });

  it("a computed number the app itself shows (NZ$3,218 behind, NZ$171/day) is still rejected — it is not in the request", () => {
    const a = allowedNumbers(REQ);
    expect(numbersOk("you're NZ$3,218 behind at NZ$171 a day", a)).toBe(false);
  });

  it("decimals not present in the input are rejected", () => {
    expect(numbersOk("a 1.5x lift", allowedNumbers(REQ))).toBe(false);
  });

  it("an invented number in mathLine → that field falls back; the others stay live", () => {
    const r = parseNarrative({ ...GOOD, mathLine: "NZ$14,000 to close by 30 Sept:" }, REQ)!;
    expect(r.narrative.mathLine).toBe(REQ.plan.mathLine);
    expect(r.narrative.title).toBe(GOOD.title);
    expect(r.narrative.phaseNotes).toEqual(GOOD.phaseNotes);
    expect(r.liveFields).toBe(3);
  });

  it("an invented number in the title → title falls back", () => {
    const r = parseNarrative({ ...GOOD, title: "Brand-led organic, 20% faster" }, REQ)!;
    expect(r.narrative.title).toBe(REQ.plan.title);
    expect(r.liveFields).toBe(3);
  });

  it("an invented number in ONE phase note → ALL notes fall back (the list is all-or-nothing)", () => {
    const notes = [...GOOD.phaseNotes];
    notes[1] = "Email & SMS joins — expect NZ$500 a week from the list.";
    const r = parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
    expect(r.liveFields).toBe(3);
  });

  it("an invented number in the footnote → footnote falls back to the verbatim default", () => {
    const r = parseNarrative({ ...GOOD, footnote: "I do the work — you bring taste and okays. I read 14 pages of your site tonight." }, REQ)!;
    expect(r.narrative.footnote).toBe(DEFAULT_FOOTNOTE);
  });

  it("small counts 1–12 are always allowed (phase numbers, 'three', '2 sentences')", () => {
    const r = parseNarrative({ ...GOOD, title: "Brand-led organic in 3 moves" }, REQ)!;
    expect(r.narrative.title).toBe("Brand-led organic in 3 moves");
  });

  it("profile numbers become allowed only when a profile is attached", () => {
    const profile: BusinessProfile = {
      name: "AVGAR Sport",
      oneLiner: "Luxury women's golf, made in NZ",
      category: "apparel",
      products: ["Links 3.0 bag", "Fairway polo"],
      audience: "women who golf",
      voice: { tone: "quiet luxury", phrases: ["earned, not shouted"] },
      market: { region: "NZ/AU", competitorsMentioned: [] },
      signals: ["4.9-star reviews"],
      confidence: "high",
      sources: ["https://www.avgarsport.com/"],
    };
    const note = "Content runs first — the Links 3.0 bag is the story.";
    expect(numbersOk(note, allowedNumbers(REQ))).toBe(false);
    expect(numbersOk(note, allowedNumbers({ ...REQ, profile }))).toBe(true);
    expect(numbersOk("4.9-star", allowedNumbers({ ...REQ, profile }))).toBe(true);
  });

  it("CONTRACT: whatever the model emits, every number in the returned narrative is in allowedNumbers(req)", () => {
    const adversarial: unknown[] = [
      GOOD,
      { ...GOOD, mathLine: "NZ$99,999 by tomorrow:" },
      { ...GOOD, title: "1000x in 90 days" },
      { ...GOOD, phaseNotes: GOOD.phaseNotes.map((n) => `${n} Expect 250 leads.`) },
      { ...GOOD, footnote: "I do the work — you bring taste and okays. 37 routines are live." },
      { title: 42, mathLine: null, phaseNotes: "not a list", footnote: ["nope"] },
      {},
    ];
    const allowed = allowedNumbers(REQ);
    for (const raw of adversarial) {
      const r = parseNarrative(raw, REQ)!;
      const fields = [r.narrative.title, r.narrative.mathLine, r.narrative.footnote, ...r.narrative.phaseNotes];
      for (const f of fields) for (const n of numbersIn(f)) expect(allowed.has(n), `"${n}" leaked via "${f}"`).toBe(true);
    }
  });
});

describe("one note per phase", () => {
  it("an extra (4th) note → the whole list is rejected and the deterministic notes are used", () => {
    const r = parseNarrative({ ...GOOD, phaseNotes: [...GOOD.phaseNotes, "Then we scale."] }, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
    expect(r.liveFields).toBe(3);
  });

  it("a missing note (2 of 3) → rejected", () => {
    const r = parseNarrative({ ...GOOD, phaseNotes: GOOD.phaseNotes.slice(0, 2) }, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
  });

  it("phaseNotes that is not an array → rejected", () => {
    const r = parseNarrative({ ...GOOD, phaseNotes: GOOD.phaseNotes.join(" ") }, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
  });

  it("a note longer than 2 sentences is clipped to 2, not rejected", () => {
    const notes = [...GOOD.phaseNotes];
    notes[0] = "Content runs first. Your writing is the engine. This third sentence must go.";
    const r = parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!;
    expect(r.narrative.phaseNotes[0]).toBe("Content runs first. Your writing is the engine.");
    expect(r.liveFields).toBe(4);
  });

  it("the fallback notes are the deterministic texts with their span prefix removed", () => {
    const r = parseNarrative({}, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
    expect(r.liveFields).toBe(0);
  });
});

describe("week-span prefix stripping (the client prepends the real span)", () => {
  const strip = (note: string) => {
    const notes = [...GOOD.phaseNotes];
    notes[0] = note;
    return parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[0];
  };

  it("'Weeks 1–2: …' is stripped", () => {
    expect(strip("Weeks 1–2: Content runs first, your writing is the engine.")).toBe("Content runs first, your writing is the engine.");
  });

  it("'Week 1 - …' and 'Weeks 1-2 — …' (ASCII hyphen / em dash) are stripped", () => {
    expect(strip("Week 1 - Content runs first.")).toBe("Content runs first.");
    expect(strip("Weeks 1-2 — Content runs first.")).toBe("Content runs first.");
  });

  it("'Phase 1: Weeks 1–2: …' is stripped as one prefix", () => {
    expect(strip("Phase 1: Weeks 1–2: Content runs first.")).toBe("Content runs first.");
  });

  it("'Weeks 4 and beyond: …' is stripped", () => {
    const notes = [...GOOD.phaseNotes];
    notes[2] = "Week 4 and beyond: SEO, paid ads and sales switch on as their numbers earn it.";
    expect(parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[2]).toBe("SEO, paid ads and sales switch on as their numbers earn it.");
  });

  it("a span in the middle of a note is NOT stripped — and its numbers must still be allowed", () => {
    // 1 and 2 are small counts, so this passes the number rule; the guard only strips a leading prefix.
    expect(strip("Content runs first across weeks 1–2, then hands over.")).toBe("Content runs first across weeks 1–2, then hands over.");
  });

  it("a wrong span in the prefix is stripped too — the model cannot move weeks by prefixing them", () => {
    expect(strip("Weeks 1–6: Content runs first.")).toBe("Content runs first.");
  });
});

describe("channel name required", () => {
  it("a note that never names its channel → the whole list falls back", () => {
    const notes = [...GOOD.phaseNotes];
    notes[1] = "We add the cheapest revenue there is — the customers you already have.";
    const r = parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!;
    expect(r.narrative.phaseNotes).toEqual(FALLBACK_NOTES);
  });

  it("the check is on the first word of the channel, case-insensitive ('email' for 'Email & SMS')", () => {
    const notes = [...GOOD.phaseNotes];
    notes[1] = "EMAIL first, SMS later — the customers you already have.";
    expect(parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[1]).toBe(notes[1]);
  });

  it("phase 3's comma-joined channel list passes when the note keeps 'SEO,' with its comma", () => {
    const notes = [...GOOD.phaseNotes];
    notes[2] = "SEO, paid ads and sales switch on as their numbers earn it.";
    expect(parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[2]).toBe(notes[2]);
  });

  /* BUG narrative.ts:286–288 — `channel.toLowerCase().split(/\s|&/)[0]` on the comma-joined phase-3
     channel "SEO, Paid ads, Sales" yields the token "seo," (comma attached). A perfectly good note
     such as "SEO and paid ads switch on…" does not contain "seo," and is rejected — which throws away
     ALL three live notes (all-or-nothing). Expected: the token should be "seo". */
  it("KNOWN BUG: a phase-3 note naming 'SEO' without a trailing comma should be accepted", () => {
    const notes = [...GOOD.phaseNotes];
    notes[2] = "SEO and paid ads switch on as their numbers earn it, sales last.";
    expect(parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[2]).toBe(notes[2]);
  });

  it("a phase-3 note naming 'SEO' (comma-joined channel) is accepted after the token fix", () => {
    const notes = [...GOOD.phaseNotes];
    notes[2] = "SEO and paid ads switch on as their numbers earn it, sales last.";
    expect(parseNarrative({ ...GOOD, phaseNotes: notes }, REQ)!.narrative.phaseNotes[2]).toBe(notes[2]);
  });
});

describe("footnote prefix", () => {
  it("missing the verbatim opener → falls back to DEFAULT_FOOTNOTE", () => {
    const r = parseNarrative({ ...GOOD, footnote: "I’ll do the work — you bring the taste. Scan tonight." }, REQ)!;
    expect(r.narrative.footnote).toBe(DEFAULT_FOOTNOTE);
    expect(r.liveFields).toBe(3);
  });

  it("an ASCII hyphen instead of the em dash is tolerated", () => {
    const f = "I do the work - you bring taste and okays. I read your site tonight.";
    expect(parseNarrative({ ...GOOD, footnote: f }, REQ)!.narrative.footnote).toBe(f);
  });

  it("the opener must be the FIRST sentence, not merely present", () => {
    const f = "Tonight I scan your site. I do the work — you bring taste and okays.";
    expect(parseNarrative({ ...GOOD, footnote: f }, REQ)!.narrative.footnote).toBe(DEFAULT_FOOTNOTE);
  });

  it("the opener without its full stop is rejected", () => {
    const f = "I do the work — you bring taste and okays, and I scan tonight.";
    expect(parseNarrative({ ...GOOD, footnote: f }, REQ)!.narrative.footnote).toBe(DEFAULT_FOOTNOTE);
  });

  it("DEFAULT_FOOTNOTE is the design-reference copy, verbatim", () => {
    expect(DEFAULT_FOOTNOTE).toBe("I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.");
  });
});

describe("field hygiene", () => {
  it("markdown in a field → that field falls back", () => {
    expect(parseNarrative({ ...GOOD, title: "**Brand-led** organic" }, REQ)!.narrative.title).toBe(REQ.plan.title);
    expect(parseNarrative({ ...GOOD, mathLine: "# NZ$11,600 to close:" }, REQ)!.narrative.mathLine).toBe(REQ.plan.mathLine);
  });

  it("an emoji in a field → falls back", () => {
    expect(parseNarrative({ ...GOOD, title: "Brand-led organic 🚀" }, REQ)!.narrative.title).toBe(REQ.plan.title);
  });

  it("the title loses a trailing full stop; the mathLine gains a colon if it ends with a full stop", () => {
    const r = parseNarrative({ ...GOOD, title: "Brand-led organic, content first.", mathLine: "NZ$11,600 to close by 30 Sept." }, REQ)!;
    expect(r.narrative.title).toBe("Brand-led organic, content first");
    expect(r.narrative.mathLine).toBe("NZ$11,600 to close by 30 Sept:");
  });

  it("a non-string field falls back without throwing", () => {
    const r = parseNarrative({ title: 12, mathLine: ["x"], phaseNotes: [1, 2, 3], footnote: null }, REQ)!;
    expect(r.narrative).toEqual({ title: REQ.plan.title, mathLine: REQ.plan.mathLine, phaseNotes: FALLBACK_NOTES, footnote: DEFAULT_FOOTNOTE });
    expect(r.liveFields).toBe(0);
  });

  it("a non-object payload returns null (caller keeps the deterministic copy)", () => {
    expect(parseNarrative(null, REQ)).toBeNull();
    expect(parseNarrative("just prose", REQ)).toBeNull();
  });
});

describe("extractJsonObject", () => {
  it("pulls the object out of prose-wrapped or fenced output", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"title":"x"}\n```')).toEqual({ title: "x" });
  });

  it("returns null for no braces or broken JSON", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject('{"title": oops}')).toBeNull();
  });
});

describe("coerceNarrativeRequest (the route-side input gate)", () => {
  it("round-trips the demo request unchanged", () => {
    expect(coerceNarrativeRequest(JSON.parse(JSON.stringify(REQ)))).toEqual(REQ);
  });

  it("a plan with no usable phases is unusable → null", () => {
    expect(coerceNarrativeRequest({ ...REQ, plan: { ...REQ.plan, phases: [] } })).toBeNull();
    expect(coerceNarrativeRequest({ ...REQ, plan: { ...REQ.plan, phases: [{ spanLabel: "Weeks 1–2" }] } })).toBeNull();
    expect(coerceNarrativeRequest(null)).toBeNull();
  });

  it("caps phases at 5 and renumbers them", () => {
    const phases = Array.from({ length: 8 }, () => ({ ...REQ.plan.phases[0], n: 99 }));
    const r = coerceNarrativeRequest({ ...REQ, plan: { ...REQ.plan, phases } })!;
    expect(r.plan.phases).toHaveLength(5);
    expect(r.plan.phases.map((p) => p.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a missing footnote/currency falls back to the defaults and numbers coerce to 0", () => {
    const r = coerceNarrativeRequest({ plan: { phases: REQ.plan.phases } })!;
    expect(r.plan.footnote).toBe(DEFAULT_FOOTNOTE);
    expect(r.goal.currency).toBe("NZD");
    expect(r.goal.currencySymbol).toBe("NZ$");
    expect(r.goal.target).toBe(0);
    expect(r.resources.breadth).toBe("focused");
  });
});

describe("prompt assembly", () => {
  it("the user message carries the plan verbatim and marks it as not the model's to change", () => {
    const m = buildNarrativeUserMessage(REQ);
    expect(m).toContain("DETERMINISTIC PLAN (fixed — write around it, never change it)");
    expect(m).toContain(JSON.stringify(REQ.plan));
    expect(m).toContain("BUSINESS PROFILE");
    expect(m.endsWith("Write the JSON now.")).toBe(true);
  });
});
