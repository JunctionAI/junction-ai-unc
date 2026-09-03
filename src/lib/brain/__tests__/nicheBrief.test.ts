/* The niche brief: the validator (numbers only from the material — an invented number is rejected,
   a benchmark from nowhere is dropped), the memories round trip, the deterministic path, and the
   route (session-bound, demo fallback). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { clearLlmEnv, restoreLlmEnv } from "@/lib/llm/__tests__/env";
import type { Playbook } from "../playbooks";
import { allowedNumbers, buildNicheContext, deterministicBrief, generateNicheBrief, nicheBriefFromMemories, nicheBriefMemories, numbersOk, parseNicheBrief, readNicheBrief, renderNicheMaterial, type NicheBrief, type ProfileLike } from "../nicheBrief";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET, POST } from "@/app/api/unc/niche-brief/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";

const profile: ProfileLike = { name: "Deep Blue Health", oneLiner: "Natural supplements from New Zealand", category: "Natural supplements", products: ["Green lipped mussel", "Marine collagen"], audience: "Women 45+", businessType: "ecommerce", sells: "products", storefront: "shopify" };
const cards: Playbook[] = [
  { id: "pb-1", domain: "email", title: "Winback / sunset cascade", body: "Winback (lapsed 60–90+ days since purchase). Never sunset a valid long-cycle buyer because they haven't opened in 90 days.", tags: ["winback"], score: 0.8, via: "keyword" },
  { id: "pb-2", domain: "paid", title: "Meta account structure", body: "Retargeting under about five percent of spend. Plus twenty percent steps every few days, never doublings.", tags: ["meta"], score: 0.7, via: "keyword" },
];
const ctx = () => buildNicheContext(profile, cards, { currency: "NZD" });

type RawBrief = { categoryBand: string | null; summary: string; buyingTriggers: string[]; seasonality: string[]; channelsThatWork: string[]; benchmarks: { metric: string; low: number | null; high: number | null; unit: string; source: string }[]; avoid: string[] };
const good = (): RawBrief => ({
  categoryBand: "dtc_supplements",
  summary: "A replenishment market: the second order pays for the first. Repeat rate and the reorder window matter more than the first-order return. I will draft winback at 60 days, not 90.",
  buyingTriggers: ["A specific joint or skin complaint the product is known for", "Proof from a customer in the same age group"],
  seasonality: ["Winter joint-pain searches lift demand"],
  channelsThatWork: ["Email flows carry the repeat order", "Meta with proof-led creative for first orders"],
  benchmarks: [{ metric: "Winback window", low: 60, high: 90, unit: "days", source: "Winback / sunset cascade" }],
  avoid: ["Discounting on the first reminder", "Cure or treat claims in ad copy"],
});

beforeEach(() => {
  setFakeEnv();
  clearLlmEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-03T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Deep Blue", currency: "NZD" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3000 }]);
});
afterEach(() => {
  restoreEnv();
  restoreLlmEnv();
});

describe("validator — numbers only from the material", () => {
  it("accepts a brief whose numbers are all in the material", () => {
    const c = ctx();
    const brief = parseNicheBrief(good(), c)!;
    expect(brief).not.toBeNull();
    expect(brief.categoryBand).toBe("dtc_supplements");
    expect(brief.summary).toMatch(/^A replenishment market/);
    expect(brief.buyingTriggers).toHaveLength(2);
    expect(brief.benchmarks).toEqual([{ metric: "Winback window", low: 60, high: 90, unit: "days", source: "Winback / sunset cascade" }]);
    expect(brief.avoid).toHaveLength(2);
  });

  it("an invented number in a line drops that line; in the summary it rejects the brief", () => {
    const c = ctx();
    const raw = good();
    raw.buyingTriggers = ["A 37% lift from a review carousel", "Proof from a customer in the same age group"];
    const brief = parseNicheBrief(raw, c)!;
    expect(brief.buyingTriggers).toEqual(["Proof from a customer in the same age group"]);
    const bad = good();
    bad.summary = "Supplements convert at 2.4% on average, so paid pays back in 45 days.";
    expect(parseNicheBrief(bad, c)).toBeNull();
  });

  it("a benchmark carrying a number from nowhere is dropped; none left → null", () => {
    const c = ctx();
    const raw = good();
    raw.benchmarks = [{ metric: "Email share of revenue", low: 25, high: 35, unit: "%", source: "industry knowledge" }];
    expect(parseNicheBrief(raw, c)!.benchmarks).toBeNull();
    raw.benchmarks = [{ metric: "Retargeting share", low: null, high: 5, unit: "% of spend", source: "Meta account structure" }, { metric: "no number", low: null, high: null, unit: "", source: "x" }];
    expect(parseNicheBrief(raw, c)!.benchmarks).toEqual([{ metric: "Retargeting share", low: null, high: 5, unit: "% of spend", source: "Meta account structure" }]);
  });

  it("small counts (≤ 12) are always allowed; markdown, filler and exclamation marks are not", () => {
    const material = renderNicheMaterial(ctx());
    const allowed = allowedNumbers(material);
    expect(numbersOk("three hooks, 5 emails, 12 posts", allowed)).toBe(true);
    expect(numbersOk("a 13-email flow", allowed)).toBe(false);
    const raw = good();
    raw.avoid = ["**Never** discount", "Great question — avoid discounting", "Avoid discounting!", "Cure or treat claims in ad copy"];
    expect(parseNicheBrief(raw, ctx())!.avoid).toEqual(["Cure or treat claims in ad copy"]);
  });

  it("the evidence-picked band wins over the model's; an unknown band takes the model's read", () => {
    const raw = { ...good(), categoryBand: "saas" };
    expect(parseNicheBrief(raw, ctx())!.categoryBand).toBe("dtc_supplements");
    const unknown = buildNicheContext({ name: "Mystery Co" }, [], {});
    expect(unknown.band).toBeNull();
    const b = parseNicheBrief({ ...good(), categoryBand: "creator" }, unknown)!;
    expect(b.categoryBand).toBe("creator");
    expect(b.bandWhy).toMatch(/my read of the profile/);
  });

  it("garbage → null; the deterministic brief still carries the band and why", () => {
    expect(parseNicheBrief(null, ctx())).toBeNull();
    expect(parseNicheBrief({ summary: "" }, ctx())).toBeNull();
    const d = deterministicBrief(ctx());
    expect(d.categoryBand).toBe("dtc_supplements");
    expect(d.summary).toMatch(/replenishment/);
    expect(d.benchmarks).toBeNull();
  });
});

describe("memories round trip", () => {
  it("one memory per line, tagged niche, the band + summary at importance 4; reassembles to the same brief", () => {
    const brief = parseNicheBrief(good(), ctx())!;
    const mems = nicheBriefMemories(ACCT, brief);
    expect(mems.every((m) => m.kind === "fact" && m.source === "scan" && m.tags?.includes("niche") && m.sourceRef === `niche_brief:${ACCT}`)).toBe(true);
    expect(mems[0]).toMatchObject({ text: expect.stringMatching(/^Category band: dtc_supplements/), importance: 4, tags: ["niche", "niche_band"] });
    const back = nicheBriefFromMemories(mems.map((m) => ({ text: m.text, tags: m.tags ?? [] })))!;
    const expected: NicheBrief = { ...brief, bandWhy: brief.bandWhy };
    expect(back).toEqual(expected);
    expect(nicheBriefFromMemories([])).toBeNull();
  });

  it("generateNicheBrief with a fake model persists, replaces on re-run, and reads back", async () => {
    const llm = { complete: async () => `Here you go: ${JSON.stringify(good())}` };
    const r = await generateNicheBrief({ accountId: ACCT, profile, db }, { llm, playbooks: cards, embed: null, extra: { currency: "NZD" } });
    expect(r.author).toBe("model");
    expect(r.stored?.written).toBe(mems(r.brief));
    const back = await readNicheBrief(db, ACCT);
    expect(back?.summary).toBe(r.brief.summary);
    expect(back?.categoryBand).toBe("dtc_supplements");
    // a second run supersedes the first: still one live set
    const r2 = await generateNicheBrief({ accountId: ACCT, profile, db }, { llm: { complete: async () => JSON.stringify({ ...good(), avoid: ["Only one line now"] }) }, playbooks: cards, embed: null });
    expect(r2.brief.avoid).toEqual(["Only one line now"]);
    const live = (db.tables.get("memories") ?? []).filter((m) => m.valid_to === null || m.valid_to === undefined);
    expect(live.length).toBe(mems(r2.brief));
    expect((await readNicheBrief(db, ACCT))?.avoid).toEqual(["Only one line now"]);
  });

  it("no model → the deterministic brief is stored (the band still steers the presets)", async () => {
    const r = await generateNicheBrief({ accountId: ACCT, profile, db }, { llm: null, playbooks: cards, embed: null });
    expect(r.author).toBe("deterministic");
    const back = await readNicheBrief(db, ACCT);
    expect(back?.categoryBand).toBe("dtc_supplements");
    expect(back?.buyingTriggers).toEqual([]);
  });

  it("a model that returns junk falls back to the deterministic brief instead of failing", async () => {
    const r = await generateNicheBrief({ accountId: ACCT, profile, db }, { llm: { complete: async () => "no json here" }, playbooks: cards, embed: null, persist: false });
    expect(r.author).toBe("deterministic");
    expect(r.stored).toBeNull();
  });
});

function mems(b: NicheBrief): number {
  return nicheBriefMemories(ACCT, b).length;
}

describe("route", () => {
  const post = (body: unknown = {}) => POST(new Request("http://unc.test/api/unc/niche-brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("demo mode → fallback; no session → 401", async () => {
    clearBillingEnv();
    expect(await (await GET()).json()).toEqual({ fallback: true });
    restoreEnv();
    setFakeEnv();
    user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ profile })).status).toBe(401);
  });

  it("POST without a provider stores the deterministic brief off the body's profile; GET reads it back", async () => {
    const res = await post({ profile });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: NicheBrief; author: string; stored: { written: number } };
    expect(body.author).toBe("deterministic");
    expect(body.brief.categoryBand).toBe("dtc_supplements");
    expect(body.stored.written).toBeGreaterThan(0);
    const got = (await (await GET()).json()) as { brief: NicheBrief | null };
    expect(got.brief?.categoryBand).toBe("dtc_supplements");
  });

  it("lets members read but blocks generation before memories or model usage are written", async () => {
    db.rows("account_members")[0].role = "member";
    expect((await GET()).status).toBe(200);
    const res = await post({ profile });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(db.rows("memories")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("POST with no profile in the body reads business_profiles; with nothing at all it still answers (unknown band)", async () => {
    db.seed("business_profiles", [{ account_id: ACCT, profile: { name: "Studio", category: "Pilates studio", businessType: "local", sells: "services" } }]);
    const b1 = (await (await post({})).json()) as { brief: NicheBrief };
    expect(b1.brief.categoryBand).toBe("fitness_gym");
    db.tables.set("business_profiles", []);
    const b2 = (await (await post({})).json()) as { brief: NicheBrief };
    expect(b2.brief.categoryBand).toBeNull();
    expect(b2.brief.summary).toMatch(/don.t know your model yet/);
  });
});
