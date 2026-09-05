import { artifactView } from "../artifacts/handlers";
import { approvalView, receiptView } from "../approvals/handlers";
import { ALL_SYSTEMS } from "../platform/catalog";
import type { Store } from "../runtime/store/interface";

export const WORKSPACE_WINDOW = 100;
const names = new Map(ALL_SYSTEMS.map(s => [s.id, s]));

/** A bounded, dated projection of saved work, never a provider call or scheduler claim. */
export async function readWorkspace(store: Store, accountId: string, contextGeneration: number, now = new Date()) {
  const [artifacts, runs, approvals, receipts, states] = await Promise.all([
    store.listArtifacts(accountId, { contextGeneration, limit: WORKSPACE_WINDOW }),
    store.listRuns(accountId, { contextGeneration, limit: WORKSPACE_WINDOW }),
    store.listApprovals(accountId, undefined, contextGeneration),
    store.listReceipts(accountId, { contextGeneration, limit: WORKSPACE_WINDOW }),
    store.listRoutineStates(accountId),
  ]);
  const at = now.toISOString();
  const visibleApprovals = approvals.filter(a => !!a.runId).slice(0, WORKSPACE_WINDOW).map(approvalView);
  const visibleArtifacts = artifacts.map(a => artifactView(a, contextGeneration));
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return {
    accountId, contextGeneration, fetchedAt: at,
    window: WORKSPACE_WINDOW,
    truncated: { artifacts: artifacts.length >= WORKSPACE_WINDOW, runs: runs.length >= WORKSPACE_WINDOW, approvals: approvals.length >= WORKSPACE_WINDOW, receipts: receipts.length >= WORKSPACE_WINDOW },
    artifacts: visibleArtifacts,
    approvals: visibleApprovals,
    receipts: receipts.map(receiptView),
    runs: runs.map(r => ({ id: r.id, routineId: r.routineId, name: names.get(r.routineId)?.name ?? r.routineId, mode: r.mode, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null })),
    routines: ALL_SYSTEMS.map(s => ({ id: s.id, name: s.name, category: s.cat, enabled: states.some(r => r.routineId === s.id && r.enabled) })),
    counts: {
      needsReview: visibleArtifacts.filter(a => a.status === "draft" || a.status === "edited").length + visibleApprovals.filter(a => a.status === "pending" && a.expiresAt > at).length,
      completed24h: runs.filter(r => r.status === "done" && r.finishedAt && Date.parse(r.finishedAt) >= cutoff && Date.parse(r.finishedAt) <= now.getTime()).length,
      needsAttention: runs.filter(r => r.status === "failed" || r.status === "waiting_input").length,
      routinesOn: states.filter(r => r.enabled && names.has(r.routineId)).length,
    },
  };
}

export type WorkspaceSnapshot = Awaited<ReturnType<typeof readWorkspace>> & { canReview: boolean; paused: boolean };
