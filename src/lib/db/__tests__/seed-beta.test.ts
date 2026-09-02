/* scripts/seed-beta.ts against the schema-checked fake: the six beta accounts land as the
   rows a founder's own onboarding would have produced, a second run changes nothing, and an
   unknown baseline is NULL — never 0. */

import { beforeEach, describe, expect, it } from "vitest";
import { BETA_ACCOUNTS, betaRows, betaState, seedBeta } from "../../../../scripts/seed-beta";
import { initialState } from "@/lib/platform/state";
import { ensureAccount, loadAccountState } from "../accountState";
import { FakeSupabase } from "./fakeSupabase";

let db: FakeSupabase;
beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
});

const NOW = () => new Date("2026-09-02T09:00:00.000Z");
const bySlug = (slug: string) => BETA_ACCOUNTS.find((a) => a.slug === slug)!;

describe("BETA_ACCOUNTS", () => {
  it("is the six founders with unique names (the idempotency key) and unique slugs", () => {
    expect(BETA_ACCOUNTS).toHaveLength(6);
    expect(new Set(BETA_ACCOUNTS.map((a) => a.name)).size).toBe(6);
    expect(new Set(BETA_ACCOUNTS.map((a) => a.slug)).size).toBe(6);
    expect(BETA_ACCOUNTS.map((a) => a.name).sort()).toEqual(["AVGAR Sport", "Aerspan Airdomes", "Deep Blue Health", "Home Invasion", "Rory O'Keefe", "Unity MMA"]);
  });

  it("every goal line carries its target as the first number, and a found baseline names its source", () => {
    for (const a of BETA_ACCOUNTS) {
      const first = a.goal.title.replace(/,/g, "").match(/\d+(\.\d+)?/);
      expect(first, a.slug).not.toBeNull();
      expect(Number(first![0]), a.slug).toBe(a.goal.target);
      expect(a.goal.deadline, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (a.baseline) {
        expect(a.baseline.source.length, a.slug).toBeGreaterThan(10);
        expect(a.baseline.asOf, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("uses only strengths / channels the onboarding chips offer (derive.ts)", () => {
    const strengths = ["Writing", "Video", "Design", "Sales conversations", "Cold calls", "DMs & outreach", "Email", "Paid media", "SEO", "Community", "Product"];
    const channels = ["Instagram", "TikTok", "LinkedIn", "Facebook", "YouTube", "X", "Google (Search & Ads)", "Bing", "Pinterest", "Reddit", "Email / SMS", "Other"];
    for (const a of BETA_ACCOUNTS) {
      for (const s of a.strengths) expect(strengths, `${a.slug}: ${s}`).toContain(s);
      for (const c of a.channels) expect(channels, `${a.slug}: ${c}`).toContain(c);
      expect(Object.keys(initialState.goalTexts), a.slug).toContain(a.goal.category);
    }
  });
});

describe("betaState / betaRows (pure)", () => {
  it("builds an onboarded state with no demo chat, a NULL baseline when unknown, and the demo approval cards held (not that it matters — they are not persisted)", () => {
    const S = betaState(bySlug("avgar"));
    expect(S.onboarded).toBe(true);
    expect(S.goalTitle).toBe("NZ$100,000 monthly revenue");
    expect(S.obCats).toEqual(["revenue"]);
    expect(S.messages.map((m) => m.from)).toEqual(["j"]);
    expect(S.messages[0].text).not.toMatch(/Morning Tom/);
    expect(S.humanThread).toHaveLength(1);
    expect(S.humanThread[0].text).not.toMatch(/Sam from the Junction team/);
    expect(S.apStatus).toEqual(["held", "held", "held"]);
    expect(S.baselineNum).toBe(35000);
    expect(betaState(bySlug("unity-mma")).baselineNum).toBeNull();
    expect(betaState(bySlug("aerspan")).baselineNum).toBe(0);
    expect(S.connState).toEqual({ Shopify: "off", Klaviyo: "off", "Meta Ads": "off", "Google Ads": "off", "Google Analytics 4": "off" });
    expect(S.team[0]).toMatchObject({ name: "Heather Anderson", role: "Founder" });
  });

  it("writes NULL for an unknown baseline and margin, the found value otherwise", () => {
    const unknown = betaRows(bySlug("unity-mma"), "acct-1", "2026-09-02T09:00:00.000Z");
    expect(unknown.goals).toHaveLength(1);
    expect(unknown.goals[0]).toMatchObject({ tier: "governing", category: "leads", baseline: null, deadline: "2027-03-01" });
    expect(unknown.resourceProfile.gross_margin_pct).toBeNull();

    const found = betaRows(bySlug("avgar"), "acct-2", "2026-09-02T09:00:00.000Z");
    expect(found.goals[0].baseline).toBe(35000);

    // a FOUND zero is a zero (Aerspan: no signed project yet) — distinguishable from unknown by the source note
    const zero = betaRows(bySlug("aerspan"), "acct-3", "2026-09-02T09:00:00.000Z");
    expect(zero.goals[0].baseline).toBe(0);
    expect((zero.businessProfile.profile.beta as { baseline_source: string | null }).baseline_source).toMatch(/no completed NZ project/);
  });
});

describe("seedBeta against the fake", () => {
  it("creates the six accounts with one governing goal, a resource profile, a business profile and the state envelope each", async () => {
    const results = await seedBeta(db, BETA_ACCOUNTS, { now: NOW });
    expect(results.every((r) => r.created && r.accountId)).toBe(true);
    expect(db.rows("accounts").map((r) => r.name).sort()).toEqual(BETA_ACCOUNTS.map((a) => a.name).sort());
    expect(db.rows("goals")).toHaveLength(6);
    expect(db.rows("goals").every((g) => g.tier === "governing")).toBe(true);
    expect(db.rows("resource_profiles")).toHaveLength(6);
    expect(db.rows("business_profiles")).toHaveLength(6);
    expect(db.rows("account_state_meta")).toHaveLength(6);
    expect(db.rows("plans")).toHaveLength(6);
    expect(db.rows("approvals")).toHaveLength(0); // the demo cards are not persisted
    // connectors only for the platforms we know each founder uses — all 'disconnected'
    const avgarId = results.find((r) => r.slug === "avgar")!.accountId;
    const avgarConns = db.rows("connectors").filter((c) => c.account_id === avgarId);
    expect(avgarConns.map((c) => c.platform).sort()).toEqual(["ga4", "google_ads", "klaviyo", "meta_ads", "shopify"]);
    expect(avgarConns.every((c) => c.status === "disconnected")).toBe(true);
    const unityId = results.find((r) => r.slug === "unity-mma")!.accountId;
    expect(db.rows("connectors").filter((c) => c.account_id === unityId)).toHaveLength(0);
    // no membership rows: the founders haven't signed up (attach happens at first login)
    expect(db.rows("account_members")).toHaveLength(0);
  });

  it("never writes a null baseline as 0, keeps a found baseline + its date, and leaves an unknown margin NULL", async () => {
    await seedBeta(db, BETA_ACCOUNTS, { now: NOW });
    const goalFor = (name: string) => {
      const id = db.rows("accounts").find((a) => a.name === name)!.id;
      return db.rows("goals").find((g) => g.account_id === id)!;
    };
    for (const a of BETA_ACCOUNTS) {
      const g = goalFor(a.name);
      if (a.baseline) {
        expect(g.baseline, a.slug).toBe(a.baseline.value);
        expect(g.baseline_date, a.slug).toBe(a.baseline.asOf);
      } else {
        expect(g.baseline, a.slug).toBeNull();
        expect(g.baseline_date, a.slug).toBeNull();
      }
      expect(g.title, a.slug).toBe(a.goal.title);
      expect(g.deadline, a.slug).toBe(a.goal.deadline);
    }
    expect(db.rows("resource_profiles").every((r) => r.gross_margin_pct === null)).toBe(true);
    // the unknown-baseline accounts really are unknown, not accidentally 0
    expect(goalFor("Unity MMA").baseline).toBeNull();
    expect(goalFor("Deep Blue Health").baseline).toBeNull();
    expect(goalFor("Home Invasion").baseline).toBeNull();
    expect(goalFor("Rory O'Keefe").baseline).toBeNull();
  });

  it("is idempotent on a second run: same ids, no duplicate rows", async () => {
    const first = await seedBeta(db, BETA_ACCOUNTS, { now: NOW });
    const counts = () => Object.fromEntries(["accounts", "goals", "resource_profiles", "business_profiles", "team_members", "connectors", "plans", "approvals", "chat_messages", "account_state_meta"].map((t) => [t, db.rows(t).length]));
    const before = counts();
    const second = await seedBeta(db, BETA_ACCOUNTS, { now: () => new Date("2026-09-03T09:00:00.000Z") });
    expect(second.every((r) => !r.created)).toBe(true);
    expect(second.map((r) => r.accountId)).toEqual(first.map((r) => r.accountId));
    expect(counts()).toEqual(before);
    expect(db.rows("accounts")).toHaveLength(6);
    expect(db.rows("goals")).toHaveLength(6);
    // no insert on accounts the second time round
    expect(db.callsFor("accounts", "insert")).toHaveLength(6);
  });

  it("re-seeding after a fact changes updates in place (currency, goal line) and keeps NULL baselines NULL", async () => {
    await seedBeta(db, BETA_ACCOUNTS, { now: NOW });
    const h1 = { ...bySlug("home-invasion"), currency: "USD" as const, goal: { ...bySlug("home-invasion").goal, title: "US$30,000 monthly revenue" } };
    await seedBeta(db, [h1], { now: NOW });
    const acct = db.rows("accounts").find((a) => a.name === "Home Invasion")!;
    expect(acct.currency).toBe("USD");
    const goal = db.rows("goals").find((g) => g.account_id === acct.id)!;
    expect(goal).toMatchObject({ title: "US$30,000 monthly revenue", baseline: null });
    expect(db.rows("goals")).toHaveLength(6);
  });

  it("hydrates through the app's own loader on first login (found=true, so ensureAccount won't re-seed from the client)", async () => {
    const [avgar] = await seedBeta(db, [bySlug("avgar")], { now: NOW });
    const { state, found } = await loadAccountState(db, avgar.accountId!, initialState);
    expect(found).toBe(true);
    expect(state.onboarded).toBe(true);
    expect(state.goalTitle).toBe("NZ$100,000 monthly revenue");
    expect(state.deadline).toBe("2027-01-15");
    expect(state.baselineNum).toBe(35000);
    expect(state.currency).toBe("NZD");
    // an unknown baseline hydrates as null — the Home header asks for it instead of showing demo progress
    const [unity] = await seedBeta(db, [bySlug("unity-mma")], { now: NOW });
    expect((await loadAccountState(db, unity.accountId!, initialState)).state.baselineNum).toBeNull();
    expect(state.website).toBe("https://avgarsport.com");
    expect(state.connState.Shopify).toBe("off");
    expect(state.scan.profile?.name).toBe("AVGAR Sport");
    expect(state.messages[0].text).toMatch(/Tom set this account up/);
  });

  it("invite flow end to end: seed → beta_invites row → the founder's first magic-link login attaches to the seeded account (docs/BETA.md §Invite flow)", async () => {
    const [avgar] = await seedBeta(db, [bySlug("avgar")], { now: NOW });
    db.seed("beta_invites", [{ account_id: avgar.accountId, email: "heather@example.com", invited_by: "tom", note: "avgar" }]);
    db.userId = "user-heather";
    db.userEmail = "heather@example.com";
    // the client arrives with its demo/onboarding state — it must NOT overwrite the seed
    const res = await ensureAccount(db, { ...initialState, goalTitle: "NZ$40,000 MRR" }, { userId: "user-heather" });
    expect(res).toMatchObject({ accountId: avgar.accountId, created: false });
    expect(res.state.goalTitle).toBe("NZ$100,000 monthly revenue");
    expect(res.state.onboarded).toBe(true);
    expect(res.state.team[0].name).toBe("Heather Anderson");
    expect(db.rows("accounts")).toHaveLength(1);
    expect(db.rows("account_members")).toEqual([expect.objectContaining({ account_id: avgar.accountId, user_id: "user-heather", role: "owner" })]);
    expect(db.rows("beta_invites")[0].accepted_user_id).toBe("user-heather");
    expect(db.rows("goals")[0].title).toBe("NZ$100,000 monthly revenue");
  });

  it("--dry-run writes nothing", async () => {
    const lines: string[] = [];
    const results = await seedBeta(db, BETA_ACCOUNTS, { dryRun: true, now: NOW, log: (l) => lines.push(l) });
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.accountId === null && !r.created)).toBe(true);
    expect(db.rows("accounts")).toHaveLength(0);
    expect(db.rows("goals")).toHaveLength(0);
    expect(db.calls.every((c) => c.op === "select")).toBe(true);
    expect(lines.join("\n")).toMatch(/\[dry-run\] avgar "AVGAR Sport" → create/);
  });
});
