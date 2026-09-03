import { describe, expect, it } from "vitest";
import { accountInitialState, initialState } from "@/lib/platform/state";
import { postureDefs } from "@/lib/platform/derive";
import { CLIENT_STATE_SCHEMA_VERSION, narrativeProse, persistedProjection, planPhases, rowsToState, stateToRows, type LoadedRows } from "../mapping";
import { expectedAfterRoundTrip, PERSISTED_KEYS, pick, richState } from "./fixtures";

const ACCT = "00000000-0000-4000-8000-00000000000a";
const NOW = "2026-09-02T09:00:00.000Z";

/** What loadAccountRows would return for a freshly saved state (same rows back). */
function asLoaded(rows: ReturnType<typeof stateToRows>): LoadedRows {
  return {
    account: rows.account,
    goals: rows.goals,
    resourceProfile: rows.resourceProfile,
    teamMembers: rows.teamMembers,
    businessProfile: rows.businessProfile,
    routineStates: rows.routineStates,
    connectors: rows.connectors,
    chatMessages: rows.chatMessages,
    stateMeta: rows.stateMeta,
  };
}

const EMPTY: LoadedRows = { account: null, goals: [], resourceProfile: null, teamMembers: [], businessProfile: null, routineStates: [], connectors: [], chatMessages: [], stateMeta: null };

describe("state → rows → state round-trip", () => {
  const S = richState();
  const rows = stateToRows(ACCT, S, { userId: "user-1", now: NOW });
  const back = rowsToState(asLoaded(rows), initialState);
  const want = expectedAfterRoundTrip(S);

  it.each(PERSISTED_KEYS)("%s survives the round-trip", (key) => {
    expect(back[key]).toEqual(want[key]);
  });

  it("transient UI fields come from the base state, not the rows", () => {
    expect(back.view).toBe(initialState.view);
    expect(back.selCat).toBe(initialState.selCat);
    expect(back.chatOpen).toBe(initialState.chatOpen);
    expect(back.apWhy).toEqual(initialState.apWhy);
    // the demo approval cards' decisions are demo furniture — never rows, never hydrated
    expect(back.apStatus).toEqual(initialState.apStatus);
  });

  it("the whole persisted slice is equal in one go", () => {
    expect(pick(back)).toEqual(pick(want));
  });

  it("the demo initial state round-trips too (seed on first sign-in)", () => {
    const rows0 = stateToRows(ACCT, initialState, { now: NOW });
    expect(pick(rowsToState(asLoaded(rows0), initialState))).toEqual(pick(initialState));
  });
});

