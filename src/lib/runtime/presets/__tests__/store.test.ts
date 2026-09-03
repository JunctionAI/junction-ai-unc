/* Presets storage against the schema-checked fake (migration 0015): account override → industry →
   defaults, routine params + steps, refusals, the niche band from memories, the MetaPreset getter. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { catalogSpec } from "../../catalog-specs";
import { accountResolveInput, getAccountPreset, getMetaPreset, getPreset, getRoutineParams, getRoutinePreset, nicheBandFromMemories, nodesFor, paidPresetFrom, presetSource, PresetValidationError, setAccountPreset, setPresetDbForTests, setRoutineParams, toActionsMetaPreset } from "../store";
import { DEFAULT_META_PRESET, INDUSTRY_META_PRESETS, resolveMetaPreset, withPresetDefaults } from "@/lib/actions/presets";
import { resolvePreset } from "../industry";
import type { DecideNode } from "../../types";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => "2026-09-03T09:00:00.000Z";
  db.seed("accounts", [{ id: ACCT, name: "Deep Blue", currency: "NZD" }]);
  db.seed("business_profiles", [{ account_id: ACCT, profile: { name: "Deep Blue Health", category: "Natural supplements", businessType: "ecommerce", sells: "products", storefront: "shopify", products: ["Green lipped mussel"] } }]);
  db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3000, gross_margin_pct: 60 }]);
  db.seed("kpi_snapshots", [{ account_id: ACCT, metric_key: "aov_28d", value: 100, window_end: "2026-09-02", provenance: "live" }]);
});
afterEach(() => setPresetDbForTests(undefined));

describe("accountResolveInput", () => {
  it("reads the model, category, currency, budget, margin and AOV off the account's rows", async () => {
    const input = await accountResolveInput(db, ACCT);
    expect(input).toMatchObject({ businessType: "ecommerce", sells: "products", storefront: "shopify", category: "Natural supplements", currency: "NZD", aov: 100, grossMarginPct: 60, budgetMonthly: 3000, nicheBand: null });
    expect(input.descriptor).toContain("Green lipped mussel");
  });

  it("the niche brief's band memory steers the band", async () => {
    db.seed("memories", [{ account_id: ACCT, kind: "fact", text: "Category band: fitness_gym (Fitness, gym & studio) — the scan", source: "scan", tags: ["niche", "niche_band"], valid_from: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" }]);
    expect((await accountResolveInput(db, ACCT)).nicheBand).toBe("fitness_gym");
    expect(nicheBandFromMemories([{ text: "Category band: nonsense", tags: ["niche", "niche_band"] }])).toBeNull();
    expect(nicheBandFromMemories([{ text: "Category band: saas", tags: ["niche"] }])).toBeNull();
  });
});

describe("getPreset — layering", () => {
  it("no rows: the industry band with the derived money fields", async () => {
    const set = await getPreset(db, ACCT, "paid");
    expect(set.band?.id).toBe("dtc_supplements");
    const by = Object.fromEntries(set.fields.map((f) => [f.key, f]));
    expect(by.targetCpa.value).toBe(48);
    expect(by.dailyBudgetCap.value).toBe(100);
    expect(by.roasFloor).toMatchObject({ value: 2.5, source: "industry" });
  });

  it("an account override sits on top and is merged on write; null clears back to industry", async () => {
    await setAccountPreset(db, ACCT, "paid", { roasFloor: 3 });
    await setAccountPreset(db, ACCT, "paid", { holdDays: 5 });
    expect((await getAccountPreset(db, ACCT, "paid"))?.params).toEqual({ roasFloor: 3, holdDays: 5 });
    let by = Object.fromEntries((await getPreset(db, ACCT, "paid")).fields.map((f) => [f.key, f]));
    expect(by.roasFloor).toMatchObject({ value: 3, source: "founder" });
    expect(by.holdDays).toMatchObject({ value: 5, source: "founder" });
    await setAccountPreset(db, ACCT, "paid", { roasFloor: null });
    by = Object.fromEntries((await getPreset(db, ACCT, "paid")).fields.map((f) => [f.key, f]));
    expect(by.roasFloor).toMatchObject({ value: 2.5, source: "industry" });
    expect(db.calls.some((c) => c.table === "account_presets" && c.op === "upsert")).toBe(true);
  });

  it("refuses an out-of-range account value and writes nothing", async () => {
    await expect(setAccountPreset(db, ACCT, "paid", { roasFloor: 40 })).rejects.toThrow(PresetValidationError);
    expect(await getAccountPreset(db, ACCT, "paid")).toBeNull();
  });
});

describe("routine params", () => {
  it("saves values + switched-off steps, layers over the account, and binds into the chain", async () => {
    await setAccountPreset(db, ACCT, "paid", { roasFloor: 3 });
    const spec = catalogSpec("D02-W01");
    const rec = await setRoutineParams(db, ACCT, spec, { params: { scaleStepPct: 10 } });
    expect(rec).toMatchObject({ routineId: "D02-W01", domain: "paid", params: { scaleStepPct: 10 }, disabledSteps: [], source: "founder" });
    const view = (await getRoutinePreset(db, ACCT, spec))!;
    const by = Object.fromEntries(view.set.fields.map((f) => [f.key, f]));
    expect(by.roasFloor).toMatchObject({ value: 3, source: "founder" });
    expect(by.scaleStepPct).toMatchObject({ value: 10, source: "founder" });
    expect(view.relevant).toContain("roasFloor");
    expect(view.bound).toEqual(["roasFloor", "scaleStepPct"]);
    const decide = nodesFor(spec, view).find((n) => n.kind === "decide") as DecideNode;
    expect((decide.rule as { value: unknown }).value).toBe(3);
    expect(decide.options.find((o) => o.id === "scale")?.params?.changePct).toBe(10);
  });

  it("steps: only the spec's optional nodes can be switched; the state merges across saves", async () => {
    const spec = catalogSpec("D01-W01");
    await setRoutineParams(db, ACCT, spec, { steps: { read_posts: false } });
    await setRoutineParams(db, ACCT, spec, { params: { postsPerWeek: 4 }, steps: { read_products: false } });
    const rec = (await getRoutineParams(db, ACCT, "D01-W01"))!;
    expect(rec.disabledSteps.sort()).toEqual(["read_posts", "read_products"]);
    expect(rec.params).toEqual({ postsPerWeek: 4 });
    await setRoutineParams(db, ACCT, spec, { steps: { read_posts: true } });
    expect((await getRoutineParams(db, ACCT, "D01-W01"))!.disabledSteps).toEqual(["read_products"]);
    const view = (await getRoutinePreset(db, ACCT, spec))!;
    expect(view.steps.map((s) => [s.id, s.included])).toEqual([
      ["read_questions", true],
      ["read_posts", true],
      ["read_products", false],
    ]);
    expect(nodesFor(spec, view).map((n) => n.id)).not.toContain("read_products");
    await expect(setRoutineParams(db, ACCT, spec, { steps: { produce: false } })).rejects.toThrow(/not an optional step/);
    await expect(setRoutineParams(db, ACCT, spec, { params: { roasFloor: 2 } })).rejects.toThrow(/not a content field/);
  });
});

describe("the actions library's PresetSource", () => {
  it("maps a resolved paid set onto their keys; money fields left out until the account can derive them", () => {
    const set = resolvePreset({ businessType: "ecommerce", category: "supplements", currency: "NZD" }, "paid");
    expect(paidPresetFrom(set)).toMatchObject({ currency: "NZD", band: "dtc_supplements", targetCpa: null, maxCpa: null, roasFloor: 2.5, minSpendBeforeJudging: 50, fatigueFrequency: 4, fatigueCtrDropPct: 25, scaleStepPct: 20, holdDays: 3, dailyBudgetCap: null });
    const meta = toActionsMetaPreset(set);
    expect(meta).toEqual({ industry: "dtc_supplements", roasFloor: 2.5, minSpendBeforeJudging: 50, fatigueFrequency: 4, fatigueCtrDrop: 25, scaleStepPct: 20, holdDays: 3 });
    expect("targetCpa" in meta).toBe(false);
    expect(toActionsMetaPreset(resolvePreset({ businessType: "local" }, "paid")).industry).toBe("lead_gen_services");
    expect(toActionsMetaPreset(resolvePreset({}, "paid")).industry).toBe("dtc_general");
    // their resolver fills the rest and keeps every number we sent
    const full = withPresetDefaults(meta);
    expect(full).toMatchObject({ industry: "dtc_supplements", roasFloor: 2.5, holdDays: 3, fatigueCtrDrop: 25 });
    expect(full.targetCpa).toBe(INDUSTRY_META_PRESETS.dtc_supplements.targetCpa);
  });

  it("getMetaPreset / presetSource read the account through the injected db; with none they answer null so the default stands", async () => {
    await setAccountPreset(db, ACCT, "paid", { roasFloor: 3.5 });
    expect(await getMetaPreset(ACCT, db)).toMatchObject({ industry: "dtc_supplements", roasFloor: 3.5, targetCpa: 48, maxCpa: 60 });
    expect(await presetSource(db).getPreset(ACCT, "meta")).toMatchObject({ roasFloor: 3.5 });
    expect((await resolveMetaPreset(ACCT, presetSource(db))).roasFloor).toBe(3.5);
    setPresetDbForTests(() => db);
    expect((await getMetaPreset(ACCT))?.roasFloor).toBe(3.5);
    setPresetDbForTests(() => null);
    expect(await getMetaPreset(ACCT)).toBeNull();
    expect(await resolveMetaPreset(ACCT, presetSource(null))).toEqual(DEFAULT_META_PRESET);
  });
});
