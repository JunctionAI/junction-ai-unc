/* Shared shaping for the /api/routines/* handlers. */

import type { RunResult } from "@/lib/runtime/types";
import type { WorkerError } from "@/worker/service";

export function summariseRun(r: RunResult) {
  return {
    runId: r.runId,
    routineId: r.routineId,
    version: r.version,
    mode: r.mode,
    status: r.status,
    summary: r.summary,
    error: r.error ?? null,
    approval: r.approval ?? null,
    receipts: r.receipts.map((x) => ({ id: x.id, kind: x.kind, platform: x.platform ?? null, description: x.description, payload: x.payload, spend: x.spend ?? null, createdAt: x.createdAt })),
  };
}

export function workerErrorStatus(err: WorkerError): number {
  switch (err.code) {
    case "live_mode_disabled":
      return 403;
    case "unknown_account":
    case "unknown_routine":
      return 404;
    default:
      return 400;
  }
}
