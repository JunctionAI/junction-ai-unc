/* Industry presets: band resolution per business type (the seven bands + unknown), the money
   derivations, range validation, and the spec bindings (pure — no database). */

import { describe, expect, it } from "vitest";
import { catalogSpec } from "../../catalog-specs";
import type { CheckNode, DecideNode, ReadNode } from "../../types";
import { BAND_IDS, BAND_TABLES, UNKNOWN_MODEL_PARAMS, formatValue, industryLine, paramsOf, pickBand, resolvePreset, type ResolveInput } from "../industry";
import { applyParamsToSpec, boundFields, changesSpec, domainOf, optionalSteps, relevantFields } from "../routines";
import { FIELDS_BY_DOMAIN, PRESET_DOMAINS, crossFieldIssues, validateParams } from "../types";

describe("pickBand — seven bands, one per business shape, and honest unknown", () => {
  const cases: { name: string; input: ResolveInput; band: string | null }[] = [
    { name: "DTC supplements", input: { businessType: "ecommerce", sells: "products", storefront: "shopify", category: "Marine collagen supplements" }, band: "dtc_supplements" },
    { name: "DTC apparel", input: { businessType: "ecommerce", sells: "products", storefront: "shopify", category: "Luxury women's golf apparel" }, band: "dtc_apparel" },
    { name: "a store in an unnamed category still gets the general DTC band", input: { businessType: "ecommerce", category: null }, band: "dtc_apparel" },
    { name: "local services", input: { businessType: "local", sells: "services", storefront: "none", category: "Dental clinic" }, band: "local_services" },
    { name: "B2B services", input: { businessType: "b2b", sells: "products", category: "Wholesale packaging" }, band: "b2b_services" },
    { name: "services / agency", input: { businessType: "services", sells: "services", category: "Design studio" }, band: "b2b_services" },
    { name: "SaaS", input: { businessType: "saas", sells: "subscriptions", category: "Scheduling software" }, band: "saas" },
    { name: "creator", input: { businessType: "creator", sells: "mixed", category: "Golf podcast" }, band: "creator" },
    { name: "fitness / gym (a local business in a fitness category)", input: { businessType: "local", sells: "services", category: "CrossFit gym" }, band: "fitness_gym" },
    { name: "unknown model", input: {}, band: null },
    { name: "other", input: { businessType: "other" }, band: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = pickBand(c.input);
      expect(r.band).toBe(c.band);
      expect(r.why.length).toBeGreaterThan(10);
    });
  }

  it("the niche brief's band wins over the keyword read", () => {
    expect(pickBand({ businessType: "ecommerce", category: "golf apparel", nicheBand: "dtc_supplements" }).band).toBe("dtc_supplements");
  });

  it("every band has every non-money field of every domain, each with provenance", () => {
    for (const domain of PRESET_DOMAINS) {
      for (const band of BAND_IDS) {
        for (const f of FIELDS_BY_DOMAIN[domain]) {
          if (f.kind === "number" && f.unit === "money") continue;
          const c = BAND_TABLES[domain][band][f.key];
          expect(c, `${domain}.${band}.${f.key}`).toBeDefined();
          expect(c.provenance.length).toBeGreaterThan(5);
          if ("low" in c) {
            expect(c.low).toBeLessThanOrEqual(c.value);
            expect(c.value).toBeLessThanOrEqual(c.high);
            if (f.kind === "number") {
              expect(c.low).toBeGreaterThanOrEqual(f.range[0]);
              expect(c.high).toBeLessThanOrEqual(f.range[1]);
            }
          } else if (f.kind === "choice") expect(f.options.some((o) => o.value === c.value)).toBe(true);
        }
        expect(UNKNOWN_MODEL_PARAMS[domain][FIELDS_BY_DOMAIN[domain].find((f) => !(f.kind === "number" && f.unit === "money"))!.key]).toBeDefined();
      }
    }
  });

  it("no fake decimals: every tabled value is a whole number or one decimal place", () => {
    for (const domain of PRESET_DOMAINS)
      for (const band of BAND_IDS)
        for (const c of Object.values(BAND_TABLES[domain][band])) if ("low" in c) for (const n of [c.low, c.high, c.value]) expect(Math.round(n * 10) / 10).toBe(n);
  });
});

