import type { OpsClient, OpsDetail, OpsSnapshot } from "../../src/lib/ops/types";
export const A = "00000000-0000-4000-8000-000000000101";
export const B = "00000000-0000-4000-8000-000000000102";
const at = "2026-09-05T11:00:00Z";
const client = (id: string, patch: Partial<OpsClient>): OpsClient => ({ id, name: "Fixture Golf — NOT LIVE", currency: "NZD", contextGeneration: 1, paused: true, createdAt: at, website: "fixture.example.test", memberCount: 1, connectorCount: 1, datedReadCount: 1, enabledCount: 0, pendingDraftCount: 1, pendingRunApprovalCount: 0, runCount: 1, lastRunAt: at, failedRunCount: 0, verifiedChannelCount: 0, registeredWorkflowCount: 0, ...patch });
export const fixture: OpsSnapshot = {
  checkedAt: at, accountLimit: 100, historyLimit: 100, accountCount: 2,
  clients: [client(A, {}), client(B, { memberCount: 0, connectorCount: 0, datedReadCount: 0, pendingDraftCount: 0, runCount: 0, lastRunAt: null })],
  selected: null,
  runs: [{ id: "run-fixture", accountId: A, routineId: "D03-W01", version: 1, mode: "dry_run", status: "done", startedAt: at, finishedAt: at }],
};
export const detail: OpsDetail = {
  accountId: A, contextGeneration: 1,
  connectors: [{ id: "connector-fixture", platform: "shopify", status: "connected", externalRef: "fixture.myshopify.com", lastReadAt: at, lastReadResult: "ok", lastReadMetrics: 3 }],
  routines: [], channels: [], runs: fixture.runs,
  drafts: [{ id: "artifact-fixture", runId: "run-fixture", routineId: "D03-W01", title: "Synthetic keyword draft", status: "draft", revision: 0, createdAt: at }],
  receipts: [{ id: "receipt-fixture", runId: "run-fixture", kind: "draft", platform: null, description: "Synthetic draft prepared", createdAt: at }],
};
export const opsFixture = (accountId: string | null) => ({ ...fixture, selected: accountId ? accountId === A ? detail : { ...detail, accountId, connectors: [], runs: [], drafts: [], receipts: [] } : null });
