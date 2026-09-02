import { describe, expect, it } from "vitest";
import { ALL_SYSTEMS } from "../../platform/catalog";
import { CATALOG_SPECS, CATALOG_SPEC_BY_ID, WAVE_1_IDS } from "../catalog-specs";
import { runRoutine } from "../engine";
import { validateSpec } from "../validate";
import { adapters, input } from "./helpers";

const LAUNCH_WAVE = [
  "Founder content engine",
  "Customer-question mining",
  "Social repurposing",
  "Keyword opportunity scan",
  "Content gap analysis",
  "Lead research & scoring",
  "Supervised outbound drafts",
  "Meeting brief builder",
  "Abandoned cart recovery",
  "Campaign calendar prep",
];

describe("catalog specs", () => {
  it("covers every one of the 35 catalog routines exactly once, with matching names", () => {
    expect(CATALOG_SPECS).toHaveLength(35);
    expect(ALL_SYSTEMS).toHaveLength(35);
    for (const sys of ALL_SYSTEMS) {
      const spec = CATALOG_SPEC_BY_ID[sys.id];
      expect(spec, `missing spec for ${sys.id}`).toBeDefined();
      expect(spec.name).toBe(sys.name);
      expect(spec.version).toBe(1);
    }
  });

  it.each(CATALOG_SPECS.map((s) => [s.id, s.name, s] as const))("%s %s validates", (_id, _name, spec) => {
    expect(validateSpec(spec)).toEqual([]);
  });

  it("node order is trigger → read → check → decide → gate → (execute) → receipt for every spec", () => {
    const order = ["trigger", "read", "check", "decide", "gate", "execute", "receipt"];
    for (const spec of CATALOG_SPECS) {
      const kinds = spec.nodes.map((n) => n.kind);
      expect(kinds[0]).toBe("trigger");
      expect(kinds.at(-1)).toBe("receipt");
      const ranks = kinds.map((k) => order.indexOf(k));
      for (let i = 1; i < ranks.length; i++) expect(ranks[i], `${spec.id} ${kinds[i]} after ${kinds[i - 1]}`).toBeGreaterThanOrEqual(ranks[i - 1]);
      expect(kinds.filter((k) => k === "read").length, `${spec.id} has reads`).toBeGreaterThanOrEqual(1);
      expect(kinds).toContain("gate");
    }
  });

  it("wave 1 is exactly the launch-wave list and is draft-only", () => {
    const wave1Names = WAVE_1_IDS.map((id) => CATALOG_SPEC_BY_ID[id].name).sort();
    expect(wave1Names).toEqual([...LAUNCH_WAVE].sort());
    for (const id of WAVE_1_IDS) {
      const spec = CATALOG_SPEC_BY_ID[id];
      expect(spec.mutates, `${id} must not mutate`).toBe(false);
      expect(spec.nodes.some((n) => n.kind === "execute"), `${id} must have no execute node`).toBe(false);
    }
  });

  it("mutates ⇔ has execute, and every execute sits behind a gate", () => {
    for (const spec of CATALOG_SPECS) {
      const execIdx = spec.nodes.findIndex((n) => n.kind === "execute");
      const gateIdx = spec.nodes.findIndex((n) => n.kind === "gate");
      expect(spec.mutates, `${spec.id} mutates flag`).toBe(execIdx >= 0);
      if (execIdx >= 0) {
        expect(gateIdx, `${spec.id} gate index`).toBeGreaterThanOrEqual(0);
        expect(gateIdx, `${spec.id} gate before execute`).toBeLessThan(execIdx);
        expect(spec.wave).toBe(2);
      }
    }
  });

  it("classifies the expected mutation routines", () => {
    const mutating = CATALOG_SPECS.filter((s) => s.mutates).map((s) => s.id).sort();
    expect(mutating).toEqual(["D02-W01", "D02-W02", "D02-W03", "D02-W04", "D02-W07", "D02-W08", "D03-W04", "D04-W05", "D04-W06", "D05-W01", "D05-W03", "D05-W05", "D05-W06"]);
  });

  it("every spec dry-runs against empty demo data without an incident", async () => {
    for (const spec of CATALOG_SPECS) {
      const { adapters: a, executor } = adapters();
      const res = await runRoutine(spec, input({ vars: { niche: "golf", hashtags: ["#golf"], region: "NZ", competitorDomains: ["x.com"], buyerPrompts: ["best golf skort"], website: "example.com" } }), a, { mode: "dry_run" });
      expect(["done", "skipped"], `${spec.id} ${res.status}: ${res.error ?? ""}`).toContain(res.status);
      expect(executor.calls).toHaveLength(0);
      expect(res.receipts.every((r) => r.kind !== "mutation")).toBe(true);
    }
  });

  it("every spec dry-runs to done when its checks are satisfied", async () => {
    // Fixtures generous enough to satisfy every check: rows for count-based checks, metrics for the rest.
    const rows = Array.from({ length: 60 }, (_, i) => ({ i }));
    const metrics = {
      spend: 500, reconciliation_pct: 100, top_adset_roas: 3, top_adset_daily_budget: 50, active_tests: 0,
      fatigued_count: 2, worst_frequency: 5, worst_cpa_vs_target_pct: 60, worst_spend: 120,
      projected_daily_spend: 999, daily_budget_total: 999,
      top_post_reach: 9000, top_post_like_rate_pct: 2.5, conversions: 3,
      missing_meta_count: 3, worst_page_impressions: 500, biggest_drop: -5, biggest_gain: 4, movers_count: 3,
      stale_over_30d_count: 4, stale_over_30d_amount: 12000,
      sends: 800, weakest_ctor_pct: 5, drift_pct: 20, drifted_count: 3, covers_top_product: false,
      peak_day: 9, peak_day_delta: 3, mentioned_pct: 40,
    };
    const fixtures = Object.fromEntries(
      ["shopify", "ga4", "meta_ads", "google_ads", "klaviyo", "instagram", "tiktok", "linkedin", "youtube", "search_console", "hubspot", "gmail", "gorgias", "web", "llm_search", "calendar"].flatMap((p) =>
        ["orders", "products", "customers", "checkouts", "pages", "report", "insights", "ads", "campaigns", "flows", "metrics", "segments", "media", "hashtag_search", "videos", "trends", "posts", "search_analytics", "contacts", "deals", "threads", "tickets", "crawl", "scan", "prompts", "events"].map((r) => [`${p}:${r}`, { rows, metrics }]),
      ),
    );
    for (const spec of CATALOG_SPECS) {
      const { adapters: a, executor } = adapters({ fixtures });
      const res = await runRoutine(spec, input(), a, { mode: "dry_run" });
      expect(res.status, `${spec.id}: ${res.summary}`).toBe("done");
      expect(executor.calls).toHaveLength(0);
      const gate = res.receipts.find((r) => r.description.startsWith("Would ask"));
      expect(gate, `${spec.id} reached its gate`).toBeDefined();
      if (spec.mutates) expect(res.receipts.some((r) => r.description.startsWith("Would ")), `${spec.id} previewed its mutation`).toBe(true);
    }
  });
});
