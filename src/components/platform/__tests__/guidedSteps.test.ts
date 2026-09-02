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

describe("ConnectDataStep — rendered per state", () => {
  const render = (S: PlatformState, channel: "Content" | "Email & SMS" | "SEO" | "Sales" | "Paid ads" = "Content") =>
    renderToStaticMarkup(createElement(ConnectDataStep, { V: derive(S, noop), channel, onConnect: async () => ({ kind: "fallback" as const, reason: "platform_not_configured" }), onContinue: noop, onLater: noop, onTokenLink: noop }));

  it("Content: cards for Instagram and Shopify only, Continue disabled, the later ghost present, dots continue at step 7", () => {
    const html = render({ ...initialState, onboarded: true, setupFlow: "connect" });
    expect(html).toContain("Step 7 · Your data");
    expect(html).toContain("Connect your data");
    expect(html).toContain('data-testid="connect-card-instagram" data-status="off"');
    expect(html).toContain('data-testid="connect-card-shopify" data-status="off"');
    expect(html).not.toContain("connect-card-klaviyo");
    expect(continueTag(html)).toContain("disabled");
    expect(html).toContain("I&#x27;ll do this later");
    expect(html).toContain("Your plan starts with <strong>Content</strong>");
  });

  it("Email plan: Klaviyo + Shopify; a connected card reads Connected ✓ and Continue is live", () => {
    const html = render({ ...initialState, connState: { Klaviyo: "ok" } }, "Email & SMS");
    expect(html).toContain('data-testid="connect-card-klaviyo" data-status="ok"');
    expect(html).toContain("Connected ✓");
    expect(html).toContain("I&#x27;ll read your last 90 days tonight");
    expect(continueTag(html)).not.toContain("disabled");
  });

  it("a lapsed connector says Needs reconnect and offers Reconnect", () => {
    const html = render({ ...initialState, connState: { Shopify: "expired" } }, "Email & SMS");
    expect(html).toContain('data-testid="connect-card-shopify" data-status="expired"');
    expect(html).toContain("Needs reconnect");
    expect(html).toContain(">Reconnect<");
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
    expect(html).toContain("Runs daily at 07:00");
    expect(html).toContain("draft-only for now");
    expect(html).toContain('data-testid="first-routine-turn-on"');
    expect(html).toContain("Not now");
  });

  it("refresh after turning it on: the same routine shows On ✓, no Turn-it-on, no Not-now, Continue to Home", () => {
    const html = render({ ...initialState, routineOn: { "Founder content engine": true } });
    expect(html).toContain('data-routine="D01-W01" data-on="1"');
    expect(html).toContain("On ✓");
    expect(html).toContain("first-routine-already-on");
    expect(html).not.toContain("first-routine-turn-on");
    expect(html).not.toContain("first-routine-skip");
    expect(html).toContain("Continue to Home");
  });

  it("per channel: Email → Abandoned cart recovery (needs Shopify for its number), SEO → Keyword opportunity scan, Sales → Lead research & scoring", () => {
    expect(render(initialState, "Email & SMS")).toContain('data-routine="D05-W02"');
    expect(render(initialState, "Email & SMS")).toContain("Needs Shopify connected for its number");
    expect(render({ ...initialState, connState: { Shopify: "ok" } }, "Email & SMS")).not.toContain("Needs Shopify connected");
    expect(render(initialState, "SEO")).toContain('data-routine="D03-W01"');
    expect(render(initialState, "Sales")).toContain('data-routine="D04-W01"');
  });

  it("Paid ads has no draft-only routine: says so honestly, straight to Home", () => {
    const html = render(initialState, "Paid ads");
    expect(html).toContain("Nothing to switch on yet");
    expect(html).not.toContain("first-routine-card");
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

  it("turnOnRoutine happy path: enable then dry-run → 'Running now — your first draft lands in What I drafted.'", async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url} ${init?.body}`);
      if (url === "/api/setup/enable") return new Response(JSON.stringify({ routineId: "D01-W01", enabled: true, version: 1 }), { status: 200 });
      return new Response(JSON.stringify({ run: { runId: "r1", status: "done", summary: "Drafted 3 posts", receipts: [{ kind: "read" }, { kind: "draft" }, { kind: "draft" }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await turnOnRoutine({ routineId: "D01-W01", accountId: "acct", account: { currency: "NZD", budgetMonthly: 3600 }, fetch: f });
    expect(r).toEqual({ kind: "ran", runId: "r1", status: "done", summary: "Drafted 3 posts", drafts: 2 });
    expect(turnOnLine(r)).toBe("Running now — your first draft lands in What I drafted.");
    expect(calls[0]).toBe('POST /api/setup/enable {"routineId":"D01-W01"}');
    expect(calls[1]).toContain("POST /api/routines/run");
    expect(calls[1]).toContain('"accountId":"acct"');
  });

  it("turnOnRoutine is honest when the run can't start, was skipped, or the enable failed", async () => {
    const enabledOnly = (async (url: string) => (url === "/api/setup/enable" ? new Response(JSON.stringify({ enabled: true }), { status: 200 }) : new Response(JSON.stringify({ error: "worker offline" }), { status: 500 }))) as unknown as typeof fetch;
    const r1 = await turnOnRoutine({ routineId: "D01-W01", accountId: "a", account: { currency: "NZD", budgetMonthly: 0 }, fetch: enabledOnly });
    expect(r1).toEqual({ kind: "enabled_only", error: "worker offline" });
    expect(turnOnLine(r1)).toContain("it runs on its schedule instead");

    const skipped = (async (url: string) => (url === "/api/setup/enable" ? new Response(JSON.stringify({ enabled: true }), { status: 200 }) : new Response(JSON.stringify({ run: { runId: "r2", status: "skipped", summary: "Not enough customer material", receipts: [] } }), { status: 200 }))) as unknown as typeof fetch;
    const r2 = await turnOnRoutine({ routineId: "D01-W01", accountId: "a", account: { currency: "NZD", budgetMonthly: 0 }, fetch: skipped });
    expect(turnOnLine(r2)).toBe("On. First dry run found nothing to draft yet — Not enough customer material. The next run is on its schedule.");

    const failed = (async () => new Response(JSON.stringify({ error: "no account for this user" }), { status: 403 })) as unknown as typeof fetch;
    const r3 = await turnOnRoutine({ routineId: "D01-W01", accountId: "a", account: { currency: "NZD", budgetMonthly: 0 }, fetch: failed });
    expect(r3).toEqual({ kind: "error", message: "no account for this user" });
  });
});
