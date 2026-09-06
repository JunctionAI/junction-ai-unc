import type { N8nWorkflow, RoutineSpec, RunResult } from "../runtime/types";
import type { RunRecord } from "../runtime/store/interface";
import { digest } from "./queue";
import { eligible, workflowFingerprint, type DispatchDeps } from "./dispatch";
import type { RoutineCommand, CommandStatus } from "./types";
import { runtimeGeneration, RuntimeContextError } from "../runtime/contextFence";
import { freezeCommandActor } from "./binding";
import { savedResultReply } from "./resultReply";

export interface ProcessorDeps extends DispatchDeps {
  execute(command: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null): Promise<RunResult>;
}

async function contextActive(guard: () => Promise<void>): Promise<boolean> {
  try { await guard(); return true; }
  catch (error) {
    if (error instanceof RuntimeContextError && error.code !== "context_unavailable") return false;
    // A storage outage is not an empty/healthy queue. Surface it to worker health.
    throw error;
  }
}

/** No unchecked run summaries or model claims in completion messages. Artifacts stay in Unc. */
export function commandResult(run: Pick<RunRecord, "status">): { status: CommandStatus; reply: string } {
  if (run.status === "running") return { status: "waiting", reply: "The workflow is still running. No completed result has been received yet." };
  if (run.status === "waiting_input") return { status: "waiting", reply: "This routine needs more information. Open its run in Unc to see the specific request; nothing was published or changed." };
  if (run.status === "waiting_approval") return { status: "waiting", reply: "The routine has a proposal ready for review in Unc. Nothing was applied to your connected platforms." };
  if (run.status === "done") return { status: "done", reply: "The draft-only run finished. Its result and source receipts are in Unc; no live changes were authorised." };
  if (run.status === "skipped") return { status: "done", reply: "The routine finished without further work. Its reason and receipts are in Unc." };
  return { status: "failed", reply: "The routine did not complete successfully. Check its run receipts in Unc before trying again." };
}

export async function processCommand(deps: ProcessorDeps, command: RoutineCommand): Promise<void> {
  command = Object.freeze({ ...command, actor: freezeCommandActor(command.actor) });
  const guard = () => deps.assertContext(command.actor.accountId, runtimeGeneration(command.contextGeneration));
  // Old work remains old history. Never rewrite it as a result in the new context.
  if (!await contextActive(guard)) return;
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  let claimed: RoutineCommand | null;
  try {
    claimed = await deps.queue.transition(command, "queued", { status: "running", runId: command.id, reply: "The worker has picked up your request. No completed result yet.", updatedAt: now() });
  } catch (error) {
    if (!await contextActive(guard)) return;
    throw error;
  }
  if (!claimed) return;
  claimed = Object.freeze({ ...claimed, actor: freezeCommandActor(claimed.actor) });
  // Save the deterministic run ID BEFORE dispatch. Never replay a claimed request after a
  // crash: its provider call may have happened even if the response was lost.
  let started = false;
  try {
    await guard();
    const check = await eligible(deps, claimed.actor, claimed.routineId);
    await guard();
    if (!check.ok) {
      await deps.queue.transition(claimed, "running", { status: "blocked", reply: check.reply, updatedAt: now() });
      return;
    }
    if (digest(check.spec) !== claimed.specHash || workflowFingerprint(check.workflow) !== claimed.workflowHash) {
      await deps.queue.transition(claimed, "running", { status: "blocked", reply: "The routine or workflow changed while this request was queued. Please review its settings and send a new request.", updatedAt: now() });
      return;
    }
    const existing = await deps.store.getRun(claimed.id);
    await guard();
    if (existing) {
      await deps.queue.transition(claimed, "running", { status: "uncertain", reply: "This request already has a run record. I won’t dispatch it again; check the existing run in Unc.", updatedAt: now() });
      return;
    }
    started = true;
    const result = await deps.execute(claimed, check.spec, check.workflow);
    await guard();
    if (result.runId !== claimed.id || result.mode !== "dry_run") throw new Error("Unexpected execution identity or mode");
    const next = commandResult(result);
    if (next.status === "done") next.reply = await savedResultReply(deps.store, claimed, next.reply);
    await guard();
    await deps.queue.transition(claimed, "running", { ...next, updatedAt: now() });
  } catch {
    if (!await contextActive(guard)) return;
    await deps.queue.transition(claimed, "running", { status: started ? "uncertain" : "blocked", reply: started ? "I can’t confirm the execution outcome. I won’t automatically run it again; check its run in Unc first." : "I couldn’t verify the account, connections or budget. Nothing was started.", updatedAt: now() });
  }
}

/** Reconcile callbacks and interrupted workers without repeating provider calls. */
export async function reconcileCommand(deps: DispatchDeps, c: RoutineCommand): Promise<void> {
  c = Object.freeze({ ...c, actor: freezeCommandActor(c.actor) });
  const guard = () => deps.assertContext(c.actor.accountId, runtimeGeneration(c.contextGeneration));
  if (!await contextActive(guard)) return;
  const now = (deps.now ?? (() => new Date()))();
  const run = c.runId ? await deps.store.getRun(c.runId) : null;
  if (!await contextActive(guard)) return;
  if (run && (run.accountId !== c.actor.accountId || run.routineId !== c.routineId || runtimeGeneration(run.contextGeneration) !== c.contextGeneration)) return;
  if (run && run.status !== "running") {
    const next = commandResult(run);
    if (next.status === "done") next.reply = await savedResultReply(deps.store, c, next.reply);
    if (!await contextActive(guard)) return;
    await deps.queue.transition(c, c.status, { ...next, updatedAt: now.toISOString() });
  } else if (c.status === "running" && now.getTime() - new Date(c.updatedAt).getTime() > 10 * 60_000) {
    await deps.queue.transition(c, "running", { status: "uncertain", reply: "The worker was interrupted or is taking longer than expected. I won’t repeat this request automatically; check its run in Unc.", updatedAt: now.toISOString() });
  } else if (c.status !== "running") {
    // Round-robin reconciliation: old waiting-input runs must not starve new callbacks.
    await deps.queue.transition(c, c.status, { updatedAt: now.toISOString() });
  }
}
