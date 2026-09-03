/* Cost telemetry — one llm_usage row per call (migration 0008; service-role write).
   A failed insert is logged. Account calls retain their conservative spend reservation through
   month end rather than losing the charge; unscoped calls emit the record as one JSON line. */

import type { DbClient } from "../db/types";
import { estimateCostUsd } from "./registry";
import type { LlmResult, LlmTask, ResolvedModel } from "./types";

export type LlmLog = (event: string, fields: Record<string, unknown>) => void;

/** Ledger task ids: every router task, the dev ping, and the embeddings call (src/lib/llm/embed.ts). */
export type UsageTask = LlmTask | "ping" | "embed";

export interface UsageRecord {
  account_id: string | null;
  task: UsageTask;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number | null;
  latency_ms: number;
  stop_reason: string;
  created_at: string;
}

export function usageRecord(task: UsageTask, accountId: string | null, resolved: Pick<ResolvedModel, "provider" | "model" | "inputPer1M" | "outputPer1M">, result: LlmResult, now = new Date()): UsageRecord {
  return {
    account_id: accountId,
    task,
    provider: resolved.provider,
    model: result.model || resolved.model,
    input_tokens: result.usage.input,
    output_tokens: result.usage.output,
    est_cost_usd: estimateCostUsd(resolved, result.usage),
    latency_ms: result.latencyMs,
    stop_reason: result.stopReason === "error" ? `error:${result.errorCode ?? "unknown"}` : result.stopReason,
    created_at: now.toISOString(),
  };
}

/** A durable zero-cost row is not necessarily a settled bill. Providers can accept a request,
    then time out or omit usage from an otherwise successful response. Only a non-error result
    carrying at least one reported token is strong enough to replace the conservative reservation. */
export function providerUsageIsDefinitive(result: Pick<LlmResult, "stopReason" | "usage">): boolean {
  if (result.stopReason === "error") return false;
  const { input, output } = result.usage;
  return Number.isInteger(input) && input >= 0 && Number.isInteger(output) && output >= 0 && input + output > 0;
}

export const defaultLlmLog: LlmLog = (event, fields) => {
  console.log(JSON.stringify({ event, ...fields }));
};

/** True only when the row is durable in llm_usage. Callers without a database still emit the
    legacy JSON log, but must not treat that as a durable write for reservation release. */
export async function recordUsage(rec: UsageRecord, db: DbClient | null, log: LlmLog = defaultLlmLog): Promise<boolean> {
  if (!db) {
    log("llm.usage", { ...rec });
    return false;
  }
  try {
    const { error } = await db.from("llm_usage").insert({ ...rec });
    if (error) {
      log("llm.usage_write_failed", { ...rec, error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    log("llm.usage_write_failed", { ...rec, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