describe("column mapping (0001 + 0003)", () => {
  const S = richState();
  const rows = stateToRows(ACCT, S, { userId: "user-1", now: NOW });

  it("accounts.currency", () => {
    expect(rows.account).toEqual({ id: ACCT, currency: "AUD" });
  });

  it("goals: governing = obCats[0] with the editable goal line, baseline and deadline; checkpoints from goalTexts", () => {
    expect(rows.goals).toEqual([
      { account_id: ACCT, category: "revenue", tier: "governing", title: "A$90,000 MRR", baseline: 41000, deadline: "2026-12-31" },
      { account_id: ACCT, category: "brand", tier: "checkpoint", title: "40k engaged followers", baseline: null, deadline: null },
      { account_id: ACCT, category: "leads", tier: "checkpoint", title: "80 qualified leads/mo", baseline: null, deadline: null },
    ]);
  });

  it("resource_profiles: enums bridged to the schema's check constraints", () => {
    expect(rows.resourceProfile).toEqual({
      account_id: ACCT,
      budget_monthly: 5200,
      hours_weekly: 12,
      reinvestment: "all_in", // state says "aggressive"
      gross_margin_pct: 55,
      website: "https://example.com",
      socials: ["@example", "https://tiktok.com/@example"],
      skills: ["Video", "Paid media", "SEO"],
      known_platforms: ["TikTok", "LinkedIn", "Google (Search & Ads)"],
      postures: ["paid_led", "brand_led"],
      breadth: "broad",
    });
    expect(stateToRows(ACCT, { ...S, reinvest: "steady" }).resourceProfile.reinvestment).toBe("steady");
    expect(stateToRows(ACCT, { ...S, reinvest: "balanced" }).resourceProfile.reinvestment).toBe("balanced");
    expect(stateToRows(ACCT, { ...S, website: "", socials: "" }).resourceProfile).toMatchObject({ website: null, socials: [] });
  });

  it("team_members: ordered by position, areas joined into approves", () => {
    expect(rows.teamMembers).toEqual([
      { account_id: ACCT, position: 0, name: "Ana", role: "Founder", approves: "Content, Sales" },
      { account_id: ACCT, position: 1, name: "Ben", role: "Marketing", approves: null },
      { account_id: ACCT, position: 2, name: "", role: "Marketing", approves: "Email & SMS" },
    ]);
  });

  it("plans: current play's label + phases with the founder's edits applied + prose narrative", () => {
    expect(rows.plan.title).toBe(postureDefs.paid.label);
    expect(rows.plan.phases[0]).toEqual({ n: "1", name: postureDefs.paid.phases[0].name, status: postureDefs.paid.phases[0].st, routines: ["Daily paid decisioning", "Ad fatigue watch"], from_you: postureDefs.paid.phases[0].you });
    expect(rows.plan.phases[1].routines).toEqual(postureDefs.paid.phases[1].routines); // no edit on paid.1
    expect(rows.plan.narrative).toBe("Paid first, brand behind it\n\nA$49,000 to find in 17 weeks.\n\nBuy learning fast.\n\nThen retention.\n\nThen scale.\n\nNumbers are yours.");
    expect(narrativeProse(null)).toBeNull();
    expect(planPhases("brand", {}).map((p) => p.routines)).toEqual(postureDefs.brand.phases.map((p) => p.routines));
  });

  it("business_profiles: scan status bridged, profile jsonb, scanned_at only when done", () => {
    expect(rows.businessProfile).toEqual({ account_id: ACCT, scan_status: "done", profile: S.scan.profile, scanned_at: NOW });
    const idle = stateToRows(ACCT, { ...S, scan: { status: "idle", key: null, profile: null } }, { now: NOW }).businessProfile;
    expect(idle).toEqual({ account_id: ACCT, scan_status: "pending", profile: {}, scanned_at: null });
    expect(stateToRows(ACCT, { ...S, scan: { ...S.scan, status: "running" } }).businessProfile.scan_status).toBe("running");
    expect(stateToRows(ACCT, { ...S, scan: { ...S.scan, status: "failed" } }).businessProfile.scan_status).toBe("failed");
  });

  it("routine_states: routine NAME → catalog id, only explicit toggles, only `enabled`", () => {
    expect(rows.routineStates).toEqual([
      { account_id: ACCT, routine_id: "D01-W01", enabled: true },
      { account_id: ACCT, routine_id: "D02-W01", enabled: false },
      { account_id: ACCT, routine_id: "D05-W01", enabled: true },
    ]);
    expect(stateToRows(ACCT, { ...S, routineOn: { "Not a routine": true } }).routineStates).toEqual([]);
  });

  it("connectors: card name → platform slug, status bridged", () => {
    expect(rows.connectors).toEqual([
      { account_id: ACCT, platform: "klaviyo", status: "connected" },
      { account_id: ACCT, platform: "shopify", status: "disconnected" },
      { account_id: ACCT, platform: "meta_ads", status: "needs_reconnect" },
    ]);
  });

  it("approvals: the demo cards are NOT persisted (no approvals rows in the projection, apStatus left to the base)", () => {
    expect("approvals" in rows).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("demo-ap-");
    expect(JSON.stringify(rows)).not.toContain("Advantage+ retargeting");
    // a decision on a demo card changes nothing persisted → no autosave for it
    expect(persistedProjection({ ...S, apStatus: ["approved", "approved", "approved"] })).toBe(persistedProjection(S));
  });

  it("goals.baseline NULL reads back as baselineNum null — never the base state's demo 28,400", () => {
    const seeded: LoadedRows = { ...EMPTY, goals: [{ account_id: ACCT, category: "revenue", tier: "governing", title: "NZ$100,000 monthly revenue", baseline: null, deadline: "2027-01-15" }] };
    const back = rowsToState(seeded, initialState);
    expect(back.baselineNum).toBeNull();
    expect(back.goalTitle).toBe("NZ$100,000 monthly revenue");
    // and a null state writes NULL, not 0
    expect(stateToRows(ACCT, { ...initialState, baselineNum: null }, { now: NOW }).goals[0].baseline).toBeNull();
    // a found zero is a zero both ways (Aerspan)
    expect(rowsToState({ ...seeded, goals: [{ ...seeded.goals[0], baseline: 0 }] }, initialState).baselineNum).toBe(0);
    expect(stateToRows(ACCT, { ...initialState, baselineNum: 0 }, { now: NOW }).goals[0].baseline).toBe(0);
  });

  it("chat_messages: three threads, positions, senders, link meta; typing placeholders dropped", () => {
    const corner = rows.chatMessages.filter((m) => m.thread === "corner");
    expect(corner).toEqual([
      { account_id: ACCT, thread: "corner", position: 0, lane: "ai", sender: "unc", body: "Morning Ana. One decision is waiting.", meta: { link: "D02-W01", linkLabel: "Inspect the system →" } },
      { account_id: ACCT, thread: "corner", position: 1, lane: "ai", sender: "user", body: "Why?", meta: {} },
      { account_id: ACCT, thread: "corner", position: 2, lane: "ai", sender: "unc", body: "Because ROAS.", meta: {} },
    ]);
    expect(rows.chatMessages.filter((m) => m.thread === "human").map((m) => [m.lane, m.sender])).toEqual([
      ["human", "staff"],
      ["human", "user"],
    ]);
    expect(rows.chatMessages.filter((m) => m.thread === "onboarding")).toHaveLength(2);
  });

  it("account_state_meta: versioned envelope for the column-less fields", () => {
    expect(rows.stateMeta.schema_version).toBe(CLIENT_STATE_SCHEMA_VERSION);
    expect(rows.stateMeta.client_state).toEqual({
      onboarded: true,
      obStep: 6,
      obCats: ["revenue", "brand", "leads"],
      posture: "paid",
      goalTexts: S.goalTexts,
      baselineText: "A$41,000 MRR today",
      targetNum: 90000,
      obPace: "Sprint · 2 weeks",
      profile: S.profile,
      routineEdits: S.routineEdits,
      narrative: S.narrative,
      scanKey: "sk",
      wfState: "draft",
      wfVer: 14,
      setupFlow: "routine",
      setupConnectLater: true,
      setupCardDismissed: true,
      obAnswered: { target: true, budget: true, hours: true },
    });
  });

  it("obAnswered: rows saved before the flags hydrate as answered (those founders agreed a plan on typed numbers); a fresh account's flags round-trip", () => {
    const meta = { ...rows.stateMeta, client_state: { ...rows.stateMeta.client_state } };
    delete meta.client_state.obAnswered;
    const legacy = rowsToState({ ...EMPTY, stateMeta: meta }, accountInitialState("NZD"));
    expect(legacy.obAnswered).toEqual({ target: true, budget: true, hours: true });
    const fresh = stateToRows("00000000-0000-4000-8000-000000000001", accountInitialState("AUD"));
    expect(fresh.stateMeta.client_state.obAnswered).toEqual({ target: false, budget: false, hours: false });
    expect(fresh.account.currency).toBe("AUD");
    expect(rowsToState(EMPTY, accountInitialState("AUD")).obAnswered).toEqual({ target: false, budget: false, hours: false });
  });

  it("guided-first-run fields: rows saved before them hydrate to their defaults (never trap an existing account)", () => {
    const meta = { ...rows.stateMeta, client_state: { ...rows.stateMeta.client_state } };
    delete meta.client_state.setupFlow;
    delete meta.client_state.setupConnectLater;
    delete meta.client_state.setupCardDismissed;
    const back = rowsToState({ ...EMPTY, stateMeta: meta }, initialState);
    expect(back.setupFlow).toBe("home");
    expect(back.setupConnectLater).toBe(false);
    expect(back.setupCardDismissed).toBe(false);
  });
});

