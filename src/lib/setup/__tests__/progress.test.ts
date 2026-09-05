/* setupProgress — the five spine steps with real states, 0/5 → 5/5, driven through the
   schema-checked FakeSupabase (the same rows the app writes) and the pure computation. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { agreePlan, computeSetupProgress, setupProgress, type SetupRows } from "../progress";
import { recommendedRoutine, requiredPlatform, phaseOneChannel, suggestPlatforms, waveOneRoutines } from "../channels";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const NOW = new Date("2026-09-02T09:00:00.000Z");

const empty = (over: Partial<SetupRows> = {}): SetupRows => ({
  plans: [],
  connectors: [],
  routineStates: [],
  runs: [],
  firstTasteEventAt: null,
  latestBrief: null,
  clientState: null,
  // the founder's own platforms (onboarding step 2) — the only source of connect cards
  resourceProfile: { postures: ["brand_led"], skills: ["Writing"], budget_monthly: 3600, known_platforms: ["Instagram", "Shopify"] },
  ...over,
});

describe("computeSetupProgress — 0/5 → 5/5", () => {
  it("0/5: a fresh account — plan first, the Content channel, the founder's Instagram + Shopify to connect, Founder content engine recommended", () => {
    const p = computeSetupProgress(empty(), NOW);
    expect(p.platforms.every((x) => x.source === "picked")).toBe(true);
    expect(p.business).toEqual({ businessType: null, sells: null, storefront: null });
    expect(p.emailQuestion).toBe(false);
    expect(p.done).toBe(0);
    expect(p.allDone).toBe(false);
    expect(p.channel).toBe("Content");
    expect(p.steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(p.nextAction).toEqual({ step: "plan", label: "Review business settings", anchor: "view:strategy" });
    expect(p.platforms.map((x) => x.platform)).toEqual(["instagram", "shopify"]);
    expect(p.platforms.every((x) => x.status === "disconnected")).toBe(true);
    expect(p.recommended).toMatchObject({ routineId: "D01-W01", name: "Founder content engine", enabled: false, requiredPlatform: null, requiredConnected: true });
    expect(p.steps[1].status).toBe("Connect Instagram, select the right account, and verify its first read.");
    expect(p.steps[2].status).toBe("Suggested starting point: Founder content engine. Check its readiness before enabling it.");
    expect(p.steps[3].status).toBe("Your first draft brings the first review — nothing to judge yet.");
    expect(p.steps[4].status).toBe("No brief yet. A completed routine does not guarantee a scheduled brief.");
  });

  it("1/5: plan agreed → the next action is connecting, with the agreed date in the plan line", () => {
    const p = computeSetupProgress(empty({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }] }), NOW);
    expect(p.done).toBe(1);
    expect(p.agreedAt).toBe("2026-09-01T20:00:00.000Z");
    expect(p.steps[0].status).toBe("Plan agreed 1 Sep. Agreement does not mean routines are running.");
    expect(p.nextAction).toEqual({ step: "connect", label: "Connect Instagram", anchor: "view:connectors" });
  });

  it("the guided flow's step is the anchor while the founder is inside it", () => {
    const p = computeSetupProgress(empty({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], clientState: { setupFlow: "connect" } }), NOW);
    expect(p.nextAction?.anchor).toBe("step:connect");
    const q = computeSetupProgress(empty({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }], clientState: { setupFlow: "routine" } }), NOW);
    expect(q.nextAction).toEqual({ step: "routine", label: "Turn on Founder content engine", anchor: "step:routine" });
  });

  it("'later' on connect is honest: not done, not amber, the next action moves on to the routine", () => {
    const p = computeSetupProgress(empty({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], clientState: { setupConnectLater: true } }), NOW);
    expect(p.done).toBe(1);
    expect(p.connectLater).toBe(true);
    expect(p.steps[1]).toMatchObject({ done: false, later: true });
    expect(p.steps[1].status).toBe("You said later. Connect Instagram, select the right account, and verify its first read.");
    expect(p.nextAction?.step).toBe("routine");
  });

  it("2/5: one connector connected — names listed, counts real", () => {
    const p = computeSetupProgress(empty({ plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }, { platform: "klaviyo", status: "needs_reconnect" }] }), NOW);
    expect(p.done).toBe(2);
    expect(p.counts.connected).toBe(1);
    expect(p.steps[1].status).toBe("1 verified connection — Shopify. Each has a selected account and a successful dated read; this is not a live feed.");
    expect(p.platforms.find((x) => x.platform === "shopify")?.status).toBe("connected");
  });

  it("3/5 needs BOTH an enabled routine and a finished run; a routine on with no run yet says so", () => {
    const base = { plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }], connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }], routineStates: [{ routine_id: "D01-W01", enabled: true }] };
    const on = computeSetupProgress(empty(base), NOW);
    expect(on.done).toBe(2);
    expect(on.steps[2].status).toBe("Founder content engine is on — the first dry run hasn't landed yet.");
    expect(on.nextAction).toEqual({ step: "routine", label: "Run it now", anchor: "view:systems" });
    // the recommendation moves to the next wave-1 routine of the channel once the first is on
    expect(on.recommended?.routineId).toBe("D01-W03");

    const ran = computeSetupProgress(empty({ ...base, runs: [{ id: "r1", routine_id: "D01-W01", status: "done", mode: "dry_run", started_at: "2026-09-02T07:00:00.000Z", finished_at: "2026-09-02T07:01:00.000Z" }] }), NOW);
    expect(ran.done).toBe(3);
    expect(ran.steps[2].status).toBe("1 on — first run finished 2 Sep.");
    expect(ran.steps[3].status).toBe("Open what I drafted and give me a yes, a hold or a why.");
    expect(ran.nextAction).toEqual({ step: "review", label: "Review the first draft", anchor: "#what-i-drafted" });
    expect(ran.routines).toEqual([{ routineId: "D01-W01", name: "Founder content engine", enabled: true, lastRunAt: "2026-09-02T07:00:00.000Z", lastRunStatus: "done" }]);
    expect(ran.counts).toEqual({ connected: 1, enabled: 1, runsDone: 1, runsThisWeek: 1 });

    const failed = computeSetupProgress(empty({ ...base, runs: [{ id: "r1", routine_id: "D01-W01", status: "failed", started_at: "2026-09-02T07:00:00.000Z" }] }), NOW);
    expect(failed.done).toBe(2); // a failed run is not a first run done
  });

  it("4/5: the first taste_event; 5/5: a brief exists — then the card collapses and no action remains", () => {
    const rows = empty({
      plans: [{ agreed_at: "2026-09-01T20:00:00.000Z" }],
      connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }],
      routineStates: [{ routine_id: "D01-W01", enabled: true }],
      runs: [{ id: "r1", routine_id: "D01-W01", status: "done", started_at: "2026-09-02T07:00:00.000Z" }],
      firstTasteEventAt: "2026-09-02T08:00:00.000Z",
    });
    const four = computeSetupProgress(rows, NOW);
    expect(four.done).toBe(4);
    expect(four.steps[3].status).toBe("First review logged 2 Sep — I'm learning your taste from it.");
    expect(four.nextAction).toEqual({ step: "brief", label: "Write today's brief", anchor: "#today-brief" });
    const five = computeSetupProgress({ ...rows, latestBrief: { day: "2026-09-02" }, clientState: { setupCardDismissed: true } }, NOW);
    expect(five.done).toBe(5);
    expect(five.allDone).toBe(true);
    expect(five.nextAction).toBeNull();
    expect(five.dismissed).toBe(true);
    expect(five.steps[4].status).toBe("Brief written for 2 Sep. Check its date before using it.");
  });

  it("running runs are listed; the channel follows the founder's posture/strengths/budget", () => {
    const p = computeSetupProgress(empty({ runs: [{ id: "r9", routine_id: "D05-W02", status: "running", started_at: "2026-09-02T08:59:00.000Z" }], resourceProfile: { postures: ["sales_led"], skills: ["Cold calls"], budget_monthly: 900, known_platforms: ["Gmail", "HubSpot", "Instagram"] } }), NOW);
    expect(p.channel).toBe("Sales");
    // the founder's order, with what Sales reads ahead of what it doesn't
    expect(p.platforms.map((x) => x.platform)).toEqual(["gmail", "hubspot", "instagram"]);
    expect(p.running).toEqual([{ runId: "r9", routineId: "D05-W02", name: "Abandoned cart recovery", startedAt: "2026-09-02T08:59:00.000Z" }]);
    expect(p.recommended?.routineId).toBe("D04-W01");
  });

  it("an Email plan's recommended routine needs Shopify connected — real, from the connector rows", () => {
    const rows = empty({ resourceProfile: { postures: ["brand_led"], skills: ["Email"], budget_monthly: 0 }, clientState: null });
    // brand posture without a content strength: Email & SMS (1.3×1.2) outranks Content (2.5×1)? No — 2.5 > 1.56. Force by strengths that don't lift Content and a paid-led posture with no budget:
    const paid = computeSetupProgress({ ...rows, resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 } }, NOW);
    expect(paid.channel).toBe("Email & SMS");
    expect(paid.recommended).toMatchObject({ routineId: "D05-W02", requiredPlatform: "shopify", requiredConnected: false });
    const withShop = computeSetupProgress({ ...rows, resourceProfile: { postures: ["paid_led"], skills: [], budget_monthly: 0 }, connectors: [{ platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }] }, NOW);
    expect(withShop.recommended?.requiredConnected).toBe(true);
  });
});

describe("recommended routine per phase-1 channel", () => {
  it.each([
    ["Content", "D01-W01"],
    ["Email & SMS", "D05-W02"],
    ["SEO", "D03-W01"],
    ["Sales", "D04-W01"],
  ] as const)("%s → %s (first wave-1 routine of the channel)", (channel, id) => {
    expect(recommendedRoutine(channel, [])?.id).toBe(id);
    expect(waveOneRoutines(channel).every((s) => s.wave === 1 && !s.mutates)).toBe(true);
  });
  it("Paid ads has no wave-1 routine (every paid routine mutates) → the first generic draft-only routine, never a paid one", () => {
    expect(waveOneRoutines("Paid ads")).toEqual([]);
    expect(recommendedRoutine("Paid ads", [])?.id).toBe("D01-W01");
    // and no table hands Paid ads a platform: with nothing picked or spotted there is nothing to connect
    expect(suggestPlatforms({ channel: "Paid ads", knownPlatforms: [] })).toEqual([]);
  });
  it("skips routines already on and wraps to the first when all are on", () => {
    expect(recommendedRoutine("Content", ["D01-W01"])?.id).toBe("D01-W03");
    expect(recommendedRoutine("Content", ["D01-W01", "D01-W03", "D01-W05"])?.id).toBe("D01-W01");
  });
  it("requiredPlatform: the KPI read platform for draft routines, nothing for runs-counted ones", () => {
    expect(requiredPlatform(CATALOG_SPEC_BY_ID["D01-W01"])).toBeNull();
    expect(requiredPlatform(CATALOG_SPEC_BY_ID["D05-W02"])).toBe("shopify");
    expect(requiredPlatform(CATALOG_SPEC_BY_ID["D02-W01"])).toBe("meta_ads");
  });
  it("phaseOneChannel is the plan's own ranking", () => {
    expect(phaseOneChannel({ posture: "brand", strengths: ["Writing"], budgetMo: 3600 })).toBe("Content");
    expect(phaseOneChannel({ posture: "sales", strengths: ["Cold calls"], budgetMo: 0 })).toBe("Sales");
  });
});

describe("setupProgress + agreePlan on the schema-checked fake", () => {
  function seeded(): FakeSupabase {
    const db = new FakeSupabase();
    db.now = () => NOW.toISOString();
    db.seed("accounts", [{ id: ACCT, name: "Example Co", automation_paused: false }]);
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3600, hours_weekly: 6, skills: ["Writing"], postures: ["brand_led"], breadth: "focused" }]);
    return db;
  }

  it("reads the rows the app writes and counts 0/5 for a fresh account", async () => {
    const db = seeded();
    const p = await setupProgress(db, ACCT, NOW);
    expect(p.done).toBe(0);
    expect(p.channel).toBe("Content");
    expect(db.callsFor("plans", "select").length).toBe(1);
    expect(db.callsFor("daily_briefs", "select").length).toBe(1);
    expect(db.callsFor("taste_events", "select").length).toBe(1);
  });

  it("agreePlan stamps the newest plan once (idempotent), or inserts a minimal row when none exists yet", async () => {
    const db = seeded();
    const first = await agreePlan(db, ACCT, NOW);
    expect(first).toEqual({ agreedAt: NOW.toISOString(), created: true, accountName: "Example Co" });
    expect(db.rows("plans")).toHaveLength(1);
    const again = await agreePlan(db, ACCT, new Date("2026-09-03T00:00:00.000Z"));
    expect(again).toEqual({ agreedAt: NOW.toISOString(), created: false, accountName: "Example Co" });
    expect(db.rows("plans")).toHaveLength(1);

    const db2 = seeded();
    db2.seed("plans", [{ account_id: ACCT, title: "Brand-led organic", phases: [], created_at: "2026-09-01T00:00:00.000Z" }]);
    const r = await agreePlan(db2, ACCT, NOW);
    expect(r).toEqual({ agreedAt: NOW.toISOString(), created: false, accountName: "Example Co" });
    expect(db2.rows("plans")[0].agreed_at).toBe(NOW.toISOString());
    const p = await setupProgress(db2, ACCT, NOW);
    expect(p.steps[0].done).toBe(true);
  });

  it("agreeing names a blank account: the scan's business name, else the website host, else the goal text — and never renames a named one", async () => {
    const blank = () => {
      const db = new FakeSupabase();
      db.now = () => NOW.toISOString();
      db.seed("accounts", [{ id: ACCT, name: "" }]);
      return db;
    };
    const a = blank();
    a.seed("business_profiles", [{ account_id: ACCT, scan_status: "done", profile: { name: "Harbour Physio", businessType: "local" } }]);
    a.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 0, hours_weekly: 4, website: "https://www.harbourphysio.co.nz/", breadth: "focused" }]);
    expect((await agreePlan(a, ACCT, NOW)).accountName).toBe("Harbour Physio");
    expect(a.rows("accounts")[0].name).toBe("Harbour Physio");

    const b = blank();
    b.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 0, hours_weekly: 4, website: "www.harbourphysio.co.nz", breadth: "focused" }]);
    b.seed("goals", [{ account_id: ACCT, category: "leads", tier: "governing", title: "40 qualified leads/mo" }]);
    expect((await agreePlan(b, ACCT, NOW)).accountName).toBe("harbourphysio.co.nz");

    const c = blank();
    c.seed("goals", [{ account_id: ACCT, category: "leads", tier: "governing", title: "40 qualified leads/mo" }]);
    expect((await agreePlan(c, ACCT, NOW)).accountName).toBe("40 qualified leads/mo");

    const d = blank();
    expect((await agreePlan(d, ACCT, NOW)).accountName).toBeNull();
    expect(d.rows("accounts")[0].name).toBe("");
    expect(d.callsFor("accounts", "update")).toHaveLength(0);

    const named = seeded();
    named.seed("business_profiles", [{ account_id: ACCT, scan_status: "done", profile: { name: "Someone Else" } }]);
    expect((await agreePlan(named, ACCT, NOW)).accountName).toBe("Example Co");
  });

  it("the platforms are the founder's, the recommendation fits the business: a services firm on an Email plan is never sent to Shopify or a cart", async () => {
    const db = new FakeSupabase();
    db.now = () => NOW.toISOString();
    db.seed("accounts", [{ id: ACCT, name: "Studio North" }]);
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 0, hours_weekly: 6, skills: [], postures: ["paid_led"], breadth: "focused", known_platforms: ["LinkedIn", "Email / SMS"] }]);
    db.seed("business_profiles", [{ account_id: ACCT, scan_status: "done", profile: { name: "Studio North", businessType: "services", sells: "services", storefront: "none", platformsSpotted: [{ platform: "hubspot", evidence: "HubSpot forms or tracking on the site" }] } }]);
    const p = await setupProgress(db, ACCT, NOW);
    expect(p.channel).toBe("Email & SMS");
    expect(p.business).toEqual({ businessType: "services", sells: "services", storefront: "none" });
    expect(p.platforms.map((x) => [x.platform, x.source])).toEqual([
      ["linkedin", "picked"],
      ["hubspot", "spotted"],
    ]);
    expect(p.platforms.find((x) => x.platform === "hubspot")?.evidence).toBe("HubSpot forms or tracking on the site");
    expect(p.platforms.some((x) => x.platform === "shopify")).toBe(false);
    expect(p.emailQuestion).toBe(true);
    // nothing in Email fits a business with no store (and no email tool yet) → the generic first routine
    expect(p.recommended?.routineId).toBe("D01-W01");
    expect(p.steps[1].status).toBe("Connect LinkedIn, select the right account, and verify its first read.");
    // the founder answers "none yet": the question is gone, Klaviyo-reading routines stay out
    db.rows("resource_profiles")[0].known_platforms = ["LinkedIn", "Email / SMS", "No email tool yet"];
    const q = await setupProgress(db, ACCT, NOW);
    expect(q.emailQuestion).toBe(false);
    expect(q.recommended?.routineId).toBe("D01-W01");
  });

  it("walks the whole spine on real rows: 5/5", async () => {
    const db = seeded();
    await agreePlan(db, ACCT, NOW);
    db.seed("connectors", [{ account_id: ACCT, platform: "shopify", status: "connected", external_ref: "test-asset", last_sync_at: "2026-09-01T00:00:00Z", last_sync_result: "ok" }]);
    db.seed("routine_states", [{ account_id: ACCT, routine_id: "D01-W01", enabled: true, version: 1 }]);
    db.seed("routine_runs", [{ id: "00000000-0000-4000-8000-00000000f001", account_id: ACCT, routine_id: "D01-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-02T07:00:00.000Z", finished_at: "2026-09-02T07:01:00.000Z" }]);
    db.seed("taste_events", [{ account_id: ACCT, routine_id: "D01-W01", action: "approved", context: {}, created_at: "2026-09-02T08:00:00.000Z" }]);
    db.seed("daily_briefs", [{ account_id: ACCT, day: "2026-09-02", body: "Morning.", items: [] }]);
    db.seed("account_state_meta", [{ account_id: ACCT, schema_version: 1, client_state: { setupCardDismissed: false } }]);
    const p = await setupProgress(db, ACCT, NOW);
    expect(p.done).toBe(5);
    expect(p.allDone).toBe(true);
    expect(p.dismissed).toBe(false);
    expect(p.nextAction).toBeNull();
  });
});
