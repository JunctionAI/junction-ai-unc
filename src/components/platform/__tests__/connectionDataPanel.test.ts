import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConnectionDataState } from "@/lib/data/connectionState";
import { ConnectionDataPanel } from "../ConnectorsView";

const base: ConnectionDataState = { coverage: "required_meta_ads_reads_only", checkedAt: "2026-09-06T00:00:00Z", status: "no_demand", accountPaused: true, queries: [] };
const render = (state?: ConnectionDataState) => renderToStaticMarkup(createElement(ConnectionDataPanel, { state }));
describe("Connections stored-data panel", () => {
  it("treats missing or failed reports as unverified", () => {
    for (const state of [undefined, { ...base, status: "unavailable" as const }]) {
      expect(render(state)).toContain("could not be verified");
      expect(render(state)).not.toContain("datasets were fresh");
    }
  });
  it("shows all-off separately from paused and does not claim automatic refresh", () => {
    const html = render(base);
    expect(html).toContain("No enabled routines");
    expect(html).toContain("automation is paused");
    expect(html).toContain("does not verify scheduled refreshes");
    expect(html).toContain("does not fetch new provider data");
  });
  it("labels freshness as a dated check, scoped only to required Meta reads", () => {
    const html = render({ ...base, status: "ready", queries: [{ key: "test", resource: "insights", routineIds: ["D02-W01"], availability: "ready", sourceFetchedAt: base.checkedAt, maxAgeMs: 300_000 }] });
    expect(html).toContain("fresh at the last check");
    expect(html).toContain("maximum age 5 min");
    expect(html).toContain("Source read: 2026-09-06T00:00:00Z");
    expect(html).toContain("optional reads are not covered");
    expect(html).toContain("automation is paused");
  });
  it("renders stale data as needing attention rather than reconnecting auth", () => {
    const html = render({ ...base, status: "waiting", queries: [{ key: "test", resource: "insights", routineIds: ["D02-W01"], availability: "stale", sourceFetchedAt: base.checkedAt, maxAgeMs: 300_000 }] });
    expect(html).toContain("Needs fresh data");
    expect(html).not.toContain("Reconnect");
  });
});