describe("rows → state on partial accounts", () => {
  it("a fresh account (nothing saved) is exactly the base state", () => {
    expect(rowsToState(EMPTY, initialState)).toEqual(initialState);
  });

  it("only a resource profile: those fields load, everything else stays base", () => {
    const rp = stateToRows(ACCT, richState()).resourceProfile;
    const back = rowsToState({ ...EMPTY, resourceProfile: rp }, initialState);
    expect(back.budgetMo).toBe(5200);
    expect(back.reinvest).toBe("aggressive");
    expect(back.obPostureSet).toEqual(["paid", "brand"]);
    expect(back.posture).toBe("paid"); // no client_state → first posture wins
    expect(back.goalTitle).toBe(initialState.goalTitle);
    expect(back.team).toEqual(initialState.team);
  });

  it("goals without client_state derive obCats from the rows (governing first)", () => {
    const goals = stateToRows(ACCT, richState()).goals;
    const back = rowsToState({ ...EMPTY, goals: [goals[2], goals[0], goals[1]] }, initialState);
    expect(back.obCats).toEqual(["revenue", "leads", "brand"]);
    expect(back.goalTitle).toBe("A$90,000 MRR");
    expect(back.deadline).toBe("2026-12-31");
    expect(back.baselineNum).toBe(41000);
  });

  it("numeric columns may come back as strings from Postgres", () => {
    const rp = { ...stateToRows(ACCT, richState()).resourceProfile, budget_monthly: "5200" as unknown as number, gross_margin_pct: "55" as unknown as number };
    const back = rowsToState({ ...EMPTY, resourceProfile: rp });
    expect(back.budgetMo).toBe(5200);
    expect(back.marginPct).toBe(55);
  });

  it("unknown routine ids / connector platforms / senders are ignored, not crashed on", () => {
    const back = rowsToState({
      ...EMPTY,
      routineStates: [{ account_id: ACCT, routine_id: "D09-W99", enabled: true }],
      connectors: [{ account_id: ACCT, platform: "fax", status: "connected" }],
    });
    expect(back.routineOn).toEqual({});
    expect(back.connState).toEqual({});
  });
});

