/** Chat / Slack requests for AVGAR's paid-ads shadow routines. No lane, workflow, ad account,
 * market, cap or allowance comes from model-generated arguments: the routine's stored,
 * reviewed spec pins everything, and the registered workflow must be that lane's receiver. */
import { isDeepStrictEqual } from "node:util";
import type { DbClient } from "../db/types";
import { commandId, digest } from "../commands/queue";
import { workflowFingerprint } from "../commands/releaseScope";
import type { CommandActor, RoutineCommand } from "../commands/types";
import type { N8nWorkflow, RoutineSpec } from "../runtime/types";
import type { RunOptions } from "../runtime/engine";
import { commandChannelBinding } from "../commands/binding";
import { messagingOriginAllowed, messagingBindingAllowed } from "../channels/releaseGate";
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { paidShadowReceiver, paidShadowSchema, type PaidLane, type PaidShadowContract } from "./paidShadowContract";
import { paidShadowSpec } from "./paidShadowSpec";
import { paidReservation, paidStartClaim, type PaidApproval } from "./paidAdmission";

/** The lane this command may dispatch on, or null when anything about the selection is unreviewed. */
export function paidCommandLane(actor: CommandActor, spec: RoutineSpec, workflow: N8nWorkflow | null,
  env: Record<string, string | undefined> = process.env): PaidLane | null {
  let originAllowed = actor.channel === "app" && !actor.linkId && !actor.channelBinding;
  if (actor.channel === "slack" && env.UNC_MESSAGING_PILOT_SCOPE !== undefined) {
    try {
      const binding = commandChannelBinding(actor);
      originAllowed = !!binding && messagingOriginAllowed(env, binding) && messagingBindingAllowed(env, binding);
    } catch { originAllowed = false; }
  }
  if (!originAllowed || actor.accountId !== AVGAR_PILOT_ACCOUNT || !Number.isSafeInteger(actor.contextGeneration) || actor.contextGeneration! < 0) return null;
  const node = spec.nodes[1];
  if (node?.kind !== "n8n" || !node.shadowContract || node.shadowContract.contract !== "unc.paid-ads-shadow.v1") return null;
  const parsed = paidShadowSchema.safeParse(node.shadowContract);
  if (!parsed.success) return null;
  const contract: PaidShadowContract = parsed.data;
  if (contract.accountId !== actor.accountId || contract.routineId !== spec.id || !isDeepStrictEqual(spec, paidShadowSpec(contract, spec.version))) return null;
  if (!workflow?.active || workflow.accountId !== actor.accountId || workflow.routineId !== spec.id || workflow.webhookUrl !== paidShadowReceiver(contract)) return null;
  return contract.lane;
}

export function paidCommandApproval(command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null, now: Date,
  env: Record<string, string | undefined> = process.env): PaidApproval {
  const lane = paidCommandLane(command.actor, spec, workflow, env);
  const created = Date.parse(command.createdAt);
  if (!lane || command.id !== commandId(command.actor) || command.contextGeneration !== command.actor.contextGeneration ||
      command.status !== "running" || command.runId !== command.id || command.routineId !== spec.id || command.version !== spec.version ||
      command.specHash !== digest(spec) || command.workflowHash !== workflowFingerprint(workflow) ||
      !Number.isFinite(created) || created > now.getTime() || command.requestHash !== digest(command.request))
    throw new Error("Original claimed paid-ads command and reviewed selection required");
  // Fixed expiry from the command's creation: never renewed on delayed consumption or redelivery.
  return { authorizedBy: command.actor.userId, approvalReference: `paid-command:${command.id}`, idempotencyKey: `paid-command:${command.id}`,
    contextGeneration: command.contextGeneration, lane, maxDispatches: 1, expiresAt: new Date(created + 600_000).toISOString() };
}

export function paidCommandRunOptions(db: DbClient, command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null,
  now: () => Date = () => new Date(), env: Record<string, string | undefined> = process.env): RunOptions {
  const approval = paidCommandApproval(command, spec, workflow, now(), env);
  return { mode: "dry_run", runId: command.id, reservePaidShadowRun: paidReservation(db, approval, now), claimPaidShadowStart: paidStartClaim(db) };
}
