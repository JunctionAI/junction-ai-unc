/* Routines + Connectors in accounts mode vs demo mode, rendered to a string (react-dom/server):
   accounts mode shows only what the database says (enabled from routine_states, availability,
   the recommended chip, last run / draft; the connector's first-read line and the owner's
   token path) — never derive.ts's demo "Active" defaults; demo mode is untouched. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConnectorsStateListing, ConnectorStateView } from "@/lib/connectors/state";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import { routinesStateForAccount, type RoutinesStateListing } from "@/lib/runtime/routinesState";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import ConnectorsView from "../ConnectorsView";
import RoutineDetail from "../RoutineDetail";
import RoutinesView, { ROUTINES_COPY } from "../RoutinesView";

const noop = () => {};
const ACCT = "00000000-0000-4000-8000-00000000acc1";
const demoRun = { accountId: "demo", account: { currency: "NZD", budgetMonthly: 3000 }, persisted: false };
const acctRun = { accountId: ACCT, account: { currency: "NZD", budgetMonthly: 3000 }, persisted: true };

async function listing(): Promise<RoutinesStateListing> {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: ACCT, name: "Example", currency: "NZD" }]);
  db.seed("connectors", [{ account_id: ACCT, platform: "shopify", status: "connected", last_sync_result: "ok" }]);
  db.seed("plans", [{ account_id: ACCT, title: "Brand-led organic", phases: [{ n: "1", routines: ["Abandoned cart recovery", "Campaign calendar prep"] }] }]);
  const store = new MemoryStore();
  await store.putRoutineState({ accountId: ACCT, routineId: "D05-W07", enabled: true, version: 3, draftSpec: null, liveSpec: null, updatedAt: "2026-09-02T00:00:00.000Z" });
  await store.createRun({ id: "run-1", accountId: ACCT, routineId: "D05-W07", version: 3, mode: "dry_run", status: "done", startedAt: "2026-09-02T06:00:00.000Z", finishedAt: "2026-09-02T06:00:05.000Z", summary: "Campaign calendar prep: drafts handed over." });
  await store.appendReceipt({ id: "rc-1", accountId: ACCT, runId: "run-1", kind: "draft", description: "Would ask Tom: 3 campaigns drafted", payload: {}, createdAt: "2026-09-02T06:00:04.000Z" });
  return routinesStateForAccount({ store, db }, ACCT, {routineId:"D05-W07"});
}

const emailState: PlatformState = { ...initialState, onboarded: true, view: "systems", selCat: "Email & SMS" };
const catsState: PlatformState = { ...initialState, onboarded: true, view: "systems", selCat: "All" };
const renderRoutines = (S: PlatformState, run: typeof demoRun, initialLive?: RoutinesStateListing) => renderToStaticMarkup(createElement(RoutinesView, { V: derive(S, noop), run, initialLive }));

describe("RoutinesView — accounts mode reads the database, demo mode is the prototype", () => {
  it("demo: the prototype's rows with derive's on/off and Tutorial links; no live markup", () => {
    const html = renderRoutines(emailState, demoRun);
    expect(html).toContain("Tutorial →");
    expect(html).not.toContain("data-testid=\"routine-D05-W02\"");
    expect(html).not.toContain(ROUTINES_COPY.recommended);
    expect(html).not.toContain("routines-loading");
  });

  it("accounts, listing in hand: real rows — enabled from routine_states, version, availability, the recommended chip, last run + draft", async () => {
    const live = await listing();
    const html = renderRoutines(emailState, acctRun, live);
    // the one the database says is on (v3, ran, drafted)
    expect(html).toContain('data-testid="routine-D05-W07" data-enabled="1"');
    // its reads are optional: never blocked on Klaviyo, only "Better with" it (a hint, not a block)
    expect(html).toContain("v3 · drafts only — nothing goes out without you");
    expect(html).toContain('data-testid="better-with"');
    expect(html).toContain(ROUTINES_COPY.betterWith("Klaviyo"));
    expect(html).not.toContain("v3 · needs Klaviyo connected");
    // a mutating email chain still honestly blocked on Klaviyo; winback drafts once Shopify is in
    expect(html).toContain("Welcome flow tuning · v1 · needs Klaviyo connected");
    expect(html).toContain("Winback campaign prep · v1 · draft-only for now");
    expect(html).toContain("Last run");
    expect(html).toContain(ROUTINES_COPY.draftReady);
    // recommended-first (plan phase 1, wave 1) — off, chipped; Shopify (required) is in, Klaviyo only helps
    expect(html).toContain('data-testid="routine-D05-W02" data-enabled="0"');
    expect(html).toContain(ROUTINES_COPY.recommended);
    // derive's demo defaults never leak: the demo marks "Welcome flow tuning" Active, the DB does not
    const welcome = ALL_SYSTEMS.find((s) => s.name === "Welcome flow tuning")!;
    expect(html).toContain(`data-testid="routine-${welcome.id}" data-enabled="0"`);
    expect(html).not.toContain("saves ~");
  });

  it("accounts, nothing on: the plan-start line in Unc's voice; the role cards count real switches", async () => {
    const live = await listing();
    const none = { ...live, routines: live.routines.map((r) => ({ ...r, enabled: false })) };
    const html = renderRoutines(catsState, acctRun, none);
    const esc = (s: string) => s.replace(/&/g, "&amp;");
    expect(html).toContain(esc(ROUTINES_COPY.planStart("Email & SMS")));
    expect(html).toContain("0 of 8 on");
    expect(html).toContain(ROUTINES_COPY.recommended);
    const on = renderRoutines(catsState, acctRun, live);
    expect(on).toContain("1 of 8 on");
    expect(on).not.toContain(esc(ROUTINES_COPY.planStart("Email & SMS")));
  });

  it("accounts, no listing yet: a loading line, never demo counts", () => {
    const html = renderRoutines(catsState, acctRun);
    expect(html).toContain("routines-loading");
    expect(html).not.toMatch(/\d of \d on/);
  });
});

describe("RoutineDetail — accounts mode shows the real routine", () => {
  const selState: PlatformState = { ...initialState, onboarded: true, view: "systems", sel: ALL_SYSTEMS.find((s) => s.id === "D05-W07")! };
  it("real state pill, real version, the spec's own chain, the real setup (sources vs connected), no demo wizard", async () => {
    const live = await listing();
    const eligible={...live,actorId:"owner-a",accountId:ACCT,contextGeneration:0,fetchedAt:new Date().toISOString(),role:"owner" as const,paused:false,routines:live.routines.map(r=>({...r,stateUpdatedAt:null,selectionBlock:null}))};
    const liveHook = { active: true, loading: false, data: live,eligibility:eligible, error: null, refresh: noop, patch: noop };
    const html = renderToStaticMarkup(createElement(RoutineDetail, { V: derive(selState, noop), run: acctRun, live: liveHook }));
    expect(html).toContain('data-testid="detail-state"');
    expect(html).toContain("On · drafts only — nothing goes out without you");
    expect(html).toContain("Better with Klaviyo connected");
    expect(html).toContain("v3 · configured");
    expect(html).toContain('data-testid="spec-node"');
    expect(html).toContain("Schedule");
    expect(html).toContain('data-testid="contract-cadence"');
    expect(html).toContain("Mondays 08:00");
    expect(html).toContain("Draft only — produces inspectable work and never changes the destination.");
    expect(html).toContain("Campaign calendars delivered — target at least 1 calendars / 28d, measured over 28 days.");
    expect(html).not.toContain("Reconciled accuracy");
    expect(html).toContain('data-testid="source-shopify" data-ok="1"');
    expect(html).toContain('data-testid="source-klaviyo" data-ok="0"');
    expect(html).toContain("Open Connectors");
    expect(html).not.toContain("Set this up");
    expect(html).not.toContain("Klaviyo — reconnect");
  });

  it("demo mode: the prototype's wizard and version counter", () => {
    const html = renderToStaticMarkup(createElement(RoutineDetail, { V: derive(selState, noop), run: demoRun }));
    expect(html).toContain("Set this up");
    expect(html).toMatch(/v\d+ · active/);
    expect(html).not.toContain('data-testid="spec-node"');
    expect(html).not.toContain('data-testid="real-setup"');
  });
});

describe("ConnectorsView — the owner's token path and the first-read line", () => {
  const S: PlatformState = { ...initialState, onboarded: true, view: "connectors", connState: { Shopify: "ok", Klaviyo: "off", HubSpot: "off", "Meta Ads": "expired" } };
  const card = (over: Partial<ConnectorStateView> & { platform: string }): ConnectorStateView => {
    const e = CONNECTOR_REGISTRY.find((c) => c.id === over.platform)!;
    return { name: e.name, status: "disconnected", externalRef: null, lastSyncAt: null, lastSyncResult: null, lastReadMetrics: null, oauthConfigured: false, tokenPath: e.flow !== "none", ...over };
  };
  const state = (role: "owner" | "member", extra: Partial<ConnectorStateView>[] = [], google = false): ConnectorsStateListing => ({
    role,
    google: { configured: google, children: ["ga4", "google_ads", "search_console"] },
    connectors: CONNECTOR_REGISTRY.map((e) => {
      const o = extra.find((x) => x.platform === e.id);
      return card({ platform: e.id, ...(o ?? {}) });
    }),
  });
  const render = (initialLive?: ConnectorsStateListing) => renderToStaticMarkup(createElement(ConnectorsView, { V: derive(S, noop), initialLive }));

  it("demo: no token path, no read line", () => {
    const html = render();
    expect(html).not.toContain("Connect with a token");
    expect(html).not.toContain('data-testid="read-line"');
  });

  it("owner: token link is quiet under Connect when the OAuth app is configured, the only action when it isn't; a member sees neither", () => {
    const html = render(state("owner", [{ platform: "klaviyo", oauthConfigured: true }, { platform: "hubspot", oauthConfigured: false }]));
    const klaviyo = html.slice(html.indexOf('data-testid="connector-klaviyo"'), html.indexOf('data-testid="connector-instagram"'));
    expect(klaviyo).toContain(">Connect<");
    expect(klaviyo).toContain('data-testid="token-link"');
    const hubspot = html.slice(html.indexOf('data-testid="connector-hubspot"'), html.indexOf('data-testid="connector-gmail"'));
    expect(hubspot).toContain('data-testid="token-primary"');
    expect(hubspot).not.toContain(">Connect<");
    const member = render(state("member", [{ platform: "klaviyo", oauthConfigured: true }]));
    expect(member).not.toContain("Connect with a token");
    expect(member).not.toContain(">Connect<");
    expect(member).not.toContain(">Reconnect<");
    expect(member).not.toContain("Disconnect");
    expect(member).toContain("Owner managed");
  });

  it("connected cards distinguish an unproven read, a completed read and a generic failure without prescribing login", () => {
    const reading = render(state("owner", [{ platform: "shopify", status: "connected", externalRef: "acme.myshopify.com" }]));
    expect(reading).toContain("no completed data read yet.");
    expect(reading).not.toContain("Reading your last 90 days…");
    const done = render(state("owner", [{ platform: "shopify", status: "connected", lastSyncAt: "2026-09-02T09:00:00.000Z", lastSyncResult: "ok", lastReadMetrics: 4 }]));
    expect(done).toContain("Read ✓ · 4 metrics");
    const failed = render(state("owner", [{ platform: "shopify", status: "connected", lastSyncAt: "2026-09-02T09:00:00.000Z", lastSyncResult: "error:first_read" }]));
    expect(failed).toContain("t read: first read");
    expect(failed).not.toContain("— Reconnect");
  });
  it("shows held refreshes and temporary/configuration errors without a reconnect instruction", () => {
    for (const lastSyncResult of ["error:auth_temporarily_unavailable", "error:auth_configuration_error"]) {
      const html = render(state("owner", [{ platform: "shopify", status: "connected", lastSyncResult }]));
      expect(html).not.toContain("— Reconnect");
    }
    const html = render(state("owner", [{ platform: "shopify", status: "connected", authRecovery: { status: "uncertain", attempts: 1, retryAt: null } }]));
    expect(html).toContain("retries are held");
    expect(html).not.toContain("Reading your last 90 days…");
    expect(html).not.toContain("— Reconnect");
  });
});
