import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeSetupProgress, loadSetupRows, type SetupRows } from "../progress";
import { savedPlanRoutineIds, savedPlanTimeline } from "../home";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { loadAccountFacts } from "../../unc/loadAccountFacts";
import { derive } from "../../platform/derive";
import { accountInitialState } from "../../platform/state";
import HomeView from "../../../components/platform/HomeView";
import type { AccountFacts } from "../../unc/accountFacts";

const NOW = new Date("2026-09-05T04:00:00Z");
const ACCT = "00000000-0000-4000-8000-00000000acc1";
const rows = (over: Partial<SetupRows> = {}): SetupRows => ({ plans: [], connectors: [], routineStates: [], runs: [], firstTasteEventAt: null, latestBrief: null, clientState: null, resourceProfile: { budget_monthly: null, skills: [], known_platforms: ["Shopify", "Facebook"] }, ...over });
const good = { platform: "shopify", status: "connected", external_ref: "test.myshopify.com", last_sync_at: "2026-09-02T00:00:00Z", last_sync_result: "ok" };

describe("setup evidence, not configuration claims", () => {
  it("rejects status-only, undated, failed, future and unbound reads without claiming a reconnect", () => {
    const p = computeSetupProgress(rows({ connectors: [
      { platform: "instagram", status: "connected" }, good,
      { ...good, platform: "meta_ads", last_sync_result: "empty", external_ref: "act_1" },
      { ...good, platform: "ga4", external_ref: null },
      { ...good, platform: "youtube", last_sync_at: null },
      { ...good, platform: "tiktok", last_sync_at: "2030-01-01" },
      { ...good, platform: "klaviyo", last_sync_result: "error:provider_unavailable" },
    ] }), NOW);
    expect(p.counts.connected).toBe(2);
    expect(p.steps[1].status).toContain("2 verified connections");
    expect(p.steps[1].status).toContain("not a live feed");
    expect(p.steps[1].status).not.toMatch(/nightly|tonight|reconnect/);
    expect(p.recommended).toBeNull(); // missing business inputs do not silently select Content
    const noRead = computeSetupProgress(rows({ connectors: [{ platform: "shopify", status: "connected" }] }), NOW);
    expect(noRead.steps[1].done).toBe(false);
    expect(noRead.platforms[0].status).toBe("connecting");
  });

  it("pause is explicit and removes plan agreement, routine and brief activation prompts", () => {
    const p = computeSetupProgress(rows({ automationPaused: true, connectors: [good] }), NOW);
    expect(p.automationPaused).toBe(true);
    expect(p.nextAction).toBeNull();
    expect(p.allDone).toBe(false);
    expect(p.steps.find((s) => s.key === "routine")?.status).toContain("paused");
    expect(p.steps.find((s) => s.key === "brief")?.status).toContain("paused");
  });

  it("reads pause and evidence from the exact account; no provider request or database mutation", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "AVGAR", automation_paused: true }, { id: "00000000-0000-4000-8000-00000000acc2", automation_paused: false }]);
    db.seed("connectors", [{ account_id: ACCT, ...good }, { account_id: "00000000-0000-4000-8000-00000000acc2", ...good, platform: "meta_ads" }]);
    const loaded = await loadSetupRows(db, ACCT);
    expect(loaded.automationPaused).toBe(true);
    expect(loaded.connectors).toHaveLength(1);
    expect(loaded.connectors[0]).toMatchObject(good);
    expect(computeSetupProgress(loaded, NOW).counts.connected).toBe(1);
  });

  it("unknown resources stay null in shared facts; explicit zero remains zero", async () => {
    const db = new FakeSupabase();
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: null, hours_weekly: null }]);
    expect((await loadAccountFacts(db, ACCT)).resources).toMatchObject({ budgetMonthly: null, hoursWeekly: null });
    const zeroDb = new FakeSupabase();
    zeroDb.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 0, hours_weekly: 0 }]);
    expect((await loadAccountFacts(zeroDb, ACCT)).resources).toMatchObject({ budgetMonthly: 0, hoursWeekly: 0 });
  });
});

describe("persisted plans only", () => {
  const plan = { title: "AVGAR pilot", agreedAt: "2000-01-01T00:00:00Z", phases: [{ n: "1", name: "Verify keyword opportunities", from_you: "Choose a seed", status: "DONE", routines: ["D03-W01"] }] };
  it("does not invent phases or completion from the clock, posture or stored legacy status", () => {
    expect(savedPlanTimeline(null)).toEqual([]);
    expect(savedPlanTimeline({ ...plan, phases: [] })).toEqual([]);
    expect(savedPlanTimeline(plan)).toEqual([{ n: 1, weeks: "Phase 1", title: "Verify keyword opportunities", focus: "Choose a seed", st: "Agreed", on: false }]);
    expect(savedPlanTimeline({ ...plan, agreedAt: null })[0].st).toBe("Draft");
    expect(savedPlanTimeline(plan, true)[0].st).toBe("Paused");
    expect(savedPlanRoutineIds(plan)).toEqual(["D03-W01"]);
  });

  it("renders the saved plan rather than a different local posture; paused controls make no delivery promises", () => {
    const facts: AccountFacts = { accountId: ACCT, plan, connectors: [], routineStates: [], resources: null, approvals: [], decided: [], runs: [], receipts: [], fetchedAt: NOW.toISOString() };
    const V = derive({ ...accountInitialState("NZD"), onboarded: true, automationPaused: true, posture: "paid" }, () => {}, undefined, undefined, { mode: "account", facts, now: NOW });
    const html = renderToStaticMarkup(createElement(HomeView, { V, accountMode: true, briefInitial: null, artifactsInitial: [] }));
    expect(html).toContain("Verify keyword opportunities");
    expect(html).toContain('data-routine="D03-W01"');
    expect(html).toContain("Briefs paused for setup verification");
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/within the hour|tomorrow morning|Weeks 1|your strength, running first|>Done</);
  });
});
