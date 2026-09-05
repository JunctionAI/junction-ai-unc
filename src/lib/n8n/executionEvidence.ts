/* Server-only projection of the public API's saved execution, never the current workflow.
 * Raw node output, headers and credentials must not escape this module as receipts/logs. */
import { createHash } from "node:crypto";
import type { ShadowExecutionObservation } from "./shadowContract";

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max = 128): v is string => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim();
const fail = (code: string): never => { throw new Error(`n8n execution evidence rejected: ${code}`); };

/** JSON wire values only. Excludes the expiring bearer token, not any business input.
 * Key sorting survives JSON parsing/reordering in the webhook node. */
export function shadowRequestDigest(value: unknown): string {
  const body = object(value);
  if (!body) return fail("request_body");
  const publicBody = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "dataToken"));
  const canonical = (v: unknown, depth = 0): string => {
    if (depth > 64) return fail("request_depth");
    if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(x => canonical(x, depth + 1)).join(",")}]`;
    const row = object(v);
    if (!row) return fail("request_value");
    return `{${Object.keys(row).sort().map(k => `${JSON.stringify(k)}:${canonical(row[k], depth + 1)}`).join(",")}}`;
  };
  return createHash("sha256").update(canonical(publicBody)).digest("hex");
}

export interface ExecutionEvidenceBinding { workflowId: string; executionId: string; triggerNodeId: string }

export function projectShadowExecution(value: unknown, binding: ExecutionEvidenceBinding): ShadowExecutionObservation {
  const row = object(value);
  if (!row || row.id !== binding.executionId || row.workflowId !== binding.workflowId) return fail("execution_identity");
  if (row.status !== "success" || row.finished !== true || row.mode !== "webhook" || row.retryOf != null) return fail("execution_status");
  if (row.dataTooLargeToDisplay === true) return fail("execution_truncated");
  const snapshot = object(row.workflowData), data = object(row.data);
  if (!snapshot || !data || object(data.redactionInfo)?.isRedacted === true) return fail("execution_data_unavailable");
  if (snapshot.id !== undefined && snapshot.id !== binding.workflowId) return fail("snapshot_identity");
  const current = row.workflowVersionId, legacy = snapshot.versionId;
  if (current != null && !text(current)) return fail("revision_invalid");
  if (legacy != null && !text(legacy)) return fail("revision_invalid");
  if (text(current) && text(legacy) && current !== legacy) return fail("revision_conflict");
  const revision = current ?? legacy;
  if (!text(revision)) return fail("revision_missing");
  // Resolve the exact pinned node's name from this execution's own saved snapshot.
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes.map(object) : [];
  if (nodes.some(n => typeof n?.type === "string" && /\.(executeWorkflow|toolWorkflow)$/.test(n.type))) return fail("child_execution_provenance_required");
  const matches = nodes.filter(n => n?.id === binding.triggerNodeId);
  const trigger = matches.length === 1 ? matches[0] : null;
  if (!trigger || trigger.type !== "n8n-nodes-base.webhook" || trigger.disabled === true || !text(trigger.name, 200)) return fail("trigger_binding");
  if (nodes.filter(n => n?.name === trigger.name).length !== 1) return fail("trigger_ambiguous");
  const result = object(data.resultData);
  if (!result || result.error != null) return fail("execution_error");
  const runs = object(result.runData)?.[trigger.name];
  if (!Array.isArray(runs) || runs.length !== 1) return fail("trigger_runs");
  const task = object(runs[0]);
  if (!task || task.error != null || (task.executionStatus !== undefined && task.executionStatus !== "success")) return fail("trigger_status");
  const main = object(task.data)?.main;
  if (!Array.isArray(main) || main.length !== 1 || !Array.isArray(main[0]) || main[0].length !== 1) return fail("trigger_items");
  const body = object(object(object(main[0][0])?.json)?.body);
  if (!body || body.mode !== "dry_run" || !text(body.accountId) || !text(body.runId, 200) || !text(body.routineId)) return fail("trigger_request");
  const started = Date.parse(String(row.startedAt)), stopped = Date.parse(String(row.stoppedAt));
  if (!text(row.startedAt) || !text(row.stoppedAt) || !Number.isFinite(started) || !Number.isFinite(stopped) || stopped < started) return fail("execution_timing");
  return {
    source: "n8n_execution_record", executionId: binding.executionId, workflowId: binding.workflowId,
    workflowVersion: revision, status: "success", finished: true,
    startedAt: row.startedAt, stoppedAt: row.stoppedAt,
    request: { accountId: body.accountId, runId: body.runId, routineId: body.routineId },
    requestDigest: shadowRequestDigest(body),
  };
}