describe("resolvePreset — values, sources, money derivations", () => {
  it("a supplements store: playbook-sourced paid numbers, money fields null until AOV and margin are known", () => {
    const set = resolvePreset({ businessType: "ecommerce", category: "supplements", currency: "NZD" }, "paid");
    expect(set.band?.id).toBe("dtc_supplements");
    const p = paramsOf(set);
    expect(p.scaleStepPct).toBe(20);
    expect(p.roasFloor).toBe(2.5);
    expect(p.fatigueFrequency).toBe(4);
    expect(p.targetCpa).toBeNull();
    expect(p.maxCpa).toBeNull();
    expect(p.dailyBudgetCap).toBeNull();
    const t = set.fields.find((f) => f.key === "targetCpa")!;
    expect(t.industry?.provenance).toMatch(/average order value and gross margin/);
    expect(set.fields.find((f) => f.key === "scaleStepPct")!.industry?.provenance).toMatch(/meta-consolidated-structure\.md/);
    expect(set.fields.every((f) => f.source === "industry")).toBe(true);
  });

  it("with AOV, margin and a budget the money fields derive: allowable = AOV × margin, band share of it, cap = budget ÷ 30", () => {
    const set = resolvePreset({ businessType: "ecommerce", category: "supplements", currency: "NZD", aov: 100, grossMarginPct: 60, budgetMonthly: 3000 }, "paid");
    const t = set.fields.find((f) => f.key === "targetCpa")!;
    const m = set.fields.find((f) => f.key === "maxCpa")!;
    // allowable 60; supplements target 60–90% → 36–54, value 80% → 48; max 90–120% → 54–72, value 60
    expect(t.industry).toMatchObject({ low: 36, high: 54, value: 48 });
    expect(m.industry).toMatchObject({ low: 54, high: 72, value: 60 });
    expect(t.industry?.provenance).toMatch(/drop-and-scarcity-paid\.md/);
    const cap = set.fields.find((f) => f.key === "dailyBudgetCap")!;
    expect(cap.value).toBe(100);
    expect(cap.source).toBe("founder");
    expect(industryLine(t, "NZD")).toBe("Industry: NZ$36–54 · yours: NZ$48");
  });

  it("apparel pays less of the allowable than supplements (one-off buys vs replenishment)", () => {
    const sup = paramsOf(resolvePreset({ businessType: "ecommerce", category: "vitamins", aov: 100, grossMarginPct: 50 }, "paid"));
    const app = paramsOf(resolvePreset({ businessType: "ecommerce", category: "apparel", aov: 100, grossMarginPct: 50 }, "paid"));
    expect(app.targetCpa as number).toBeLessThan(sup.targetCpa as number);
    expect(app.roasFloor as number).toBeGreaterThan(sup.roasFloor as number);
  });

  it("unknown model → conservative defaults, band null, why says so", () => {
    const set = resolvePreset({}, "email");
    expect(set.band).toBeNull();
    expect(paramsOf(set)).toMatchObject({ sendCadencePerWeek: 1, discountCeilingPct: 0, winbackWindowDays: 90 });
    const paid = resolvePreset({}, "paid");
    expect(paramsOf(paid).holdDays).toBe(7);
  });

  it("per-band email / content / seo / sales values follow the playbooks", () => {
    expect(paramsOf(resolvePreset({ businessType: "ecommerce", category: "supplements" }, "email"))).toMatchObject({ welcomeFlowLength: 7, winbackWindowDays: 60, sendCadencePerWeek: 3 });
    expect(paramsOf(resolvePreset({ businessType: "b2b" }, "email")).discountCeilingPct).toBe(0);
    expect(paramsOf(resolvePreset({ businessType: "ecommerce", category: "supplements" }, "content"))).toMatchObject({ postsPerWeek: 3, formatsMix: "education_led", hookStyle: "proof" });
    expect(paramsOf(resolvePreset({ businessType: "creator" }, "content")).postsPerWeek).toBe(5);
    expect(paramsOf(resolvePreset({ businessType: "saas" }, "seo")).targetKeywordsPerMonth).toBe(8);
    expect(paramsOf(resolvePreset({ businessType: "local" }, "sales"))).toMatchObject({ followUpCadenceDays: 2 });
    expect(paramsOf(resolvePreset({ businessType: "b2b" }, "sales"))).toMatchObject({ followUpCadenceDays: 3, maxTouches: 5, leadScoreThreshold: 7 });
  });

  it("overrides layer: account over industry, routine over account, each field says which", () => {
    const set = resolvePreset({ businessType: "ecommerce", category: "supplements" }, "paid", { account: { roasFloor: 3, holdDays: 5 }, routine: { holdDays: 2 }, routineSource: "founder" });
    const by = Object.fromEntries(set.fields.map((f) => [f.key, f]));
    expect(by.roasFloor).toMatchObject({ value: 3, source: "founder" });
    expect(by.holdDays).toMatchObject({ value: 2, source: "founder" });
    expect(by.scaleStepPct).toMatchObject({ value: 20, source: "industry" });
    expect(by.roasFloor.industry?.value).toBe(2.5); // the industry side stays visible under a founder value
    expect(industryLine(by.roasFloor, "NZD")).toBe("Industry: 2×–3× · yours: 3×");
  });

  it("formatValue / industryLine cover every unit", () => {
    const set = resolvePreset({ businessType: "ecommerce", category: "supplements", currency: "AUD" }, "content");
    const mix = set.fields.find((f) => f.key === "formatsMix")!;
    expect(formatValue(mix.value, mix, "AUD")).toBe("Education-led");
    expect(industryLine(mix, "AUD")).toBe("Industry: Education-led · yours: Education-led");
    const posts = set.fields.find((f) => f.key === "postsPerWeek")!;
    expect(industryLine(posts, "AUD")).toBe("Industry: 3 per week–5 per week · yours: 3 per week");
    expect(formatValue(null, posts, "AUD")).toBe("not set");
    expect(formatValue(12.5, { kind: "number", unit: "money", options: null }, "AUD")).toBe("A$12.50");
  });
});

