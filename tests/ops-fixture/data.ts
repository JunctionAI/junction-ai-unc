import type { OpsClient, OpsDetail, OpsSnapshot } from "../../src/lib/ops/types";
import type { OpsRunWork } from "../../src/lib/ops/runWork";
export const A = "00000000-0000-4000-8000-000000000101";
export const B = "00000000-0000-4000-8000-000000000102";
export const R = "00000000-0000-4000-8000-000000000103";
const at = "2026-09-05T11:00:00Z";
const client = (id: string, patch: Partial<OpsClient>): OpsClient => ({ id, name: "Fixture Golf — NOT LIVE", currency: "NZD", contextGeneration: 1, paused: true, createdAt: at, website: "fixture.example.test", memberCount: 1, connectorCount: 1, datedReadCount: 1, enabledCount: 0, pendingDraftCount: 1, pendingRunApprovalCount: 0, runCount: 1, lastRunAt: at, failedRunCount: 0, verifiedChannelCount: 0, registeredWorkflowCount: 0, ...patch });
export const fixture: OpsSnapshot = {
  checkedAt: at, accountLimit: 100, historyLimit: 100, accountCount: 2,
  clients: [client(A, {}), client(B, { memberCount: 0, connectorCount: 0, datedReadCount: 0, pendingDraftCount: 0, runCount: 0, lastRunAt: null })],
  selected: null,
  runs: [{ id: R, accountId: A, routineId: "D03-W01", version: 1, mode: "dry_run", status: "done", startedAt: at, finishedAt: at }],
};
export const detail: OpsDetail = {
  accountId: A, contextGeneration: 1,
  connectors: [{ id: "connector-fixture", platform: "shopify", status: "connected", externalRef: "fixture.myshopify.com", lastReadAt: at, lastReadResult: "ok", lastReadMetrics: 3 }],
  routines: [], channels: [], runs: fixture.runs,
  drafts: [{ id: "artifact-fixture", runId: R, routineId: "D03-W01", title: "Synthetic keyword draft", status: "draft", revision: 0, createdAt: at }],
  receipts: [{ id: "receipt-fixture", runId: "run-fixture", kind: "draft", platform: null, description: "Synthetic draft prepared", createdAt: at }],
};
export const opsFixture = (accountId: string | null) => ({ ...fixture, selected: accountId ? accountId === A ? detail : { ...detail, accountId, connectors: [], runs: [], drafts: [], receipts: [] } : null });
export const workFixture = (): OpsRunWork => ({
  checkedAt: at, auditId: "00000000-0000-4000-8000-000000000104", accountId: A, contextGeneration: 1, run: fixture.runs[0],
  artifacts: [{ id: "00000000-0000-4000-8000-000000000105", runId: R, kind: "keyword_list", title: "Synthetic keyword draft", body: "Synthetic business output for golf travel bags.", editedBody: null, status: "draft", revision: 0, createdAt: at, items: [{ title: "Keyword item", body: "Synthetic discovery evidence; not a live result." }], evidence: [{ source: "fixture", ref: "synthetic-only" }], execution: null }],
  receipts: [{ id: "00000000-0000-4000-8000-000000000106", runId: R, kind: "draft", platform: null, description: "Synthetic draft prepared", createdAt: at, execution: null }],
  artifactAfter: "00000000-0000-4000-8000-000000000105", receiptAfter: "00000000-0000-4000-8000-000000000106", hasMore: false,
});
