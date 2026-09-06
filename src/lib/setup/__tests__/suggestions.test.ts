/* Platform suggestions come from the founder, not from a table (src/lib/setup/channels.ts):
   picked (known_platforms) first, spotted (the scan's platformsSpotted) second, nothing else;
   the email question; the recommendation by business type. Pure over the catalog. */

import { describe, expect, it } from "vitest";
import { channelReads, emailQuestionNeeded, emailToolFrom, excludedPlatforms, knownPlatformSlugs, recommendationPool, recommendedRoutine, suggestPlatforms, waveOneRoutines } from "../channels";
import { fitsBusiness, routineAvailability, STORE_ONLY_ROUTINES } from "@/lib/runtime/availability";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import type { BusinessModel } from "@/lib/unc/businessType";

const SERVICES: BusinessModel = { businessType: "services", sells: "services", storefront: "none" };
const STORE: BusinessModel = { businessType: "ecommerce", sells: "products", storefront: "shopify" };
const CREATOR: BusinessModel = { businessType: "creator", sells: "mixed", storefront: "none" };
const B2B: BusinessModel = { businessType: "b2b", sells: "products", storefront: "none" };
const UNKNOWN: BusinessModel = { businessType: null, sells: null, storefront: null };

describe("suggestPlatforms — picked, spotted, nothing else", () => {
  it("(a) the founder's picks, in their order, with what phase 1 reads ahead of what it doesn't", () => {
    expect(suggestPlatforms({ channel: "Content", knownPlatforms: ["TikTok", "Klaviyo", "Instagram"] }).map((s) => [s.platform, s.source])).toEqual([
      ["instagram", "picked"],
      ["tiktok", "picked"],
      ["klaviyo", "picked"],
    ]);
  });
  it("(b) what the scan spotted, after the picks, never duplicated, labelled with its evidence", () => {
    const out = suggestPlatforms({ channel: "Email & SMS", knownPlatforms: ["Klaviyo"], spotted: [{ platform: "klaviyo", evidence: "a Klaviyo signup script on the site" }, { platform: "meta_ads", evidence: "a Meta pixel on the site" }] });
    expect(out).toEqual([
      { platform: "klaviyo", name: "Klaviyo", source: "picked" },
      { platform: "meta_ads", name: "Meta Ads", source: "spotted", evidence: "a Meta pixel on the site" },
    ]);
  });
  it("(c) nothing else: no picks, nothing spotted → no cards, for every channel", () => {
    for (const channel of ["Content", "Email & SMS", "Paid ads", "SEO", "Sales"] as const) expect(suggestPlatforms({ channel, knownPlatforms: [] })).toEqual([]);
  });
  it("never Shopify unless the founder picked it or the site runs it", () => {
    expect(suggestPlatforms({ channel: "Email & SMS", knownPlatforms: ["LinkedIn"] }).some((s) => s.platform === "shopify")).toBe(false);
    expect(suggestPlatforms({ channel: "Email & SMS", knownPlatforms: [], spotted: [{ platform: "shopify", evidence: "Shopify storefront scripts on the site" }] }).map((s) => s.source)).toEqual(["spotted"]);
  });
  it("known_platforms → slugs: card names 1:1, Google (Search & Ads) fans out, social-only chips map to nothing", () => {
    expect(knownPlatformSlugs(["Shopify", "Google (Search & Ads)", "Facebook", "X", "Other", "Email / SMS", "Unknown thing"])).toEqual(["shopify", "ga4", "search_console", "google_ads"]);
  });
  it("channelReads comes from the catalog, not a hand table", () => {
    expect(channelReads("Sales")).toEqual(expect.arrayContaining(["hubspot", "gmail"]));
    expect(channelReads("Paid ads")).toContain("meta_ads"); // no wave-1 routine: every paid routine's reads
  });
});