describe("validateParams — ranges refused, never clamped", () => {
  it("accepts in-range numbers, coerces numeric strings, keeps null as 'clear'", () => {
    const v = validateParams("paid", { roasFloor: 2.5, holdDays: "4", targetCpa: null });
    expect(v.ok).toBe(true);
    expect(v.params).toEqual({ roasFloor: 2.5, holdDays: 4, targetCpa: null });
  });

  it("refuses out-of-range, non-integer where integer, unknown keys, bad choices", () => {
    const v = validateParams("paid", { roasFloor: 0.5, holdDays: 2.5, scaleStepPct: 90, nope: 1, fatigueFrequency: "abc" });
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.key).sort()).toEqual(["fatigueFrequency", "holdDays", "nope", "roasFloor", "scaleStepPct"]);
    expect(v.issues.find((i) => i.key === "roasFloor")?.message).toMatch(/between 1 and 10/);
    expect(v.params.roasFloor).toBeUndefined(); // nothing clamped in
    const c = validateParams("content", { hookStyle: "shouting", formatsMix: "proof_led" });
    expect(c.ok).toBe(false);
    expect(c.issues[0].key).toBe("hookStyle");
    expect(c.params.formatsMix).toBe("proof_led");
  });

  it("refuses a non-object and flags target above max", () => {
    expect(validateParams("email", "x").ok).toBe(false);
    expect(crossFieldIssues("paid", { targetCpa: 80, maxCpa: 60 })).toHaveLength(1);
    expect(crossFieldIssues("paid", { targetCpa: 40, maxCpa: 60 })).toHaveLength(0);
  });
});

