/* The post-plan guided flow: the state machine (derive over PlatformState), its persistence
   round-trip (refresh idempotency), the two step components rendered per state
   (react-dom/server), and the two client helpers against a stubbed fetch. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { derive } from "@/lib/platform/derive";
import { initialState, type Patch, type PlatformState } from "@/lib/platform/state";
import { persistedProjection, rowsToState, stateToRows } from "@/lib/db/mapping";
import { startConnect } from "@/lib/setup/connect";
import { turnOnLine, turnOnRoutine } from "@/lib/setup/routine";
import type { BusinessProfile } from "@/lib/unc/scan";
import ConnectDataStep from "../ConnectDataStep";
import FirstRoutineStep from "../FirstRoutineStep";

const noop = () => {};

/** A tiny store: applies derive's patches so the state machine can be walked. */
function machine(start: PlatformState = initialState) {
  let S = start;
  const set = (patch: Patch | ((s: PlatformState) => Patch)) => {
    S = { ...S, ...(typeof patch === "function" ? patch(S) : patch) };
  };
  return { get: () => S, V: () => derive(S, set) };
}

describe("post-plan flow — state machine", () => {
  it("happy path: Agree the plan → connect → routine → home", () => {
    const m = machine({ ...initialState, obStep: 6 });
    expect(m.get().setupFlow).toBe("home");
    m.V().obFinish();
    expect(m.get()).toMatchObject({ onboarded: true, view: "today", setupFlow: "connect", settlePlan: true });
    m.V().setSetupFlow("routine");
    expect(m.get().setupFlow).toBe("routine");
    m.V().enableRoutineLocal("D01-W01");
    m.V().setFirstRunPending(true);
    expect(m.get().routineOn["Founder content engine"]).toBe(true);
    expect(m.get().firstRunPending).toBe(true);
    m.V().setSetupFlow("home");
    expect(m.get()).toMatchObject({ setupFlow: "home", view: "today" });
    // Home clears the one-shot motion flags
    m.V().clearSettlePlan();
    m.V().setFirstRunPending(false);
    expect(m.get()).toMatchObject({ settlePlan: false, firstRunPending: false });
  });

  it("skip paths: 'I'll do this later' records an honest later and moves to the routine step; 'Not now' lands on Home", () => {
    const m = machine({ ...initialState, obStep: 6 });
    m.V().obFinish();
    m.V().markConnectLater();
    expect(m.get()).toMatchObject({ setupFlow: "routine", setupConnectLater: true });
    expect(Object.values(m.get().connState)).not.toContain("ok"); // nothing was faked
    m.V().setSetupFlow("home");
    expect(m.get().setupFlow).toBe("home");
    expect(m.get().routineOn).toEqual({});
  });

  it("refresh idempotency: the step and the later/dismissed answers survive the persistence round-trip; the transient flags do not", () => {
    const m = machine({ ...initialState, obStep: 6 });
    m.V().obFinish();
    m.V().markConnectLater();
    m.V().dismissSetupCard();
    const rows = stateToRows("acct", m.get(), { now: "2026-09-02T09:00:00.000Z" });
    const back = rowsToState({ account: rows.account, goals: rows.goals, resourceProfile: rows.resourceProfile, teamMembers: rows.teamMembers, businessProfile: rows.businessProfile, routineStates: rows.routineStates, connectors: rows.connectors, chatMessages: rows.chatMessages, stateMeta: rows.stateMeta }, initialState);
    expect(back).toMatchObject({ onboarded: true, setupFlow: "routine", setupConnectLater: true, setupCardDismissed: true });
    expect(back.settlePlan).toBe(false);
    expect(back.firstRunPending).toBe(false);
    expect(back.planAgreedAt).toBeNull();
  });

  it("agreed_at is transient client state: hydrated from the progress fetch, never part of the persisted projection", () => {
    const m = machine(initialState);
    const before = persistedProjection(m.get());
    m.V().setPlanAgreedAt("2026-09-01T00:00:00.000Z");
    expect(m.get().planAgreedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(persistedProjection(m.get())).toBe(before); // no autosave churn from a hydrate
  });
});

const continueTag = (html: string) => html.match(/<button[^>]*data-testid="connect-continue"[^>]*>/)?.[0] ?? "";

/** A scanned services firm: no store, LinkedIn + HubSpot on the site. The fixture the "no Shopify" guard runs on. */
const SERVICES_PROFILE: BusinessProfile = {
  name: "Studio North",
  oneLiner: "A brand studio for founders.",
  category: "Design agency",
  products: [],
  audience: "Founders",
  voice: { tone: null, phrases: [] },
  market: { region: "NZ", competitorsMentioned: [] },
  signals: [],
  confidence: "high",
  sources: ["https://studionorth.example/"],
  businessType: "services",
  sells: "services",
  storefront: "none",
  businessTypeSource: "scan",
  typeEvidence: ["a services section", "a book-a-call / quote call to action"],
  platformsSpotted: [{ platform: "hubspot", evidence: "HubSpot forms or tracking on the site" }],
};
const scanned = (profile: BusinessProfile): PlatformState["scan"] => ({ status: "done", key: "k", profile });

describe("ConnectDataStep — rendered per state (cards are the founder's own platforms, never a table's)", () => {
  const render = (S: PlatformState, channel: "Content" | "Email & SMS" | "SEO" | "Sales" | "Paid ads" = "Content") =>
    renderToStaticMarkup(createElement(ConnectDataStep, { V: derive(S, noop), channel, onConnect: async () => ({ kind: "fallback" as const, reason: "platform_not_configured" }), onContinue: noop, onLater: noop, onTokenLink: noop }));

  it("Content, the founder picked Instagram + Shopify: those two cards only, Continue disabled, the later ghost present, dots continue at step 7", () => {
    const html = render({ ...initialState, onboarded: true, setupFlow: "connect", obPlatforms: ["Instagram", "Shopify"] });
    expect(html).toContain("Step 7 · Your data");
    expect(html).toContain("Connect your data");
    expect(html).toContain('data-testid="connect-card-instagram" data-status="off" data-source="picked"');
    expect(html).toContain('data-testid="connect-card-shopify" data-status="off" data-source="picked"');
    expect(html).toContain("You said you use this");
    expect(html).not.toContain("connect-card-klaviyo");
    expect(continueTag(html)).toContain("disabled");
    expect(html).toContain("I&#x27;ll do this later");
    expect(html).toContain("Your plan starts with <strong>Content</strong>");
    expect(html).toContain("the tools you told me you use");
  });

  it("Email plan, Klaviyo picked and connected: the card reads Connected ✓ and Continue is live; no email question", () => {
    const html = render({ ...initialState, obPlatforms: ["Klaviyo", "Shopify"], connState: { Klaviyo: "ok" } }, "Email & SMS");
    expect(html).toContain('data-testid="connect-card-klaviyo" data-status="ok"');
    expect(html).toContain("Connected ✓");
    expect(html).toContain("I&#x27;ll read your last 90 days tonight");
    expect(html).not.toContain("email-question");
    expect(continueTag(html)).not.toContain("disabled");
  });

  it("a lapsed connector says Needs reconnect and offers Reconnect", () => {
    const html = render({ ...initialState, obPlatforms: ["Shopify"], connState: { Shopify: "expired" } }, "Email & SMS");
    expect(html).toContain('data-testid="connect-card-shopify" data-status="expired"');
    expect(html).toContain("Needs reconnect");
    expect(html).toContain(">Reconnect<");
  });

  it("a services firm (scanned: no store): NO Shopify card — LinkedIn they picked, HubSpot I spotted, nothing else", () => {
    const html = render({ ...initialState, obPlatforms: ["LinkedIn"], scan: scanned(SERVICES_PROFILE) }, "Sales");
    expect(html).toContain('data-testid="connect-card-linkedin" data-status="off" data-source="picked"');
    expect(html).toContain('data-testid="connect-card-hubspot" data-status="off" data-source="spotted"');
    expect(html).toContain("I spotted this on your site");
    expect(html).toContain("HubSpot forms or tracking on the site.");
    expect(html).not.toContain("connect-card-shopify");
    expect(html).not.toContain("Shopify");
    expect(html).not.toContain("connect-card-gmail"); // Sales reads Gmail, but the founder never said they use it
    expect(html).toContain("the tools you told me about, plus what I spotted on your site");
  });

  it("the founder's order is kept, with what phase 1 reads ahead of what it doesn't", () => {
    const html = render({ ...initialState, obPlatforms: ["TikTok", "Klaviyo", "Instagram"] }, "Content");
    const order = [...html.matchAll(/data-testid="connect-card-([a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["instagram", "tiktok", "klaviyo"]);
  });

  it("nothing picked, nothing spotted: no card at all, Unc says so, Continue is open, the ghost points at Connectors", () => {
    const html = render({ ...initialState, obPlatforms: [] }, "Content");
    expect(html).not.toContain("connect-card-");
    expect(html).toContain("there&#x27;s nothing to connect");
    expect(continueTag(html)).not.toContain("disabled");
    expect(html).toContain('data-testid="connect-add-tool"');
    expect(html).not.toContain("connect-later");
  });

  it("Email plan and nothing says how email is sent: one honest question — Klaviyo / Mailchimp / none yet", () => {
    const asked = render({ ...initialState, obPlatforms: ["LinkedIn"], scan: scanned(SERVICES_PROFILE) }, "Email & SMS");
    expect(asked).toContain('data-testid="email-question"');
    expect(asked).toContain("Which tool sends your email?");
    expect(asked).toContain('data-testid="email-answer-klaviyo"');
    expect(asked).toContain('data-testid="email-answer-mailchimp"');
    expect(asked).toContain('data-testid="email-answer-none"');
    expect(asked).not.toContain("connect-card-shopify");
    // answered "none yet": the question is gone, the honest line is there, Continue is not blocked on a card
    const none = render({ ...initialState, obPlatforms: ["LinkedIn", "No email tool yet"], scan: scanned(SERVICES_PROFILE) }, "Email & SMS");
    expect(none).not.toContain("email-question");
    expect(none).toContain('data-testid="email-answer-line"');
    expect(none).toContain("No email tool yet — fine.");
    // answered Klaviyo: the Klaviyo card appears as picked
    const kl = render({ ...initialState, obPlatforms: ["LinkedIn", "Klaviyo"], scan: scanned(SERVICES_PROFILE) }, "Email & SMS");
    expect(kl).not.toContain("email-question");
    expect(kl).toContain('data-testid="connect-card-klaviyo" data-status="off" data-source="picked"');
    // a Klaviyo script spotted on the site answers it too
    const spotted = render({ ...initialState, obPlatforms: [], scan: scanned({ ...SERVICES_PROFILE, platformsSpotted: [{ platform: "klaviyo", evidence: "a Klaviyo signup script on the site" }] }) }, "Email & SMS");
    expect(spotted).not.toContain("email-question");
    expect(spotted).toContain('data-testid="connect-card-klaviyo" data-status="off" data-source="spotted"');
  });
});

describe("FirstRoutineStep — rendered per state", () => {
  const render = (S: PlatformState, channel: "Content" | "Email & SMS" | "SEO" | "Sales" | "Paid ads" = "Content") =>
    renderToStaticMarkup(createElement(FirstRoutineStep, { V: derive(S, noop), channel, onTurnOn: async () => ({ kind: "fallback" as const }), onContinue: noop, onSkip: noop }));

  it("Content: Founder content engine with its benefit, cadence, 'Turn it on' and 'Not now'; dots at step 8", () => {
    const html = render({ ...initialState, routineOn: {} });
    expect(html).toContain("Step 8 · First routine");
    expect(html).toContain('data-testid="first-routine-card" data-routine="D01-W01" data-on="0"');
    expect(html).toContain("Founder content engine");
    expect(html).toContain("Posts in your voice, drafted for you");
    expect(html).toContain("Catalog cadence: daily at 07:00");
    expect(html).toContain("draft-only for now");
    expect(html).toContain('data-testid="first-routine-turn-on"');
    expect(html).toContain("Not now");
  });

  it("a local enabled flag cannot certify a saved selection before the account read", () => {
    const html=render({...initialState,routineOn:{"Founder content engine":true}});
    expect(html).toContain('data-routine="D01-W01" data-on="0"');
    expect(html).toContain("Account eligibility has not been verified");
    expect(html).toContain('disabled="" data-testid="first-routine-turn-on"');
    expect(html).not.toContain("On ✓");
    expect(html).toContain("Not now");
  });

  it("per channel (business type unknown — nothing hidden): Email → Abandoned cart recovery (needs Shopify for its number), SEO → Keyword opportunity scan, Sales → Lead research & scoring", () => {
    expect(render(initialState, "Email & SMS")).toContain('data-routine="D05-W02"');
    expect(render(initialState, "Email & SMS")).toContain("Needs verified Shopify data");
    expect(render({ ...initialState, connState: { Shopify: "ok" } }, "Email & SMS")).not.toContain("Needs Shopify connected");
    expect(render(initialState, "SEO")).toContain('data-routine="D03-W01"');
    expect(render(initialState, "Sales")).toContain('data-routine="D04-W01"');
  });

  it("a services firm on an Email plan: never a cart — Founder content engine, with why, and the copy says clients", () => {
    const html = render({ ...initialState, scan: scanned(SERVICES_PROFILE), obPlatforms: ["LinkedIn", "No email tool yet"] }, "Email & SMS");
    expect(html).toContain('data-routine="D01-W01"');
    expect(html).not.toContain("Abandoned cart");
    expect(html).not.toContain("Shopify");
    expect(html).toContain("nothing in email &amp; sms fits your business yet, so this one first");
    expect(html).toContain("I prepare the work for clients");
    // a creator: audience
    const creator = render({ ...initialState, scan: scanned({ ...SERVICES_PROFILE, businessType: "creator", sells: "mixed" }) }, "Content");
    expect(creator).toContain("I prepare the work for audience");
  });

  it("Paid ads has no draft-only routine: the first generic one, and Unc says why it comes from outside the channel", () => {
    const html = render(initialState, "Paid ads");
    expect(html).toContain('data-routine="D01-W01"');
    expect(html).toContain("this setup path has no eligible paid ads starter yet");
    expect(html).toContain("Continue to Home");
  });
});

describe("client helpers against a stubbed fetch", () => {
  const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("startConnect: redirect / fallback → token link / shop needed / sign in / error", async () => {
    expect(await startConnect("shopify")).toEqual({ kind: "shop" });
    expect(await startConnect("klaviyo", { fetch: json(200, { url: "https://www.klaviyo.com/oauth/authorize?x" }) as unknown as typeof fetch })).toEqual({ kind: "redirect", url: "https://www.klaviyo.com/oauth/authorize?x" });
    expect(await startConnect("instagram", { fetch: json(200, { fallback: true, reason: "platform_not_configured" }) as unknown as typeof fetch })).toEqual({ kind: "fallback", reason: "platform_not_configured" });
    expect(await startConnect("klaviyo", { fetch: json(401, { error: "sign in first" }) as unknown as typeof fetch })).toEqual({ kind: "signIn" });
    expect(await startConnect("klaviyo", { fetch: json(500, { error: "nope" }) as unknown as typeof fetch })).toEqual({ kind: "error", message: "nope" });
  });

  const snapshot={accountId:"acct",contextGeneration:1,actorId:"owner-a",role:"owner",paused:false,routines:[{routineId:"D01-W01",enabled:false,version:1,stateUpdatedAt:null,selectionBlock:null}]};
  const turnInput={routineId:"D01-W01",accountId:"acct",contextGeneration:1,account:{currency:"NZD",budgetMonthly:0}};
  it("selects the exact saved revision without starting a run",async()=>{
    const calls:RequestInit[]=[];
    const f=(async(url:string,init?:RequestInit)=>{
      expect(url).toBe("/api/agents");calls.push(init!);
      expect(init?.headers).toMatchObject({"x-unc-account-id":"acct","x-unc-context-generation":"1"});
      return Response.json(init?.method==="POST" ? {saved:{...snapshot.routines[0],...turnInput,enabled:true,version:1,stateUpdatedAt:"2026-09-05T12:00:00Z"}} : snapshot);
    }) as typeof fetch;
    const result=await turnOnRoutine({...turnInput,fetch:f});expect(result).toEqual({kind:"selected"});
    expect(turnOnLine(result)).toContain("No run started");expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1].body as string)).toEqual({routineId:"D01-W01",enabled:true,version:1,stateUpdatedAt:null});
  });
  it("refuses foreign/paused/member/blocked inputs and does not replay an uncertain save",async()=>{
    for(const change of [{accountId:"foreign"},{paused:true},{role:"member"},{routines:[{...snapshot.routines[0],selectionBlock:"needs provider"}]}]){
      let writes=0;const f=(async(_url:unknown,init?:RequestInit)=>{if(init?.method==="POST")writes++;return Response.json({...snapshot,...change});}) as typeof fetch;
      expect((await turnOnRoutine({...turnInput,fetch:f})).kind).toBe("error");expect(writes).toBe(0);
    }
    let writes=0;const lost=(async(_url:unknown,init?:RequestInit)=>{if(init?.method==="POST"){writes++;throw new Error("lost response");}return Response.json(snapshot);}) as typeof fetch;
    const result=await turnOnRoutine({...turnInput,fetch:lost});expect(result.kind).toBe("uncertain");expect(writes).toBe(1);
    expect(turnOnLine(result)).not.toContain("runs on its schedule");
  });
});