describe("persistedProjection", () => {
  it("ignores the clock, transient UI and server-owned connector/routine state", () => {
    const S = richState();
    expect(persistedProjection(S)).toBe(persistedProjection({ ...S, view: "today", chatOpen: false, apWhy: [false, false, false], buddyText: "x" }));
    expect(persistedProjection({ ...S, routineOn: { "Trend watch": true }, connState: { Slack: "ok" } })).toBe(persistedProjection(S));
    for (const key of PERSISTED_KEYS.filter((key) => key !== "routineOn" && key !== "connState")) {
      const mutated = { ...S, [key]: (VALID_MUTATIONS[key] ?? mutate)(S[key]) } as typeof S;
      expect(persistedProjection(mutated), key).not.toBe(persistedProjection(S));
    }
  });
});

/* Enum-shaped fields need a mutation that is still a legal value (an unknown posture or
   routine name is deliberately dropped by the mapping, so it would not change the projection). */
const VALID_MUTATIONS: Partial<Record<(typeof PERSISTED_KEYS)[number], (v: unknown) => unknown>> = {
  obPostureSet: () => ["brand"],
  posture: () => "brand",
  reinvest: () => "steady",
  obBreadth: () => "focused",
  wfState: () => "clean",
  routineOn: (v) => ({ ...(v as Record<string, boolean>), "Trend watch": true }),
  routineEdits: (v) => ({ ...(v as Record<string, string[]>), "brand.0": ["Trend watch"] }),
  connState: (v) => ({ ...(v as Record<string, string>), Slack: "ok" }),
  scan: (v) => ({ ...(v as object), status: "failed" }),
  narrative: (v) => ({ ...(v as object), status: "idle" }),
};

function mutate(v: unknown): unknown {
  if (typeof v === "string") return v + "!";
  if (typeof v === "number") return v + 1;
  if (typeof v === "boolean") return !v;
  if (Array.isArray(v)) return [...v, v.length ? mutate(v[0]) : "x"];
  if (v && typeof v === "object") return { ...(v as object), __changed: true };
  return "changed";
}