describe("routines — domains, relevant fields, optional steps, bindings", () => {
  it("every catalog routine maps to a domain and shows 3–6 fields", () => {
    for (const cat of ["D01", "D02", "D03", "D04", "D05"]) expect(domainOf(`${cat}-W01`)).not.toBeNull();
    expect(domainOf("D02-W01")).toBe("paid");
    expect(domainOf("D09-W01")).toBeNull();
    for (const id of ["D01-W01", "D02-W01", "D02-W04", "D03-W01", "D04-W04", "D05-W04", "D05-W07"]) {
      const n = relevantFields(id).length;
      expect(n, id).toBeGreaterThanOrEqual(Math.min(3, FIELDS_BY_DOMAIN[domainOf(id)!].length)); // seo has two fields in all
      expect(n, id).toBeLessThanOrEqual(6);
    }
  });

  it("optional steps are the spec's optional reads, labelled for a toggle row", () => {
    const steps = optionalSteps(catalogSpec("D01-W01"));
    expect(steps.map((s) => s.id)).toEqual(["read_questions", "read_posts", "read_products"]);
    expect(steps[0].label).toBe("gorgias tickets · 7d");
    expect(optionalSteps(catalogSpec("D02-W01"))).toEqual([{ id: "read_ga", kind: "read", label: "ga4 report · 7d" }]);
  });

  it("D02-W01: ROAS floor lands on the decide threshold, the scale step on the option's spend + params", () => {
    const spec = catalogSpec("D02-W01");
    expect(boundFields("D02-W01")).toEqual(["roasFloor", "scaleStepPct"]);
    const nodes = applyParamsToSpec(spec, { roasFloor: 3.2, scaleStepPct: 15, holdDays: 4 });
    const decide = nodes.find((n) => n.kind === "decide") as DecideNode;
    expect((decide.rule as { value: unknown }).value).toBe(3.2);
    const opt = decide.options.find((o) => o.id === "scale")!;
    expect((opt.spend as { multiplier: number }).multiplier).toBeCloseTo(0.15);
    expect(opt.params?.changePct).toBe(15);
    // pure: the catalog spec is untouched
    const orig = spec.nodes.find((n) => n.kind === "decide") as DecideNode;
    expect((orig.rule as { value: unknown }).value).toBe(2.5);
    expect(changesSpec(spec, { roasFloor: 2.5, scaleStepPct: 20 })).toBe(false);
    expect(changesSpec(spec, { roasFloor: 3 })).toBe(true);
  });

  it("D02-W04 fatigue frequency + spend floor, D05-W04 winback window, D04-W04 follow-up days bind into the reads / checks", () => {
    const w4 = applyParamsToSpec(catalogSpec("D02-W04"), { fatigueFrequency: 3.5, minSpendBeforeJudging: 80 });
    const tired = w4.find((n) => n.id === "tired_ad") as CheckNode;
    expect((tired.predicate as { all: { value: unknown }[] }).all[0].value).toBe(3.5);
    expect(((w4.find((n) => n.kind === "decide") as DecideNode).rule as { value: unknown }).value).toBe(80);
    const wb = applyParamsToSpec(catalogSpec("D05-W04"), { winbackWindowDays: 60 });
    expect(((wb.find((n) => n.id === "read_lapsed") as ReadNode).query.filter as { lastOrderOlderThanDays: number }).lastOrderOlderThanDays).toBe(60);
    const fu = applyParamsToSpec(catalogSpec("D04-W04"), { followUpCadenceDays: 3 });
    expect(((fu.find((n) => n.id === "read_deals") as ReadNode).query.filter as { lastActivityOlderThanDays: number }).lastActivityOlderThanDays).toBe(3);
  });

  it("switched-off optional steps drop out of the chain; unknown ids and required nodes are ignored", () => {
    const spec = catalogSpec("D01-W01");
    const nodes = applyParamsToSpec(spec, {}, ["read_posts", "produce", "nope"]);
    expect(nodes.map((n) => n.id)).toEqual(["trigger", "read_questions", "read_products", "produce", "gate", "receipt"]);
    expect(changesSpec(spec, {}, ["read_posts"])).toBe(true);
    expect(changesSpec(spec, {}, ["produce"])).toBe(false);
  });
});
