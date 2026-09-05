import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { availabilityCopy, canEnable, routineAvailability } from "../runtime/availability";
import { effectiveSpec } from "../runtime/versioning";
import type { Store } from "../runtime/store/interface";
import type { N8nWorkflow, RoutineSpec } from "../runtime/types";
import type { BusinessModel } from "../unc/businessType";
import { commandId, digest } from "./queue";
import type { Capability, Interpreter } from "./interpret";
import type { CommandActor, CommandQueue, DispatchReply } from "./types";
import { assertSameRuntimeContext, runtimeGeneration } from "../runtime/contextFence";
import { freezeCommandActor } from "./binding";
import { workflowFingerprint } from "./releaseScope";
export { workflowFingerprint } from "./releaseScope";

export interface DispatchDeps {
  store: Store;
  queue: CommandQueue;
  isOwner(actor: CommandActor): Promise<boolean>;
  assertContext(accountId: string, generation: number): Promise<void>;
  connected(accountId: string): Promise<string[]>;
  business(accountId: string): Promise<BusinessModel | null>;
  budget(accountId: string): Promise<boolean>;
  interpret: Interpreter;
  selectionReleased(actor: CommandActor, spec: RoutineSpec, workflow: N8nWorkflow | null): boolean;
  now?: () => Date;
}

export async function eligible(deps: DispatchDeps, actor: CommandActor, routineId: string): Promise<{ ok: true; spec: RoutineSpec; workflow: N8nWorkflow | null } | { ok: false; reply: string }> {
  if (!await deps.isOwner(actor)) return { ok: false, reply: "Only the verified account owner can start a routine. Nothing was started." };
  const catalog = CATALOG_SPEC_BY_ID[routineId];
  if (!catalog) return { ok: false, reply: "That routine is not in the supported library. Nothing was started." };
  const state = await deps.store.getRoutineState(actor.accountId, routineId);
  if (!state?.enabled) return { ok: false, reply: `${catalog.name} is switched off. Enable it in Routines before asking me to run it.` };
  if (routineId === "D03-W01") return { ok: false, reply: "Keyword requests still need the customer authorization connection. This routine requires a separate one-use allowance; nothing was started." };
  const spec = effectiveSpec(state, catalog);
  const workflow = await deps.store.findN8nWorkflow(actor.accountId, routineId);
  if (!deps.selectionReleased(actor, spec, workflow)) return { ok: false, reply: `${catalog.name} is not released for requests on this account and channel yet. Nothing was started.` };
  const [connected, business] = await Promise.all([deps.connected(actor.accountId), deps.business(actor.accountId)]);
  const availability = routineAvailability(spec, connected, business);
  if (!canEnable(availability)) return { ok: false, reply: `${catalog.name}: ${availabilityCopy(availability)}. Nothing was started.` };
  if (!await deps.budget(actor.accountId)) return { ok: false, reply: "I can’t start this within the account’s verified model budget. Nothing was started." };
  return { ok: true, spec, workflow };
}

/** null means ordinary conversation. Anything uncertain stays non-executable. */
export async function dispatchMessage(deps: DispatchDeps, actor: CommandActor, text: string): Promise<DispatchReply | null> {
  actor = freezeCommandActor(actor);
  const contextGeneration = runtimeGeneration(actor.contextGeneration);
  if (!actor.accountId || !actor.userId || !actor.requestId || actor.requestId.length > 200 || !text.trim() || text.length > 4000) return { reply: "I need a valid signed-in request before I can start work." };
  if (!await deps.isOwner(actor)) return { reply: "Only the verified account owner can request work here. Nothing was started." };
  const guard = () => deps.assertContext(actor.accountId, contextGeneration);
  await guard();
  const id = commandId(actor);
  const prior = await deps.queue.get(actor.accountId, id);
  await guard();
  if (prior) {
    assertSameRuntimeContext({ accountId: actor.accountId, contextGeneration }, { accountId: prior.actor.accountId, contextGeneration: prior.contextGeneration });
    return prior.requestHash === digest(text) ? { reply: prior.reply, commandId: id, status: prior.status } : { reply: "That message ID was already used for different content. Nothing new was started." };
  }
  const states = await deps.store.listRoutineStates(actor.accountId);
  const capabilities: Capability[] = CATALOG_SPECS.map((s) => ({ id: s.id, name: s.name, purpose: s.minimum?.summary ?? s.name, enabled: states.some((r) => r.routineId === s.id && r.enabled) }));
  await guard();
  const intent = await deps.interpret(text, capabilities);
  await guard();
  if (intent.kind === "chat") return null;
  if (intent.kind !== "run") return { reply: "Which routine would you like me to run with its saved settings? I can prepare a draft or analysis; I haven’t started anything or changed your switches." };
  const check = await eligible(deps, actor, intent.routineId);
  await guard();
  if (!check.ok) return { reply: check.reply };
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const saved = await deps.queue.enqueue({ id, actor, contextGeneration, requestHash: digest(text), routineId: check.spec.id, specHash: digest(check.spec), workflowHash: workflowFingerprint(check.workflow), version: check.spec.version, request: text, status: "queued", reply: `I’ve queued ${check.spec.name} using its saved settings, in draft-only mode. It hasn’t completed yet; you can check its progress in Unc.`, runId: null, createdAt: at, updatedAt: at });
  await guard();
  return { reply: saved.reply, commandId: saved.id, status: saved.status };
}
