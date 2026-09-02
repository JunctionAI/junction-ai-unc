/* The intake contract — what parseIntakePayload accepts, caps, warns about and rejects. */

import { describe, expect, it } from "vitest";
import { normalisePlatform, parseIntakePayload } from "../schema";

const ok = (raw: unknown) => {
  const r = parseIntakePayload(raw);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r;
};
const bad = (raw: unknown) => {
  const r = parseIntakePayload(raw);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("parseIntakePayload", () => {
  it("accepts the full contract and normalises it", () => {
    const r = ok({
      business: { name: " Acme Co ", website: "https://acme.test", socials: ["@acme", "@acme", "https://tiktok.com/@acme"], category: "Supplements", products: ["Omega", "Zinc"], voice_notes: "plain, no hype", market: "NZ + AU" },
      goal: { title: "NZ$60,000 MRR", baseline: "28,400", deadline: "2026-12-31", currency: "nzd" },
      resources: { budget_monthly: 3600, hours_weekly: 8, team: [{ name: "Ana", role: "Founder" }, "Ben"] },
      platforms: [{ platform: "Shopify", external_ref: "acme.myshopify.com" }, "Meta", { platform: "Google Analytics 4" }],
      contacts: [{ name: "Sam", role: "Ops", email: "SAM@acme.test" }],
      facts: ["Ships from Auckland", "Ships from Auckland"],
      preferences: ["Short replies"],
      constraints: ["Never discount the flagship"],
      events: [{ text: "Black Friday launch", at: "2026-11-27" }, { text: "Trade show" }],
      notes: "Founder is time-poor.",
    });
    expect(r.payload.business).toEqual({ name: "Acme Co", website: "https://acme.test", socials: ["@acme", "https://tiktok.com/@acme"], category: "Supplements", products: ["Omega", "Zinc"], voice_notes: "plain, no hype", market: "NZ + AU" });
    expect(r.payload.goal).toEqual({ title: "NZ$60,000 MRR", baseline: 28400, deadline: "2026-12-31", currency: "NZD" });
    expect(r.payload.resources).toEqual({ budget_monthly: 3600, hours_weekly: 8, team: [{ name: "Ana", role: "Founder" }, { name: "Ben", role: undefined }] });
    expect(r.payload.platforms).toEqual([{ platform: "shopify", external_ref: "acme.myshopify.com" }, { platform: "meta_ads", external_ref: undefined }, { platform: "ga4", external_ref: undefined }]);
    expect(r.payload.contacts).toEqual([{ name: "Sam", role: "Ops", email: "sam@acme.test" }]);
    expect(r.payload.facts).toEqual(["Ships from Auckland"]);
    expect(r.payload.events).toEqual([{ text: "Black Friday launch", at: "2026-11-27" }, { text: "Trade show", at: undefined }]);
    expect(r.payload.notes).toBe("Founder is time-poor.");
    expect(r.warnings).toEqual([]);
  });

  it("every field is optional; a single fact is enough", () => {
    const r = ok({ facts: ["We sell direct only"] });
    expect(Object.keys(r.payload)).toEqual(["facts"]);
  });

  it("unknown top-level fields are dropped with a warning, empty containers vanish", () => {
    const r = ok({ facts: ["x"], foo: 1, business: { name: "" }, contacts: [] });
    expect(r.warnings).toEqual(['ignored unknown field "foo"']);
    expect(r.payload).toEqual({ facts: ["x"] });
  });

  it("newline-separated strings are accepted for list fields (Typeform paragraph answers)", () => {
    const r = ok({ preferences: "Short replies\nNo exclamation marks\n\n" });
    expect(r.payload.preferences).toEqual(["Short replies", "No exclamation marks"]);
  });

  it("rejects the wrong shapes with the field named", () => {
    expect(bad("nope")).toBe("body must be a JSON object");
    expect(bad([])).toBe("body must be a JSON object");
    expect(bad({})).toMatch(/nothing to take in/);
    expect(bad({ business: "Acme" })).toBe("business must be an object");
    expect(bad({ business: { name: 12 } })).toBe("business.name must be a string");
    expect(bad({ goal: { baseline: "lots" } })).toBe("goal.baseline must be a number");
    expect(bad({ goal: { deadline: "next year" } })).toMatch(/goal\.deadline/);
    expect(bad({ goal: { deadline: "2026-02-30" } })).toBe("goal.deadline is not a valid date");
    expect(bad({ goal: { currency: "dollars" } })).toBe("goal.currency must be a 3-letter code");
    expect(bad({ resources: { hours_weekly: 200 } })).toBe("resources.hours_weekly must be 0–168");
    expect(bad({ resources: { budget_monthly: -1 } })).toBe("resources.budget_monthly must be ≥ 0");
    expect(bad({ contacts: [{ name: "Sam", email: "not-an-email" }] })).toBe("contacts[0].email is not an email address");
    expect(bad({ facts: [1] })).toBe("facts[0] must be a string");
    expect(bad({ events: "soon" })).toBe("events must be a list");
  });

  it("caps long strings and long lists (with a warning) instead of failing", () => {
    const r = ok({ facts: Array.from({ length: 150 }, (_, i) => `fact ${i}`), notes: "x".repeat(10_000) });
    expect(r.payload.facts).toHaveLength(100);
    expect(r.warnings).toEqual(["facts: kept the first 100 of 150"]);
    expect(r.payload.notes).toHaveLength(8000);
  });
});

describe("normalisePlatform", () => {
  it("folds the names founders actually type onto connectors.platform slugs", () => {
    expect(normalisePlatform("Shopify")).toBe("shopify");
    expect(normalisePlatform("Meta")).toBe("meta_ads");
    expect(normalisePlatform("Facebook Ads")).toBe("meta_ads");
    expect(normalisePlatform("Google Analytics")).toBe("ga4");
    expect(normalisePlatform("Google Search Console")).toBe("search_console");
    expect(normalisePlatform("Google-Ads")).toBe("google_ads");
    expect(normalisePlatform("TikTok")).toBe("tiktok");
  });
});
