/** AVGAR in-app Content commands. Does not change Slack routing or keyword admission. */
import { isDeepStrictEqual } from "node:util";
import type { DbClient } from "../db/types";
import { commandId, digest } from "../commands/queue";
import { workflowFingerprint, workflowSelection } from "../commands/releaseScope";
import type { CommandActor, RoutineCommand } from "../commands/types";
import type { N8nWorkflow, RoutineSpec } from "../runtime/types";
import type { RunOptions } from "../runtime/engine";
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { CONTENT_MARKETS, CONTENT_ROUTINES, CONTENT_SEED, CONTENT_WORKFLOW_ID, CONTENT_WORKFLOW_VERSION,
  type ContentRoutineId, type ContentShadowContract } from "./contentShadowContract";
import { contentShadowSpec } from "./contentShadowSpec";
import { contentReservation, contentStartClaim, type ContentApproval } from "./contentAdmission";

export const CONTENT_PILOT_PIN = Object.freeze({
  workflowId: CONTENT_WORKFLOW_ID,
  workflowVersion: CONTENT_WORKFLOW_VERSION,
  hooksUrl: CONTENT_ROUTINES["D01-W02"].receiverUrl,
  questionsUrl: CONTENT_ROUTINES["D01-W03"].receiverUrl,
});

export function contentCommandMarket(actor: CommandActor, spec: RoutineSpec, workflow: N8nWorkflow | null): keyof typeof CONTENT_MARKETS | null {
  if (actor.channel !== "app" || actor.linkId || actor.channelBinding) return null;
  if (actor.accountId !== AVGAR_PILOT_ACCOUNT || !Number.isSafeInteger(actor.contextGeneration) || actor.contextGeneration! < 0)
    return null;
  if (spec.id !== "D01-W02" && spec.id !== "D01-W03") return null;
  const routineId = spec.id as ContentRoutineId;
  const lane = CONTENT_ROUTINES[routineId];
  if (!workflow?.active || workflow.accountId !== actor.accountId || workflow.routineId !== spec.id || workflow.webhookUrl !== lane.receiverUrl)
    return null;
  const node = spec.nodes.find(n => n.kind === "n8n");
  const contract = node?.kind === "n8n" ? node.shadowContract : undefined;
  if (!contract || contract.contract !== "unc.content-search-shadow.v1") return null;
  const content = contract as ContentShadowContract;
  if (content.accountId !== actor.accountId || content.routineId !== spec.id || content.routineKey !== lane.routineKey
    || content.workflowId !== CONTENT_PILOT_PIN.workflowId || content.workflowVersion !== CONTENT_PILOT_PIN.workflowVersion
    || content.client.id !== "avgar" || content.client.primaryDomain !== "avgarsport.com"
    || content.client.seedKeyword !== CONTENT_SEED || content.client.languageCode !== "en")
    return null;
  const market = (Object.keys(CONTENT_MARKETS) as (keyof typeof CONTENT_MARKETS)[])
    .find(m => CONTENT_MARKETS[m] === content.client.locationCode);
  if (!market || !isDeepStrictEqual(spec, contentShadowSpec(content, spec.version))) return null;
  return market;
}

export function contentCommandApproval(command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null, now: Date): ContentApproval {
  const market = contentCommandMarket(command.actor, spec, workflow);
  const created = Date.parse(command.createdAt);
  if (!market || command.id !== commandId(command.actor) || command.contextGeneration !== command.actor.contextGeneration
    || command.status !== "running" || command.runId !== command.id || command.routineId !== spec.id
    || command.version !== spec.version || command.specHash !== digest(spec)
    || command.workflowHash !== workflowFingerprint(workflow)
    || !Number.isFinite(created) || created > now.getTime() || command.requestHash !== digest(command.request))
    throw new Error("Original claimed content command and reviewed selection required");
  const approval: ContentApproval = {
    authorizedBy: command.actor.userId, approvalReference: `content-command:${command.id}`,
    idempotencyKey: `content-command:${command.id}`, market, routineId: spec.id as ContentRoutineId,
    contextGeneration: command.contextGeneration, maxProviderCalls: 1,
    expiresAt: new Date(created + 600_000).toISOString(),
  };
  if (Date.parse(approval.expiresAt) <= now.getTime()) throw new Error("Content command allowance has expired");
  return approval;
}

export function contentCommandRunOptions(db: DbClient, command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null,
  now: () => Date = () => new Date()): RunOptions {
  const approval = contentCommandApproval(command, spec, workflow, now());
  return { mode: "dry_run", runId: command.id,
    reserveContentShadowRun: contentReservation(db, approval, now, { id: command.id, workflowJson: JSON.stringify(workflowSelection(workflow)) }),
    claimContentShadowStart: contentStartClaim(db) };
}
