/* Each wave-1 skill's `minimum` on fixture accounts: a services business with only a site
   profile gets founder content, questions, keywords, gaps and a calendar; the sales skills ask
   for what they honestly need; the cart routine is store-only. */

import { describe, expect, it } from "vitest";
import { SKILL_BY_ID, SKILLS } from "../skills";
import type { SkillContext } from "../skills/types";
import type { ReadResult } from "../types";
import { CATALOG_SPEC_BY_ID, WAVE_1_IDS } from "../catalog-specs";

const SERVICES_PROFILE = { name: "Harbour Physio", oneLiner: "Sports physiotherapy in Auckland", category: "Health services", products: ["ACC physio", "Running assessments"], audience: "Runners and gym-goers", voice: { tone: "plain, warm", phrases: ["get you back out there"] }, market: { region: "Auckland, NZ", competitorsMentioned: [] }, signals: ["FAQ: do I need a referral?", "Open Saturdays"], confidence: "medium" as const, sources: ["https://harbourphysio.test"] };

const read = (rows: Record<string, unknown>[], provenance = "ok"): ReadResult => ({ rows, metrics: {}, fetchedAt: "2026-09-03T07:00:00.000Z", provenance });

function sctx(over: Partial<SkillContext> = {}): SkillContext {
  return { routineId: "D01-W01", accountId: "acct-1", profile: null, memories: [], reads: {}, inputs: {}, vars: {}, goal: null, plan: null, priorArtifacts: [], founderNotes: null, currency: "NZD", today: "2026-09-03", ...over };
}

describe("skill cards", () => {
  it("one per wave-1 routine, each stating its kind, prompt, output shape and minimum", () => {
    expect(SKILLS.map((s) => s.id).sort()).toEqual([...WAVE_1_IDS].sort());
    for (const s of SKILLS) {
      expect(s.routineId).toBe(s.id);
      expect(s.prompt.length).toBeGreaterThan(200);
      expect(s.outputSpec).toContain(`"kind":"${s.kind}"`);
      expect(s.minimum.summary.length).toBeGreaterThan(10);
      expect(s.maxItems).toBeGreaterThan(0);
      expect(CATALOG_SPEC_BY_ID[s.id].minimum).toEqual(s.minimum);
    }
  });

  it("nothing known → every skill asks instead of drafting", () => {
    for (const s of SKILLS) {
      const c = s.check(sctx({ routineId: s.id }));
      expect(c.ok, s.id).toBe(false);
      if (!c.ok) expect(c.needs.length).toBeGreaterThan(0);
    }
  });
});

