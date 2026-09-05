import type { DbClient } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import type { Store } from "../runtime/store/interface";
import { effectiveSpec } from "../runtime/versioning";
import type { RoutineCommand } from "./types";
import { commandOwner } from "./deps";
import { digest } from "./queue";
import { commandSelectionReleased, workflowFingerprint } from "./releaseScope";

/** Recheck before each runtime step and persistence boundary. An in-flight network
 * request cannot be recalled, but revocation stops subsequent work/acceptance. */
export async function assertCommandSelection(db: DbClient, store: Store, command: RoutineCommand): Promise<void> {
  const identity = { accountId: command.actor.accountId, contextGeneration: command.contextGeneration };
  await assertRuntimeContext(db, identity);
  const catalog = CATALOG_SPEC_BY_ID[command.routineId];
  if (!catalog || !await commandOwner(db, command.actor)) throw new Error("Command owner or routine is no longer available.");
  const [state, workflow] = await Promise.all([
    store.getRoutineState(identity.accountId, command.routineId),
    store.findN8nWorkflow(identity.accountId, command.routineId),
  ]);
  if (!state?.enabled) throw new Error("Routine was switched off; further command work stopped.");
  const spec = effectiveSpec(state, catalog);
  if (spec.version !== command.version || digest(spec) !== command.specHash || workflowFingerprint(workflow) !== command.workflowHash ||
      !commandSelectionReleased(command.actor, spec, workflow))
    throw new Error("Command settings or rollout changed; further work stopped. Inspect the original request before retrying.");
  await assertRuntimeContext(db, identity);
}
