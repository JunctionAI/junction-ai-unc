import { describe, expect, it } from "vitest";
import { connectorEvidence } from "../readiness";
import type { ConnectorStateView } from "../state";
const base: ConnectorStateView = { platform: "shopify", name: "Shopify", status: "connected", externalRef: "fixture.myshopify.com", lastSyncAt: null, lastSyncResult: null, lastReadMetrics: null, oauthConfigured: true, tokenPath: true };
describe("connector evidence", () => {
  it("does not equate connected with a data read", () => {
    expect(connectorEvidence(base).read).toContain("no dated data read");
    expect(connectorEvidence(base).identity).toContain("fixture.myshopify.com");
  });
  it("shows a dated successful snapshot, not live data", () => {
    const out = connectorEvidence({ ...base, lastSyncAt: "2026-09-04T01:00:00Z", lastSyncResult: "ok" });
    expect(out.read).toContain("last successful read: 2026-09-04 01:00:00 UTC");
    expect(out.read).toContain("not a live feed");
  });
  it("never labels a failed or empty read successful", () => {
    for (const lastSyncResult of ["empty", "error:expired"]) expect(connectorEvidence({ ...base, lastSyncAt: "2026-09-04T01:00:00Z", lastSyncResult }).read).not.toContain("successful");
    expect(connectorEvidence({ ...base, lastSyncAt: "invalid", externalRef: null }).identity).toContain("not selected");
  });
});