describe("a services business with only a site profile (no connectors)", () => {
  const base = sctx({ profile: SERVICES_PROFILE, reads: { questions: read([], "unavailable"), posts: read([], "unavailable"), products: read([], "unavailable") } });

  it("Founder content engine produces", () => {
    const c = SKILL_BY_ID["D01-W01"].check(base);
    expect(c).toEqual({ ok: true, using: ["site profile"] });
  });

  it("Founder content engine also produces from three memories about the business, or a founder note", () => {
    expect(SKILL_BY_ID["D01-W01"].check(sctx({ memories: ["[fact] Sells marine collagen", "[fact] Ships from Auckland", "[constraint] Never discount the flagship"] })).ok).toBe(true);
    expect(SKILL_BY_ID["D01-W01"].check(sctx({ memories: ["[summary] Earlier the founder said hi", "[fact] one fact"] })).ok).toBe(false);
    expect(SKILL_BY_ID["D01-W01"].check(sctx({ inputs: { about_the_business: "We do physio" } })).ok).toBe(true);
  });

  it("Customer-question mining falls back to the site's FAQ/product text and says so", () => {
    const c = SKILL_BY_ID["D01-W03"].check(sctx({ profile: SERVICES_PROFILE }));
    expect(c).toEqual({ ok: true, using: ["your site's product/FAQ text (no support connector yet)"] });
    const thin = SKILL_BY_ID["D01-W03"].check(sctx({ profile: { ...SERVICES_PROFILE, products: [], signals: [], voice: { tone: null, phrases: [] } } }));
    expect(thin.ok).toBe(false);
    if (!thin.ok) expect(thin.needs.map((n) => n.platform ?? n.input)).toEqual(["gorgias", "customer_questions"]);
    expect(SKILL_BY_ID["D01-W03"].check(sctx({ reads: { tickets: read([{ subject: "Refund?" }]) } }))).toEqual({ ok: true, using: ["1 tickets"] });
  });

  it("Keyword scan and Content gap produce hypotheses from the profile", () => {
    expect(SKILL_BY_ID["D03-W01"].check(base).ok).toBe(true);
    expect(SKILL_BY_ID["D03-W02"].check(base).ok).toBe(true);
    expect(SKILL_BY_ID["D03-W01"].check(sctx({ reads: { gsc: read([{ query: "physio auckland" }]) } })).ok).toBe(true);
  });

  it("Campaign calendar produces from the profile (goal + plan enrich it)", () => {
    const c = SKILL_BY_ID["D05-W07"].check(sctx({ profile: SERVICES_PROFILE, goal: { title: "NZ$40,000 MRR", deadline: "2026-12-31", baseline: 28000, currency: "NZD" }, plan: [{ title: "Content first" }] }));
    expect(c).toEqual({ ok: true, using: ["site profile", "goal “NZ$40,000 MRR”", "the plan"] });
  });

  it("Social repurposing asks for a post when no social read has rows", () => {
    const c = SKILL_BY_ID["D01-W05"].check(base);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.needs[0].input).toBe("source_post");
    expect(SKILL_BY_ID["D01-W05"].check(sctx({ inputs: { source_post: "Our Saturday clinic is open" } })).ok).toBe(true);
    expect(SKILL_BY_ID["D01-W05"].check(sctx({ reads: { ig: read([{ caption: "x", saves: 40 }]) } }))).toEqual({ ok: true, using: ["1 Instagram posts"] });
  });

  it("Abandoned cart is not applicable without a store; with carts it produces", () => {
    const c = SKILL_BY_ID["D05-W02"].check(base);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.needs[0].platform).toBe("shopify");
    const none = SKILL_BY_ID["D05-W02"].check(sctx({ reads: { checkouts: read([]) } }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.note).toBe("Nothing to recover this week.");
    expect(SKILL_BY_ID["D05-W02"].check(sctx({ reads: { checkouts: read([{ id: 1 }, { id: 2 }]), perf: read([]) } }))).toEqual({ ok: true, using: ["2 abandoned checkouts", "flow numbers"] });
  });
});

describe("the sales skills ask for what they need", () => {
  it("Lead research asks for a target description (no scraping of people), scores real leads when present", () => {
    const c = SKILL_BY_ID["D04-W01"].check(sctx({ profile: SERVICES_PROFILE }));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.needs[0].input).toBe("target_description");
    expect(SKILL_BY_ID["D04-W01"].check(sctx({ profile: SERVICES_PROFILE, inputs: { target_description: "Gym owners in Auckland" }, reads: { leads: read([{ company: "Gym A" }]) } }))).toEqual({ ok: true, using: ["site profile", "1 new leads", "your target description"] });
  });

  it("Outbound drafts need a lead brief artifact (or a pasted brief)", () => {
    const none = SKILL_BY_ID["D04-W02"].check(sctx({ reads: { leads: read([{ firstname: "Ana" }]) } }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.needs[0].input).toBe("lead_brief");
    const withBrief = SKILL_BY_ID["D04-W02"].check(sctx({ priorArtifacts: [{ id: "a1", kind: "lead_brief", routineId: "D04-W01", title: "Lead brief: gym owners", body: "…", createdAt: "2026-09-02T00:00:00Z", status: "approved" }] }));
    expect(withBrief).toEqual({ ok: true, using: ["lead brief “Lead brief: gym owners”"] });
  });

  it("Meeting brief needs a meeting from a calendar/HubSpot or the founder", () => {
    const none = SKILL_BY_ID["D04-W03"].check(sctx({ reads: { meetings: read([], "unavailable") } }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.needs.map((n) => n.platform ?? n.input)).toEqual(["hubspot", "meeting"]);
    expect(SKILL_BY_ID["D04-W03"].check(sctx({ inputs: { meeting: "Sam at Gym A, 2pm" } })).ok).toBe(true);
    expect(SKILL_BY_ID["D04-W03"].check(sctx({ reads: { meetings: read([{ title: "Intro" }]), contacts: read([{ company: "Gym A" }]) } }))).toEqual({ ok: true, using: ["1 meetings", "CRM records"] });
  });
});
