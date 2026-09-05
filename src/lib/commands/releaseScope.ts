import { isChannel, type MessageChannel } from "../channels/types";
import type { N8nWorkflow, RoutineSpec } from "../runtime/types";
import type { CommandActor } from "./types";
import { digest } from "./queue";

/** Server-owned rollout configuration, not customer permission or a provider allowance.
 * No wildcards: one client's one revision never enables the entire catalog.
 * Owner, switch, connector, budget and provider admission checks still apply. */
export interface CommandReleaseScope {
  accountId: string;
  contextGeneration: number;
  channel: MessageChannel;
  routineId: string;
  specHash: string;
  workflowHash: string;
  expiresAt: string;
}
const fields = ["accountId", "contextGeneration", "channel", "routineId", "specHash", "workflowHash", "expiresAt"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
export const workflowSelection = (w: N8nWorkflow | null) => w ? {
  id: w.id, accountId: w.accountId, routineId: w.routineId, webhookUrl: w.webhookUrl, active: w.active,
} : null;
export const workflowFingerprint = (w: N8nWorkflow | null) => digest(workflowSelection(w));

/** Malformed config denies the entire release, never silently drops a bad entry. */
export function commandReleaseScopes(raw: string | undefined): CommandReleaseScope[] {
  if (!raw || raw.length > 32_768) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 100) return [];
    const seen = new Set<string>();
    for (const v of value) {
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== fields.length ||
          Object.keys(v).some(k => !fields.includes(k)) || typeof v.accountId !== "string" || !uuid.test(v.accountId) ||
          !Number.isSafeInteger(v.contextGeneration) || v.contextGeneration < 0 ||
          !(v.channel === "app" || isChannel(v.channel)) || typeof v.routineId !== "string" || !/^D\d{2}-W\d{2}$/.test(v.routineId) ||
          typeof v.specHash !== "string" || !hash.test(v.specHash) || typeof v.workflowHash !== "string" || !hash.test(v.workflowHash) ||
          typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt)) || new Date(v.expiresAt).toISOString() !== v.expiresAt)
        return [];
      const key = JSON.stringify([v.accountId, v.contextGeneration, v.channel, v.routineId]);
      if (seen.has(key)) return [];
      seen.add(key);
    }
    return value;
  } catch { return []; }
}

export function commandSelectionReleased(actor: CommandActor, spec: RoutineSpec, workflow: N8nWorkflow | null,
  env: Record<string, string | undefined> = process.env, now = Date.now()): boolean {
  if (env.UNC_COMMANDS_ENABLED !== "true" || !Number.isFinite(now) ||
      !Number.isSafeInteger(actor.contextGeneration) || actor.contextGeneration! < 0 ||
      workflow && (workflow.accountId !== actor.accountId || workflow.routineId !== spec.id || !workflow.active)) return false;
  return commandReleaseScopes(env.UNC_COMMAND_RELEASE_SCOPES).some(scope =>
    scope.accountId === actor.accountId && scope.contextGeneration === actor.contextGeneration && scope.channel === actor.channel &&
    scope.routineId === spec.id && scope.specHash === digest(spec) && scope.workflowHash === workflowFingerprint(workflow) &&
    Date.parse(scope.expiresAt) > now);
}
