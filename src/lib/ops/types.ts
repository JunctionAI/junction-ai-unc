export interface OpsClient {
  id: string; name: string; currency: string; contextGeneration: number; paused: boolean;
  createdAt: string; website: string | null; memberCount: number; connectorCount: number;
  datedReadCount: number; enabledCount: number; pendingDraftCount: number; pendingRunApprovalCount: number;
  runCount: number; lastRunAt: string | null; failedRunCount: number; verifiedChannelCount: number; registeredWorkflowCount: number;
}
export interface OpsRun { id: string; accountId: string; routineId: string; version: number; mode: string; status: string; startedAt: string; finishedAt: string | null }
export interface OpsSourceBinding {
  id: string; accountId: string; sourceSystem: string; sourceProject: string;
  sourceKind: string; sourceKey: string; displayName: string;
  status: "verified" | "superseded"; evidenceRef: string; revision: number;
  verifiedAt: string; verifiedBy: string; sourceReadAuthorized: boolean;
}
export interface OpsDetail {
  accountId: string; contextGeneration: number;
  connectors: { id: string; platform: string; status: string; externalRef: string | null; lastReadAt: string | null; lastReadResult: string | null; lastReadMetrics: number | null }[];
  routines: { id: string; enabled: boolean; version: number; updatedAt: string }[];
  channels: { channel: string; verifiedAt: string; lastInboundAt: string | null }[];
  runs: OpsRun[];
  drafts: { id: string; runId: string; routineId: string; title: string; status: string; revision: number; createdAt: string }[];
  receipts: { id: string; runId: string; kind: string; platform: string | null; description: string; createdAt: string }[];
}
export interface OpsSnapshot { checkedAt: string; accountLimit: number; accountCount: number; historyLimit: number; clients: OpsClient[]; selected: OpsDetail | null; runs: OpsRun[] }

export const OPS_STAGES = ["Needs identity", "Needs connections", "Needs verification", "Paused", "Review runtime"] as const;
export function opsStage(c: OpsClient): typeof OPS_STAGES[number] {
  if (!c.memberCount) return "Needs identity";
  if (!c.connectorCount) return "Needs connections";
  if (!c.datedReadCount) return "Needs verification";
  if (c.paused) return "Paused";
  return "Review runtime"; // Neither toggles nor a stored read prove client acceptance.
}
export function opsNext(c: OpsClient): string {
  if (!c.memberCount) return "Codex: reconcile the existing client system and verified owner before assigning login access.";
  if (!c.connectorCount) return "Codex: locate existing grants and selected business assets before requesting new consent.";
  if (!c.datedReadCount) return "Codex: verify a selected-account read; connector rows alone do not establish working data.";
  if (c.paused) return "Codex: complete authorized shadow verification before lifting the setup pause.";
  if (!c.enabledCount) return "Codex + client: verify eligible work and choose routines; none are enabled.";
  if (!c.runCount) return "Codex: verify the first authorized routine result and receipt.";
  return "Codex: review dated outputs, ongoing sync and client acceptance; a recorded run alone is not readiness.";
}
export const opsTime = (s: string | null) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Not recorded";