describe("the email question", () => {
  it("only on an Email plan, only when nothing says how email is sent", () => {
    expect(emailQuestionNeeded({ channel: "Content", knownPlatforms: [] })).toBe(false);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: [] })).toBe(true);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: ["Klaviyo"] })).toBe(false);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: ["Mailchimp"] })).toBe(false);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: ["No email tool yet"] })).toBe(false);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: [], spotted: [{ platform: "klaviyo", evidence: "x" }] })).toBe(false);
    expect(emailQuestionNeeded({ channel: "Email & SMS", knownPlatforms: [], connected: ["klaviyo"] })).toBe(false);
  });
  it("the answer is read back from known_platforms; none / Mailchimp keep Klaviyo-reading routines out", () => {
    expect(emailToolFrom(["LinkedIn"])).toBeNull();
    expect(emailToolFrom(["Klaviyo"])).toBe("klaviyo");
    expect(emailToolFrom(["No email tool yet"])).toBe("none");
    expect(excludedPlatforms(["No email tool yet"])).toEqual(["klaviyo"]);
    expect(excludedPlatforms(["Mailchimp"])).toEqual(["klaviyo"]);
    expect(excludedPlatforms(["Klaviyo"])).toEqual([]);
  });
});

describe("recommendation by business type", () => {
  it("a store on an Email plan: Abandoned cart recovery first (as before)", () => {
    expect(recommendedRoutine("Email & SMS", [], { model: STORE })?.id).toBe("D05-W02");
    expect(recommendedRoutine("Email & SMS", [], { model: UNKNOWN })?.id).toBe("D05-W02"); // unknown hides nothing
  });
  it("services / B2B / creator on an Email plan: recommend input-led newsletter drafting without requiring an email provider", () => {
    for (const model of [SERVICES, B2B, CREATOR]) {
      const pool = recommendationPool("Email & SMS", { model, knownPlatforms: ["No email tool yet"] });
      expect(pool.map((s) => s.id)).toEqual(["D05-W08"]);
      expect(pool.some((s) => s.id in STORE_ONLY_ROUTINES)).toBe(false);
      expect(recommendedRoutine("Email & SMS", [], { model, knownPlatforms: ["No email tool yet"] })?.id).toBe("D05-W08");
    }
    expect(waveOneRoutines("Email & SMS", SERVICES).map((s) => s.id)).toEqual(["D05-W08"]);
    expect(waveOneRoutines("Email & SMS", STORE).map((s) => s.id)).toEqual(["D05-W02", "D05-W07", "D05-W08"]);
  });
  it("skips what is on and wraps; the generic pool follows the same rule", () => {
    expect(recommendedRoutine("Content", ["D01-W01"], { model: SERVICES })?.id).toBe("D01-W03");
    expect(recommendedRoutine("Email & SMS", ["D05-W08"], { model: SERVICES, knownPlatforms: ["No email tool yet"] })?.id).toBe("D05-W08");
  });
  it("Sales for a services firm: Lead research & scoring, then Supervised outbound, then Meeting brief", () => {
    expect(waveOneRoutines("Sales", SERVICES).map((s) => s.id)).toEqual(["D04-W01", "D04-W02", "D04-W03"]);
  });
});

describe("availability by business type (src/lib/runtime/availability.ts)", () => {
  it("store-only routines are 'For stores — not your model' for a business with no store; everything else unchanged", () => {
    for (const id of Object.keys(STORE_ONLY_ROUTINES)) {
      expect(routineAvailability(CATALOG_SPEC_BY_ID[id], ["shopify", "klaviyo"], SERVICES)).toBe("not_for_business_type");
      expect(fitsBusiness({ id }, SERVICES)).toBe(false);
      expect(fitsBusiness({ id }, STORE)).toBe(true);
      expect(fitsBusiness({ id }, UNKNOWN)).toBe(true);
      expect(fitsBusiness({ id }, null)).toBe(true);
    }
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D01-W01"], [], SERVICES)).toBe("ready"); // every read optional — a site profile is enough
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D04-W01"], ["hubspot"], SERVICES)).toBe("ready");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify", "klaviyo"], STORE)).toBe("ready");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify", "klaviyo"])).toBe("ready"); // no model given: as before
  });
});
