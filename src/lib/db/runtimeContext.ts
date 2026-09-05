import { unwrap, type DbClient } from "./types";
import { assertSameRuntimeContext, runtimeGeneration, RuntimeContextError, type RuntimeContextIdentity } from "../runtime/contextFence";
import { AUTOMATION_PAUSED_MESSAGE } from "./automationPause";

/** Re-check before provider work. Atomic persistence fencing is enforced by SQL triggers;
 * this read is not a lock held across network/model calls or a substitute for those triggers. */
export async function assertRuntimeContext(db: DbClient, expected: RuntimeContextIdentity): Promise<void> {
  runtimeGeneration(expected.contextGeneration);
  let row: { context_generation: unknown; automation_paused: unknown } | null;
  try {
    row = await unwrap("accounts.runtime_context", db.from("accounts").select("context_generation, automation_paused").eq("id", expected.accountId).maybeSingle());
  } catch {
    throw new RuntimeContextError("context_unavailable", "Could not verify the run's business context. Nothing further was accepted.");
  }
  if (!row || row.context_generation == null || typeof row.automation_paused !== "boolean")
    throw new RuntimeContextError("context_unavailable", "The account's runtime controls are unavailable.");
  assertSameRuntimeContext(expected, { accountId: expected.accountId, contextGeneration: runtimeGeneration(row.context_generation) });
  if (row.automation_paused) throw new RuntimeContextError("automation_paused", AUTOMATION_PAUSED_MESSAGE);
}
