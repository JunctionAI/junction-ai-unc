import { isDeepStrictEqual } from "node:util";
import type { DbClient } from "../db/types";
import { commandId, digest } from "../commands/queue";
import { workflowFingerprint, workflowSelection } from "../commands/releaseScope";
import type { CommandActor, RoutineCommand } from "../commands/types";
import type { N8nWorkflow, RoutineSpec } from "../runtime/types";
import type { RunOptions } from "../runtime/engine";
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { keywordShadowSpec } from "./keywordShadowSpec";
import { KEYWORD_PILOT_MARKETS, KEYWORD_PILOT_PIN, keywordPilotContract, keywordPilotReservation, keywordPilotStartClaim, type KeywordPilotApproval } from "./keywordAdmission";

/** No country, seed, owner, URL or allowance comes from model-generated arguments.
 * The routine's stored, reviewed spec chooses ONE market for this command. */
export function keywordCommandMarket(actor: CommandActor, spec: RoutineSpec, workflow: N8nWorkflow | null): keyof typeof KEYWORD_PILOT_MARKETS | null {
  if (actor.channel !== "app" || actor.accountId !== AVGAR_PILOT_ACCOUNT || actor.linkId || actor.channelBinding ||
      !Number.isSafeInteger(actor.contextGeneration) || actor.contextGeneration! < 0 || spec.id !== "D03-W01" || spec.version !== 2 ||
      !workflow?.active || workflow.accountId !== actor.accountId || workflow.routineId !== spec.id || workflow.webhookUrl !== KEYWORD_PILOT_PIN.receiverUrl)
    return null;
  const node = spec.nodes.find(n => n.kind === "n8n");
  if (!node || node.kind !== "n8n" || !node.shadowContract) return null;
  const contract = node.shadowContract;
  const market = (Object.keys(KEYWORD_PILOT_MARKETS) as (keyof typeof KEYWORD_PILOT_MARKETS)[]).find(m => KEYWORD_PILOT_MARKETS[m] === contract.client?.locationCode);
  if (!market || !isDeepStrictEqual(contract, { contract: "unc.keyword-shadow.v1", accountId: actor.accountId,
      routineId: spec.id, routineKey: "keyword_opportunity", workflowId: KEYWORD_PILOT_PIN.workflowId, workflowVersion: KEYWORD_PILOT_PIN.workflowVersion,
      client: { id: "avgar", primaryDomain: "avgarsport.com", seedKeyword: "golf travel bag", locationCode: KEYWORD_PILOT_MARKETS[market], languageCode: "en" } }) ||
      !isDeepStrictEqual(spec, keywordShadowSpec(contract, 2))) return null;
  return market;
}

export function keywordCommandApproval(command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null, now: Date): KeywordPilotApproval {
  const market = keywordCommandMarket(command.actor, spec, workflow);
  const created = Date.parse(command.createdAt);
  if (!market || command.id !== commandId(command.actor) || command.contextGeneration !== command.actor.contextGeneration ||
      command.status !== "running" || command.runId !== command.id || command.routineId !== spec.id || command.version !== spec.version ||
      command.specHash !== digest(spec) || command.workflowHash !== workflowFingerprint(workflow) ||
      !Number.isFinite(created) || created > now.getTime() || command.requestHash !== digest(command.request))
    throw new Error("Original claimed keyword command and reviewed selection required");
  const approval: KeywordPilotApproval = { authorizedBy: command.actor.userId, approvalReference: `keyword-command:${command.id}`,
    idempotencyKey: `keyword-command:${command.id}`, market, contextGeneration: command.contextGeneration,
    maxProviderCalls: 1, expiresAt: new Date(created + 600_000).toISOString() };
  keywordPilotContract(approval, now); // Fixed expiry: never renewed on delayed consumption or redelivery.
  return approval;
}

export function keywordCommandRunOptions(db: DbClient, command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null,
  now: () => Date = () => new Date()): RunOptions {
  const approval = keywordCommandApproval(command, spec, workflow, now());
  const binding = { id: command.id, workflowJson: JSON.stringify(workflowSelection(workflow)) };
  return { mode: "dry_run", runId: command.id, reserveKeywordShadowRun: keywordPilotReservation(db, approval, now, binding),
    claimKeywordShadowStart: keywordPilotStartClaim(db, binding) };
}
