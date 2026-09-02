/* account_model_prefs — the founder's per-task model choice (migration 0008).
   Read with whatever client the caller has (member RLS or service role). */

import type { DbClient } from "../db/types";
import { unwrap } from "../db/types";
import { LLM_TASKS, type LlmTask } from "./types";

export const isLlmTask = (v: unknown): v is LlmTask => typeof v === "string" && (LLM_TASKS as readonly string[]).includes(v);

export async function readModelPref(db: DbClient, accountId: string, task: LlmTask): Promise<string | null> {
  const row = await unwrap<{ model_id: string } | null>("account_model_prefs.get", db.from("account_model_prefs").select("model_id").eq("account_id", accountId).eq("task", task).maybeSingle());
  return row?.model_id ?? null;
}

export async function listModelPrefs(db: DbClient, accountId: string): Promise<Partial<Record<LlmTask, string>>> {
  const rows = await unwrap<{ task: string; model_id: string }[]>("account_model_prefs.list", db.from("account_model_prefs").select("task, model_id").eq("account_id", accountId));
  const out: Partial<Record<LlmTask, string>> = {};
  for (const r of rows ?? []) if (isLlmTask(r.task)) out[r.task] = r.model_id;
  return out;
}

/** null modelId = back to the default (row deleted). */
export async function writeModelPref(db: DbClient, accountId: string, task: LlmTask, modelId: string | null, now = new Date()): Promise<void> {
  if (modelId === null) {
    await unwrap("account_model_prefs.delete", db.from("account_model_prefs").delete().eq("account_id", accountId).eq("task", task));
    return;
  }
  await unwrap("account_model_prefs.upsert", db.from("account_model_prefs").upsert({ account_id: accountId, task, model_id: modelId, updated_at: now.toISOString() }, { onConflict: "account_id,task" }));
}
