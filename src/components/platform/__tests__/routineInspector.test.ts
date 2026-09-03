/* The inspector renders in accounts mode (the "Adjust this routine" panel with industry lines,
   toggle rows and the draft strip) and never in demo mode (the prototype's param editor stays);
   "How I read your market" on Home shows the brief and nothing when there is none.
   react-dom/server — no DOM, no fetch. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { derive, type DeriveOptions } from "@/lib/platform/derive";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import { accountInitialState, initialState, type PlatformState } from "@/lib/platform/state";
import type { RoutinesStateListing, RoutineStateView } from "@/lib/runtime/routinesState";
import type { NicheBrief } from "@/lib/brain/nicheBrief";
import { resolvePreset } from "@/lib/runtime/presets/industry";
import { optionalSteps, relevantFields } from "@/lib/runtime/presets/routines";
import { catalogSpec } from "@/lib/runtime/catalog-specs";
import HomeView from "../HomeView";
import MarketRead, { MARKET_READ_TITLE } from "../MarketRead";
import RoutineDetail from "../RoutineDetail";
import RoutineInspector, { INSPECTOR_TITLE, NO_BAND_LINE, type ParamsView } from "../RoutineInspector";

const noop = () => {};
const NOW = new Date("2026-09-03T09:00:00.000Z");
const ACCOUNT: DeriveOptions = { mode: "account", now: NOW };
const dv = (S: PlatformState, opts?: DeriveOptions) => derive(S, noop, undefined, undefined, opts);
const acctRun = { accountId: "00000000-0000-4000-8000-00000000acc1", account: { currency: "NZD", budgetMonthly: 1200 }, persisted: true };
const demoRun = { accountId: "demo", account: { currency: "NZD", budgetMonthly: 3000 }, persisted: false };
const base: PlatformState = { ...accountInitialState("NZD"), onboarded: true, view: "systems", goalTitle: "NZ$50,000 MRR", targetNum: 50000, deadline: "2026-12-31", budgetMo: 1200, hoursWk: 5 };
const listingOff = (): RoutinesStateListing => ({
  routines: ALL_SYSTEMS.map<RoutineStateView>((sys) => ({ routineId: sys.id, name: sys.name, category: sys.cat, wave: 1, enabled: false, version: 1, availability: "draft_only" as RoutineStateView["availability"], availabilityCopy: "draft-only for now", canEnable: true, betterWith: [], betterWithCopy: null, recommended: false, lastRun: null, lastDraft: null, skillSource: "builtin" })),
  recommendedFirst: [],
  planChannel: null,
  business: { businessType: "ecommerce", sells: "products", storefront: "shopify" },
  connected: [],
});

function view(routineId: string, over: Partial<ParamsView> = {}): ParamsView {
  const set = resolvePreset({ businessType: "ecommerce", category: "supplements", currency: "NZD", aov: 100, grossMarginPct: 60, budgetMonthly: 3000 }, routineId.startsWith("D02") ? "paid" : "content", { routine: { roasFloor: 3 }, routineSource: "founder" });
  const rel = new Set(relevantFields(routineId));
  return {
    routineId,
    domain: set.domain,
    currency: "NZD",
    band: set.band,
    fields: set.fields.map((f) => ({ ...f, relevant: rel.has(f.key), bound: f.key === "roasFloor" })),
    steps: optionalSteps(catalogSpec(routineId)).map((s) => ({ ...s, included: s.id !== "read_posts" })),
    version: { live: 1, draft: null },
    canPromote: false,
    ...over,
  };
}

describe("RoutineInspector", () => {
  it("accounts: the band line, only the relevant fields, industry lines with the founder's value, a toggle row per optional step", () => {
    const html = renderToStaticMarkup(createElement(RoutineInspector, { routineId: "D02-W01", currency: "NZD", initial: view("D02-W01") }));
    expect(html).toContain(INSPECTOR_TITLE);
    expect(html).toContain("Set for DTC supplements &amp; consumables");
    expect(html).toContain('data-testid="param-roasFloor"');
    expect(html).toContain("Industry: 2×–3× · yours: 3×");
    expect(html).toContain(">yours<");
    expect(html).toContain("Industry: NZ$36–54 · yours: NZ$48");
    expect(html).not.toContain('data-testid="param-fatigueFrequency"'); // not relevant to D02-W01
    expect(html).toContain("v1 live");
    expect(html).not.toContain('data-testid="inspector-draft"');
    const content = renderToStaticMarkup(createElement(RoutineInspector, { routineId: "D01-W01", currency: "NZD", initial: view("D01-W01") }));
    expect(content).toContain("Include: gorgias tickets · 7d");
    expect(content).toContain('data-testid="step-read_posts"');
    expect(content).toMatch(/data-testid="step-read_questions"[^>]*>\s*<input type="checkbox" checked=""/);
    expect(content).toMatch(/data-testid="step-read_posts"[^>]*>\s*<input type="checkbox"\/>/);
  });

  it("unknown band → the honest line; a draft → the validate / promote strip (promote only once a dry run passed)", () => {
    const unknown = view("D02-W01", { band: null, version: { live: 1, draft: 2 } });
    let html = renderToStaticMarkup(createElement(RoutineInspector, { routineId: "D02-W01", currency: "NZD", initial: unknown }));
    expect(html).toContain(NO_BAND_LINE);
    expect(html).toContain('data-testid="inspector-draft"');
    expect(html).toContain("Run dry-run validation");
    expect(html).not.toContain("Promote to production");
    html = renderToStaticMarkup(createElement(RoutineInspector, { routineId: "D02-W01", currency: "NZD", initial: view("D02-W01", { version: { live: 1, draft: 2 }, canPromote: true }) }));
    expect(html).toContain("Promote to production");
    expect(html).toContain("v1 live · v2 draft");
  });

  it("loading state without a view", () => {
    const html = renderToStaticMarkup(createElement(RoutineInspector, { routineId: "D02-W01", currency: "NZD" }));
    expect(html).toContain("Reading the settings…");
  });
});

describe("RoutineDetail mounts it in accounts mode only", () => {
  it("accounts: the inspector is on the page and the prototype's param editor is not", () => {
    const sel = ALL_SYSTEMS.find((s) => s.id === "D02-W01")!;
    const live = { active: true, loading: false, data: listingOff(), error: null, refresh: noop, patch: noop };
    const html = renderToStaticMarkup(createElement(RoutineDetail, { V: dv({ ...base, sel }, ACCOUNT), run: acctRun, live, inspectorInitial: view("D02-W01") }));
    expect(html).toContain('data-testid="routine-inspector"');
    expect(html).toContain(INSPECTOR_TITLE);
    expect(html).not.toContain("Run dry-run validation"); // no draft yet
    expect(html).not.toContain("v12 · active");
  });

  it("demo: unchanged — the prototype's inspector, no accounts panel", () => {
    const sel = ALL_SYSTEMS.find((s) => s.id === "D02-W01")!;
    const html = renderToStaticMarkup(createElement(RoutineDetail, { V: dv({ ...initialState, onboarded: true, view: "systems", sel }), run: demoRun }));
    expect(html).not.toContain('data-testid="routine-inspector"');
    expect(html).not.toContain(INSPECTOR_TITLE);
    expect(html).toContain("click a step to inspect and edit it");
  });
});

const brief: NicheBrief = {
  categoryBand: "dtc_supplements",
  bandWhy: "a store selling supplements — repeat purchase sets the economics",
  summary: "A replenishment market. The second order pays for the first. I will draft winback at 60 days.",
  buyingTriggers: ["A specific complaint the product is known for"],
  seasonality: [],
  channelsThatWork: ["Email flows carry the repeat order"],
  benchmarks: null,
  avoid: ["Discounting on the first reminder"],
};

describe("How I read your market", () => {
  it("renders the brief open on first sight, with the honest no-benchmarks line", () => {
    const html = renderToStaticMarkup(createElement(MarketRead, { initial: brief }));
    expect(html).toContain(MARKET_READ_TITLE);
    expect(html).toContain("A replenishment market.");
    expect(html).toContain("Band: dtc supplements");
    expect(html).toContain('data-testid="market-read-triggers"');
    expect(html).toContain('data-testid="market-read-no-benchmarks"');
    expect(html).not.toContain('data-testid="market-read-seasonality"');
  });

  it("nothing without a brief; on Home in accounts mode it sits above 'needs you'", () => {
    expect(renderToStaticMarkup(createElement(MarketRead, { initial: null }))).toBe("");
    const S: PlatformState = { ...base, view: "today" };
    const html = renderToStaticMarkup(createElement(HomeView, { V: dv(S, ACCOUNT), accountMode: true, live: null, telemetry: null, setup: null, briefInitial: null, artifactsInitial: [], marketReadInitial: brief }));
    expect(html).toContain('data-testid="market-read"');
    expect(html.indexOf('data-testid="market-read"')).toBeLessThan(html.indexOf('id="needs-you"'));
    const none = renderToStaticMarkup(createElement(HomeView, { V: dv(S, ACCOUNT), accountMode: true, live: null, telemetry: null, setup: null, briefInitial: null, artifactsInitial: [], marketReadInitial: null }));
    expect(none).not.toContain('data-testid="market-read"');
  });
});
