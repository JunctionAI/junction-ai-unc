import { describe, expect, it } from "vitest";
import { ACTIONS, ACTION_IDS, describeActionsForPrompt, getAction, idempotencyKey, isActionId, pickDeclaredParams, risksOf } from "../registry";
import { adPause, adResume, adRotate, adsetPause, adsetResume, adsetSetDailyBudget, campaignCreateFromBrief, creativeUploadImageFromUrl, readPerformance } from "../meta/actions";
import { encodeBody, fromMinorUnits, redactId, toMinorUnits } from "../meta/graph";
import { ctx } from "./helpers";

const BASE = "https://graph.facebook.com/v23.0";
const REDACTED = { Authorization: "Bearer ••••", Accept: "application/json" };
const POST_HEADERS = { ...REDACTED, "Content-Type": "application/x-www-form-urlencoded" };

describe("registry", () => {
  it("holds the Meta set with declared risks", () => {
    expect(ACTION_IDS).toEqual(["meta.campaign.read_performance", "meta.adset.pause", "meta.adset.resume", "meta.adset.set_daily_budget", "meta.ad.pause", "meta.ad.resume", "meta.ad.rotate", "meta.campaign.create_from_brief", "meta.creative.upload_image_from_url"]);
    expect(Object.fromEntries(ACTION_IDS.map((id) => [id, risksOf(ACTIONS[id])]))).toEqual({
      "meta.campaign.read_performance": ["read"],
      "meta.adset.pause": ["reversible"],
      "meta.adset.resume": ["reversible"],
      "meta.adset.set_daily_budget": ["spend"],
      "meta.ad.pause": ["reversible"],
      "meta.ad.resume": ["reversible"],
      "meta.ad.rotate": ["reversible"],
      "meta.campaign.create_from_brief": ["publish", "spend"],
      "meta.creative.upload_image_from_url": ["publish"],
    });
    expect(getAction("nope")).toBeNull();
    expect(isActionId("meta.ad.pause")).toBe(true);
    expect(isActionId("update_adset_budget")).toBe(false);
  });
  it("picks declared params only and keys idempotency on sorted params", () => {
    expect(pickDeclaredParams(adPause, { adId: "1", actionId: "meta.ad.pause", verdict: "x" })).toEqual({ adId: "1" });
    expect(idempotencyKey("run-1", "meta.ad.pause", { adId: "1", reason: "a" })).toBe(idempotencyKey("run-1", "meta.ad.pause", { reason: "a", adId: "1" }));
    expect(idempotencyKey("run-1", "meta.ad.pause", { adId: "1" })).not.toBe(idempotencyKey("run-2", "meta.ad.pause", { adId: "1" }));
    expect(idempotencyKey("run-1", "meta.ad.pause", { adId: "1" })).not.toBe(idempotencyKey("run-1", "meta.ad.pause", { adId: "2" }));
  });
  it("describes actions for the DECIDE prompt", () => {
    const all = describeActionsForPrompt();
    expect(all.startsWith("ACTIONS YOU MAY PROPOSE")).toBe(true);
    for (const id of ACTION_IDS) expect(all).toContain(`- ${id} [`);
    const one = describeActionsForPrompt(["meta.adset.set_daily_budget"]);
    expect(one).toContain("[spend]");
    expect(one).toContain("adsetId: string, required");
    expect(one).not.toContain("meta.ad.pause");
    expect(describeActionsForPrompt(["nope"])).toBe("");
  });
});

describe("money + redaction", () => {
  it("minor units per currency", () => {
    expect(toMinorUnits(72, "NZD")).toBe(7200);
    expect(toMinorUnits(72.005, "USD")).toBe(7201);
    expect(toMinorUnits(1500, "JPY")).toBe(1500);
    expect(fromMinorUnits("7200", "NZD")).toBe(72);
    expect(fromMinorUnits("1500", "JPY")).toBe(1500);
    expect(fromMinorUnits("x", "NZD")).toBe(0);
  });
  it("redacts ids to a tail and never leaks the token", () => {
    expect(redactId("120210123456789")).toBe("…456789");
    expect(redactId("")).toBe("");
    const dry = adsetPause.dryRun({ adsetId: "120210123456789" }, ctx());
    expect(JSON.stringify(dry)).not.toContain("EAAB");
    expect(dry.request.headers.Authorization).toBe("Bearer ••••");
  });
  it("form-encodes bodies the Graph way (objects as JSON)", () => {
    expect(encodeBody({ status: "PAUSED", daily_budget: 7200, targeting: { geo_locations: { countries: ["NZ"] } }, skip: undefined })).toBe("status=PAUSED&daily_budget=7200&targeting=%7B%22geo_locations%22%3A%7B%22countries%22%3A%5B%22NZ%22%5D%7D%7D");
  });
});

