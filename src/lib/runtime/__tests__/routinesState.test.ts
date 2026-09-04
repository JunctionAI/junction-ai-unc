/* Routines state (GET/POST /api/routines/state): availability from the spec's REQUIRED reads
   (+ the skill minimum's platforms) vs the connected platforms — optional reads only ever add a
   "Better with …" hint — the listing (enabled, version, last run, last draft, recommended-first from the
   plan) on MemoryStore + the schema-checked fake, and switching a routine on. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import {
  availabilityCopy,
  betterWith,
  betterWithCopy,
  canEnable,
  helpfulPlatforms,
  readPlatforms,
  requiredPlatforms,
  routineAvailability,
  STORE_ONLY_ROUTINES,
  unsupportedRequiredRead,
  unsupportedRequiredReads,
  unavailableRead,
  workerCanRead,
} from "../availability";
import { CATALOG_SPEC_BY_ID, CATALOG_SPECS, WAVE_1_IDS } from "../catalog-specs";
import { recommendedFirstFrom, routinesStateForAccount, setRoutineEnabled } from "../routinesState";
import { MemoryStore } from "../store/memory";
import { runRoutine } from "../engine";
import { adapters, input } from "./helpers";

const ACCT = "00000000-0000-4000-8000-00000000acc1";

describe("availability", () => {
  it("names the read platforms that have a card, in chain order, once each", () => {
    expect(readPlatforms(CATALOG_SPEC_BY_ID["D05-W02"])).toEqual(["shopify", "klaviyo"]);
    expect(readPlatforms(CATALOG_SPEC_BY_ID["D01-W01"])).toEqual(["gorgias", "linkedin", "shopify"]);
    // research sources (web, llm_search, calendar) never gate a routine: D03-W03 reads llm_search + shopify
    expect(readPlatforms(CATALOG_SPEC_BY_ID["D03-W03"])).toEqual(["shopify"]);
  });

  it("splits the card platforms into what gates (required reads + the minimum's platforms) and what helps (optional reads + the minimum's helpful)", () => {
    // D01-W01: every read optional, minimum names no platform ⇒ nothing gates, three help
    expect(requiredPlatforms(CATALOG_SPEC_BY_ID["D01-W01"])).toEqual([]);
    expect(helpfulPlatforms(CATALOG_SPEC_BY_ID["D01-W01"])).toEqual(["shopify"]);
    // D05-W02: the checkouts read is required (and the minimum says shopify); Klaviyo is optional
    expect(requiredPlatforms(CATALOG_SPEC_BY_ID["D05-W02"])).toEqual(["shopify"]);
    expect(helpfulPlatforms(CATALOG_SPEC_BY_ID["D05-W02"])).toEqual(["klaviyo"]);
    // AI search visibility now drafts from buyer prompts + the site: shopify is helpful, not a gate
    expect(requiredPlatforms(CATALOG_SPEC_BY_ID["D03-W03"])).toEqual([]);
    expect(helpfulPlatforms(CATALOG_SPEC_BY_ID["D03-W03"])).toEqual(["shopify"]);
  });

  it("approval_gated for a connected mutator, needs_connector for a missing supported read, ready / draft_only otherwise", () => {
    // D02-W01's endpoint exists, but its spec still asks Meta insights for daily_budget — a
    // field the live reader explicitly drops. Connecting Shopify cannot make that contract ready.
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W01"], ["meta_ads"])).toBe("unavailable:meta_ads:insights:field.daily_budget");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W01"], ["meta_ads", "shopify"])).toBe("unavailable:meta_ads:insights:field.daily_budget");
    expect(betterWith(CATALOG_SPEC_BY_ID["D02-W01"], ["meta_ads", "shopify"])).toEqual([]);
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W04"], ["meta_ads"])).toBe("unavailable:meta_ads:insights:field.cpa_trend");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W04"], [])).toBe("unavailable:meta_ads:insights:field.cpa_trend");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W02"], [])).toBe("needs_connector:shopify");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify"])).toBe("ready"); // Klaviyo is optional — a hint, not a block
    expect(betterWith(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify"])).toEqual(["klaviyo"]);
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify", "klaviyo"])).toBe("ready");
    expect(betterWith(CATALOG_SPEC_BY_ID["D05-W02"], ["shopify", "klaviyo"])).toEqual([]);
    // the founder content engine reads nothing it must have: ready with nothing connected
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D01-W01"], [])).toBe("ready");
    // Unsupported optional reads do not block the draft, but connecting them cannot be advertised
    // as an improvement until the production worker has a reader.
    expect(betterWith(CATALOG_SPEC_BY_ID["D01-W01"], [])).toEqual(["shopify"]);
    expect(betterWith(CATALOG_SPEC_BY_ID["D01-W01"], ["shopify"])).toEqual([]);
    expect(betterWithCopy(["gorgias", "linkedin"])).toBe("Better with Gorgias, LinkedIn connected");
    expect(betterWithCopy([])).toBeNull();
    // no hint under a block — a blocked routine never reads as doubly blocked
    expect(betterWith(CATALOG_SPEC_BY_ID["D05-W02"], [])).toEqual([]);
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D03-W03"], [])).toBe("draft_only");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D03-W03"], ["shopify"])).toBe("draft_only");
    expect(betterWith(CATALOG_SPEC_BY_ID["D03-W03"], [])).toEqual(["shopify"]);
    expect(availabilityCopy("needs_connector:klaviyo")).toBe("needs Klaviyo connected");
    expect(availabilityCopy("draft_only")).toBe("draft-only for now");
    expect(availabilityCopy("ready")).toBe("drafts only — nothing goes out without you");
    expect(canEnable("approval_gated")).toBe(true);
    expect(canEnable("needs_connector:shopify")).toBe(false);
    expect(canEnable("ready")).toBe(true);
    expect(availabilityCopy("approval_gated")).toBe("I'll prepare the exact change and wait for you");
    // every wave-1 routine with all its cards connected is ready; no wave-1 routine is approval_gated
    const all = [...new Set(CATALOG_SPECS.flatMap(readPlatforms))];
    for (const id of WAVE_1_IDS) expect(routineAvailability(CATALOG_SPEC_BY_ID[id], all)).toBe("ready");
  });

  it("fails closed when a required platform/resource has no production reader", () => {
    expect(workerCanRead("shopify", "orders")).toBe(true);
    expect(workerCanRead("shopify", "inventory")).toBe(false);
    expect(workerCanRead("google_ads", "campaigns")).toBe(false); // fixture-only is not account readiness

    expect(unsupportedRequiredRead(CATALOG_SPEC_BY_ID["D03-W04"])).toEqual({ platform: "search_console", resource: "search_analytics" });
    expect(unsupportedRequiredRead(CATALOG_SPEC_BY_ID["D03-W06"])).toBeNull(); // crawl is optional; the skill labels profile-only work as hypothesis
    expect(unsupportedRequiredRead(CATALOG_SPEC_BY_ID["D04-W04"])).toBeNull(); // member can paste stale deals; Gmail/HubSpot only enrich the draft
    expect(unsupportedRequiredRead(CATALOG_SPEC_BY_ID["D05-W05"])).toEqual({ platform: "gorgias", resource: "tickets" });
    expect(unsupportedRequiredRead(CATALOG_SPEC_BY_ID["D04-W02"])).toBeNull(); // Gmail is optional for this handoff-only draft
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D04-W02"], [])).toBe("ready");

    expect(routineAvailability(CATALOG_SPEC_BY_ID["D03-W04"], ["search_console", "shopify"])).toBe("unavailable:search_console:search_analytics");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D03-W06"], ["search_console"])).toBe("draft_only");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D04-W04"], ["hubspot", "gmail"])).toBe("draft_only");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D05-W05"], ["shopify", "klaviyo", "gorgias"])).toBe("unavailable:gorgias:tickets");
    expect(canEnable("unavailable:gmail:threads")).toBe(false);
    expect(unavailableRead("unavailable:gmail:threads")).toEqual({ platform: "gmail", resource: "threads" });
    expect(availabilityCopy("unavailable:search_console:search_analytics")).toBe("Google Search Console search analytics reader isn't available yet");
  });

  it("checks the exact Meta reader contract, including filters, requested fields and derived metrics", () => {
    const gaps = (id: string) => unsupportedRequiredReads(CATALOG_SPEC_BY_ID[id]).filter((g) => g.platform === "meta_ads").map((g) => `${g.resource}:${g.contract}`);

    expect(gaps("D02-W02")).toEqual(expect.arrayContaining(["ads:filter.tag", "ads:field.creative_id", "insights:metric.active_tests"]));
    expect(gaps("D02-W03")).toEqual(expect.arrayContaining(["insights:field.ctr_trend", "insights:field.days_live", "insights:metric.fatigued_count", "ads:filter.tag"]));
    expect(gaps("D02-W04")).toEqual(expect.arrayContaining(["insights:field.cpa_trend", "insights:metric.worst_cpa_vs_target_pct"]));
    expect(gaps("D02-W06")).toEqual([]); // optional history enriches a profile-grounded hypothesis matrix
    expect(gaps("D02-W07")).toContain("insights:field.daily_budget_total");

    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W02"], ["meta_ads"])).toBe("unavailable:meta_ads:insights:metric.active_tests");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W03"], ["meta_ads"])).toBe("unavailable:meta_ads:insights:field.ctr_trend");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W04"], ["meta_ads"])).toBe("unavailable:meta_ads:insights:field.cpa_trend");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W06"], ["meta_ads", "instagram"])).toBe("draft_only");
    expect(routineAvailability(CATALOG_SPEC_BY_ID["D02-W07"], ["meta_ads", "google_ads"])).toBe("unavailable:meta_ads:insights:field.daily_budget_total");
    expect(availabilityCopy("unavailable:meta_ads:insights:metric.active_tests")).toBe("Meta Ads insights reader isn't ready — missing metric active tests");
    expect(canEnable("unavailable:meta_ads:insights:field.hook")).toBe(false);
  });

  it("recommended-first = the plan's phase-1 routines that are launch-wave, in plan order", () => {
    const phases = [{ n: "1", name: "Organic brand engine", status: "ACTIVE", routines: ["Founder content engine", "Social repurposing", "Customer-question mining", "Ghost routine"], from_you: "" }, { n: "2", routines: ["Winback campaign prep"] }];
    expect(recommendedFirstFrom(phases)).toEqual(["D01-W01", "D01-W05", "D01-W03"]);
    expect(recommendedFirstFrom(null)).toEqual([]);
    expect(recommendedFirstFrom([{ routines: ["Daily paid decisioning"] }])).toEqual([]); // wave 2 — never "first"
  });
});

describe("routinesStateForAccount", () => {
  function seeded() {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Example", currency: "NZD" }]);
    db.seed("connectors", [
      { account_id: ACCT, platform: "shopify", status: "connected", last_sync_result: "ok" },
      { account_id: ACCT, platform: "klaviyo", status: "connected", last_sync_result: "ok" },
      { account_id: ACCT, platform: "meta_ads", status: "needs_reconnect" },
    ]);
    db.seed("plans", [
      { account_id: ACCT, title: "Brand-led organic", phases: [{ n: "1", routines: ["Abandoned cart recovery", "Founder content engine"] }], created_at: "2026-09-01T00:00:00.000Z" },
      { account_id: ACCT, title: "Old plan", phases: [{ n: "1", routines: ["Lead research & scoring"] }], created_at: "2026-08-01T00:00:00.000Z" },
    ]);
    return db;
  }

  it("every catalog routine, real enabled/version, honest availability, the plan's recommendations, no store call per routine", async () => {
    const db = seeded();
    const store = new MemoryStore();
    const listing = await routinesStateForAccount({ store, db }, ACCT);
    expect(listing.routines).toHaveLength(CATALOG_SPECS.length);
    expect(listing.connected).toEqual(["shopify", "klaviyo"]);
    expect(listing.recommendedFirst).toEqual(["D05-W02", "D01-W01"]);
    expect(listing.planChannel).toBe("Email & SMS");
    const ac = listing.routines.find((r) => r.routineId === "D05-W02")!;
    expect(ac).toMatchObject({ name: "Abandoned cart recovery", category: "Email & SMS", wave: 1, enabled: false, version: 1, availability: "ready", canEnable: true, recommended: true, lastRun: null, lastDraft: null });
    expect(listing.routines.find((r) => r.routineId === "D02-W01")).toMatchObject({ availability: "unavailable:meta_ads:insights:field.daily_budget", canEnable: false, recommended: false });
    // optional unsupported reads never block and are never advertised as connectable improvements
    expect(listing.routines.find((r) => r.routineId === "D01-W01")).toMatchObject({ availability: "ready", availabilityCopy: "drafts only — nothing goes out without you", canEnable: true, betterWith: [], betterWithCopy: null, recommended: true });
    expect(ac.betterWith).toEqual([]);
    expect(ac.betterWithCopy).toBeNull();
    // demo/no DB: nothing connected, no plan
    const demo = await routinesStateForAccount({ store, db: null }, "demo");
    expect(demo.connected).toEqual([]);
    expect(demo.recommendedFirst).toEqual([]);
    expect(demo.planChannel).toBeNull();
  });

  it("a connected row with no real sync does not unlock routines", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Example", currency: "NZD" }]);
    db.seed("connectors", [{ account_id: ACCT, platform: "shopify", status: "connected", last_sync_result: null }]);
    const listing = await routinesStateForAccount({ store: new MemoryStore(), db }, ACCT);
    expect(listing.connected).toEqual([]);
    expect(listing.routines.find((r) => r.routineId === "D05-W02")!.availability).toBe("needs_connector:shopify");
  });

  it("carries the last run and the last draft per routine, and the trail for one", async () => {
    const db = seeded();
    const { adapters: a, store, clk } = adapters();
    const spec = CATALOG_SPEC_BY_ID["D05-W02"];
    const first = await runRoutine(spec, input({ account: { accountId: ACCT, currency: "NZD", budgetMonthly: 3000 }, triggeredBy: "manual" }), a, { mode: "dry_run" });
    clk.advanceHours(1);
    const second = await runRoutine(spec, input({ account: { accountId: ACCT, currency: "NZD", budgetMonthly: 3000 }, triggeredBy: "manual" }), a, { mode: "dry_run" });
    const listing = await routinesStateForAccount({ store, db }, ACCT, { routineId: "D05-W02" });
    const ac = listing.routines.find((r) => r.routineId === "D05-W02")!;
    expect(ac.lastRun).toMatchObject({ id: second.runId, status: second.status, summary: second.summary });
    expect(ac.lastRun!.id).not.toBe(first.runId);
    if (second.receipts.some((r) => r.kind === "draft")) {
      expect(ac.lastDraft).toMatchObject({ runId: second.runId });
      expect(ac.lastDraft!.description).toBe(second.receipts.filter((r) => r.kind === "draft").at(-1)!.description);
    }
    expect(listing.lastRunReceipts!.map((r) => r.id)).toEqual(second.receipts.map((r) => r.id));
    expect(listing.routines.find((r) => r.routineId === "D01-W01")!.lastRun).toBeNull();
  });

  it("setRoutineEnabled persists the switch and answers the fresh view", async () => {
    const db = seeded();
    const store = new MemoryStore();
    const on = await setRoutineEnabled({ store, db, now: () => new Date("2026-09-02T09:00:00.000Z") }, ACCT, "D05-W02", true);
    expect(on).toMatchObject({ routineId: "D05-W02", enabled: true, version: 1 });
    expect(await store.getRoutineState(ACCT, "D05-W02")).toMatchObject({ enabled: true, version: 1, updatedAt: "2026-09-02T09:00:00.000Z" });
    expect((await store.listRoutineStates(ACCT)).map((s) => s.routineId)).toEqual(["D05-W02"]);
    const off = await setRoutineEnabled({ store, db }, ACCT, "D05-W02", false);
    expect(off.enabled).toBe(false);
    await expect(setRoutineEnabled({ store, db }, ACCT, "D99-W99", true)).rejects.toThrow(/not in the catalog/);
  });
});

describe("routinesStateForAccount — business type", () => {
  const ACCT2 = "00000000-0000-4000-8000-00000000acc2";
  function services() {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT2, name: "Studio North", currency: "NZD" }]);
    db.seed("connectors", [
      { account_id: ACCT2, platform: "shopify", status: "connected", last_sync_result: "ok" },
      { account_id: ACCT2, platform: "klaviyo", status: "connected", last_sync_result: "ok" },
      { account_id: ACCT2, platform: "hubspot", status: "connected", last_sync_result: "ok" },
    ]);
    db.seed("plans", [{ account_id: ACCT2, title: "Retention", phases: [{ n: "1", routines: ["Abandoned cart recovery", "Winback campaign prep", "Founder content engine"] }], created_at: "2026-09-01T00:00:00.000Z" }]);
    db.seed("business_profiles", [{ account_id: ACCT2, scan_status: "done", profile: { name: "Studio North", businessType: "services", sells: "services", storefront: "none" } }]);
    return db;
  }

  it("a services firm: store-only routines read 'For stores — not your model', can't be switched on, are never recommended — even with Shopify connected", async () => {
    const listing = await routinesStateForAccount({ store: new MemoryStore(), db: services() }, ACCT2);
    expect(listing.business).toEqual({ businessType: "services", sells: "services", storefront: "none" });
    const cart = listing.routines.find((r) => r.routineId === "D05-W02")!;
    expect(cart).toMatchObject({ availability: "not_for_business_type", availabilityCopy: "For stores — not your model", canEnable: false, recommended: false });
    expect(listing.routines.find((r) => r.routineId === "D05-W04")).toMatchObject({ availability: "not_for_business_type", recommended: false });
    expect(listing.recommendedFirst).toEqual(["D01-W01"]);
    expect(listing.planChannel).toBe("Content");
    // the rest of the library is untouched
    expect(listing.routines.find((r) => r.routineId === "D04-W01")).toMatchObject({ availability: "ready", canEnable: true });
    expect(listing.routines.filter((r) => r.availability === "not_for_business_type").map((r) => r.routineId)).toEqual(Object.keys(STORE_ONLY_ROUTINES));
  });

  it("no business profile (nothing scanned, nothing said): nothing is hidden", async () => {
    const listing = await routinesStateForAccount({ store: new MemoryStore(), db: (() => {
      const db = services();
      db.rows("business_profiles").splice(0);
      return db;
    })() }, ACCT2);
    expect(listing.business).toEqual({ businessType: null, sells: null, storefront: null });
    expect(listing.routines.find((r) => r.routineId === "D05-W02")).toMatchObject({ availability: "ready", recommended: true });
    expect(listing.recommendedFirst).toEqual(["D05-W02", "D01-W01"]);
  });
});
