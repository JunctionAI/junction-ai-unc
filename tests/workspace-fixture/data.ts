import type { WorkspaceSnapshot } from "../../src/lib/workspace/read";
export const fixture: WorkspaceSnapshot = {
  accountId: "00000000-0000-4000-8000-000000000001", contextGeneration: 1, fetchedAt: "2026-09-05T10:00:00Z", window: 100,
  paused: false, canReview: true, truncated: { artifacts: false, runs: false, approvals: false, receipts: false },
  counts: { needsReview: 1, completed24h: 1, needsAttention: 0, routinesOn: 1 },
  routines: [{ id: "D03-W01", name: "Keyword opportunity", category: "SEO", enabled: true }, { id: "D01-W01", name: "Viral content", category: "Content", enabled: false }],
  artifacts: [{ accountId: "00000000-0000-4000-8000-000000000001", contextGeneration: 1, revision: 0, id: "00000000-0000-4000-8000-000000000004", runId: "run-fixture", routineId: "D03-W01", routineName: "Keyword opportunity", category: "SEO", kind: "keyword_list", title: "Golf keyword discovery", body: "Discovery seed: golf travel bag. Demand still needs review.", editedBody: null, preview: "Discovery seed: golf travel bag.", status: "draft", createdAt: "2026-09-05T09:00:00Z", items: [], meta: {}, evidence: [{ source: "fixture", ref: "Synthetic browser test only" }] }],
  approvals: [], receipts: [{ id: "receipt-fixture", runId: "run-fixture", approvalId: null, kind: "draft", platform: null, description: "Synthetic draft prepared", createdAt: "2026-09-05T09:00:00Z" }],
  runs: [{ id: "run-fixture", routineId: "D03-W01", name: "Keyword opportunity", mode: "dry_run", status: "done", startedAt: "2026-09-05T08:59:00Z", finishedAt: "2026-09-05T09:00:00Z" }],
};