describe("dry-run request shapes", () => {
  it("read_performance: GET insights with the level fields + a budgets follow-up", () => {
    const d = readPerformance.dryRun({ level: "adset", datePreset: "last_7d", limit: 200 }, ctx());
    expect(d.request).toEqual({
      method: "GET",
      url: `${BASE}/act_123456789012345/insights?level=adset&fields=spend%2Cimpressions%2Cclicks%2Cctr%2Cfrequency%2Cpurchase_roas%2Cactions%2Caction_values%2Cadset_id%2Cadset_name%2Ccampaign_id&date_preset=last_7d&limit=200`,
      headers: REDACTED,
      note: "read adset-level performance over last_7d",
    });
    expect(d.followUps![0].url).toBe(`${BASE}/act_123456789012345/adsets?fields=id%2Cname%2Cstatus%2Ceffective_status%2Cdaily_budget%2Clifetime_budget&limit=200`);
    expect(d.preview).toBe("Read adset-level performance over last_7d with daily budgets — no change to the account");
    const range = readPerformance.dryRun({ level: "campaign", since: "2026-08-27", until: "2026-09-02" }, ctx());
    expect(range.request.url).toContain(`time_range=${encodeURIComponent(JSON.stringify({ since: "2026-08-27", until: "2026-09-02" }))}`);
    expect(range.request.url).toContain("campaign_id%2Ccampaign_name");
    expect(range.followUps![0].url).toContain("/campaigns?");
    expect(readPerformance.dryRun({ level: "ad" }, ctx()).followUps).toBeUndefined();
    expect(readPerformance.dryRun({}, ctx({ credential: null })).request.url).toContain("act_<not-connected>/insights");
  });

  it("pause / resume: POST /{id} status=", () => {
    expect(adsetPause.dryRun({ adsetId: "120210000000001" }, ctx())).toEqual({
      request: { method: "POST", url: `${BASE}/120210000000001`, headers: POST_HEADERS, body: { status: "PAUSED" }, note: "pause ad set …000001" },
      preview: "Pause ad set …000001",
      before: "ad set ACTIVE",
      after: "ad set PAUSED",
    });
    expect(adsetResume.dryRun({ adsetId: "120210000000001", reason: "learning done" }, ctx())).toMatchObject({ request: { body: { status: "ACTIVE" } }, preview: "Resume ad set …000001 — learning done" });
    expect(adPause.dryRun({ adId: "120210000000009" }, ctx()).request).toMatchObject({ url: `${BASE}/120210000000009`, body: { status: "PAUSED" } });
    expect(adResume.dryRun({ adId: "120210000000009" }, ctx()).request.body).toEqual({ status: "ACTIVE" });
    expect(adPause.rollback!({ adId: "120210000000009" }, { ok: true, receipt: "" })).toEqual({ actionId: "meta.ad.resume", params: { adId: "120210000000009" }, note: "set ad back to ACTIVE" });
  });

  it("set_daily_budget: POST /{adset} daily_budget in minor units, preview with before → after", () => {
    const d = adsetSetDailyBudget.dryRun({ adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60 }, ctx());
    expect(d.request).toEqual({ method: "POST", url: `${BASE}/120210000000001`, headers: POST_HEADERS, body: { daily_budget: 7200 }, note: "set ad set …000001 daily_budget=7200 (minor units of NZD)" });
    expect(d.preview).toBe("Set ad set …000001 daily budget NZD 60.00 → NZD 72.00 (+20%)");
    expect(d.spend).toEqual({ amount: 72, currency: "NZD", perDay: true });
    expect(d.before).toBe("NZD 60.00/day");
    expect(d.after).toBe("NZD 72.00/day");
    const cut = adsetSetDailyBudget.dryRun({ adsetId: "120210000000001", changePct: -25, currentDailyBudget: 60, reason: "pacing over cap" }, ctx());
    expect(cut.request.body).toEqual({ daily_budget: 4500 });
    expect(cut.preview).toBe("Set ad set …000001 daily budget NZD 60.00 → NZD 45.00 (-25%) — pacing over cap");
    expect(adsetSetDailyBudget.rollback!({ adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60 }, { ok: true, receipt: "" })).toEqual({ actionId: "meta.adset.set_daily_budget", params: { adsetId: "120210000000001", dailyBudget: 60, currentDailyBudget: 72 }, note: "restore the previous daily budget" });
    expect(adsetSetDailyBudget.dryRun({ adsetId: "120210000000001", dailyBudget: 1500, currentDailyBudget: 1200 }, ctx({ currency: "JPY" })).request.body).toEqual({ daily_budget: 1500 });
  });

  it("rotate: resume the next variant first, then pause the tired ad", () => {
    const d = adRotate.dryRun({ pauseAdId: "120210000000009", resumeAdId: "120210000000010" }, ctx());
    expect(d.request).toMatchObject({ url: `${BASE}/120210000000010`, body: { status: "ACTIVE" } });
    expect(d.followUps).toHaveLength(1);
    expect(d.followUps![0]).toMatchObject({ url: `${BASE}/120210000000009`, body: { status: "PAUSED" } });
    expect(d.preview).toBe("Resume ad …000010, then pause ad …000009");
    expect(adRotate.rollback!({ pauseAdId: "a", resumeAdId: "b" }, { ok: true, receipt: "" })).toEqual({ actionId: "meta.ad.rotate", params: { pauseAdId: "b", resumeAdId: "a" }, note: "swap them back" });
  });

  it("create_from_brief: campaign → ad set → ads, everything PAUSED, targeting + promoted_object shaped", () => {
    const d = campaignCreateFromBrief.dryRun(
      { name: "Creative test — 2026-09-03", objective: "OUTCOME_SALES", dailyBudget: 30, audience: { countries: ["NZ", "AU"], ageMin: 25, ageMax: 54, genders: [2], interestIds: ["6003"] }, creatives: [{ creativeId: "120210000000099" }, { instagramMediaId: "17900000000000001" }, { imageHash: "abc123", primaryText: "Hi", headline: "Buy", linkUrl: "https://x.com", pageId: "1000" }], pixelId: "123456789012345", durationDays: 7 },
      ctx(),
    );
    expect(d.request).toEqual({ method: "POST", url: `${BASE}/act_123456789012345/campaigns`, headers: POST_HEADERS, body: { name: "Creative test — 2026-09-03", objective: "OUTCOME_SALES", status: "PAUSED", special_ad_categories: [], buying_type: "AUCTION" }, note: 'create campaign "Creative test — 2026-09-03" PAUSED' });
    expect(d.followUps).toHaveLength(4);
    expect(d.followUps![0]).toMatchObject({
      url: `${BASE}/act_123456789012345/adsets`,
      body: {
        campaign_id: "{{campaign.id}}",
        daily_budget: 3000,
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "PAUSED",
        promoted_object: { pixel_id: "123456789012345", custom_event_type: "PURCHASE" },
        targeting: { geo_locations: { countries: ["NZ", "AU"] }, age_min: 25, age_max: 54, genders: [2], flexible_spec: [{ interests: [{ id: "6003" }] }], targeting_automation: { advantage_audience: 1 } },
      },
    });
    expect(d.followUps![1].body).toMatchObject({ adset_id: "{{adset.id}}", creative: { creative_id: "120210000000099" }, status: "PAUSED" });
    expect(d.followUps![2].body).toMatchObject({ creative: { source_instagram_media_id: "17900000000000001" }, status: "PAUSED" });
    expect(d.followUps![3].body).toMatchObject({ creative: { object_story_spec: { page_id: "1000", link_data: { image_hash: "abc123", message: "Hi", name: "Buy", link: "https://x.com" } } } });
    expect([d.request, ...d.followUps!].every((r) => r.body?.status === "PAUSED")).toBe(true);
    expect(d.preview).toBe('Create campaign "Creative test — 2026-09-03" (OUTCOME_SALES) with 1 ad set at NZD 30.00/day and 3 ads — everything PAUSED until you switch it on');
    expect(d.spend).toEqual({ amount: 30, currency: "NZD", perDay: true });
    const traffic = campaignCreateFromBrief.dryRun({ name: "t", objective: "OUTCOME_TRAFFIC", dailyBudget: 20, audience: { countries: "NZ" as never }, creatives: { instagramMediaId: "17900000000000001" } as never }, ctx());
    expect(traffic.followUps![0].body).toMatchObject({ optimization_goal: "LINK_CLICKS", targeting: { geo_locations: { countries: ["NZ"] } } });
    expect((traffic.followUps![0].body as { promoted_object?: unknown }).promoted_object).toBeUndefined();
  });

  it("create_from_brief execute is dry-run only until wave 2", async () => {
    const r = await campaignCreateFromBrief.execute({ name: "t", objective: "OUTCOME_TRAFFIC", dailyBudget: 20, audience: { countries: ["NZ"] }, creatives: [{ creativeId: "120210000000099" }] }, ctx({ mode: "live" }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_available");
  });

  it("upload_image_from_url: POST act/adimages url=", () => {
    const d = creativeUploadImageFromUrl.dryRun({ imageUrl: "https://cdn.example.com/a.jpg", name: "hero" }, ctx());
    expect(d.request).toEqual({ method: "POST", url: `${BASE}/act_123456789012345/adimages`, headers: POST_HEADERS, body: { url: "https://cdn.example.com/a.jpg", name: "hero" }, note: "upload image from cdn.example.com" });
  });
});
