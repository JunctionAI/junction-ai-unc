/* RefusingExecutor — the ONLY Executor this worker ships.

   Every mutation is answered with ok:false and a not_implemented reason, so
   even if a live run somehow reached an execute node with an approved gate
   the platform would not be touched and the run fails closed with a receipt
   saying why. Real executors (ad budgets, publishing, flow edits) are Wave 2
   and founder-gated — see src/worker/README.md. */

import type { ExecuteNode, ExecutionResult, Executor, Mutation, RunContext } from "../../lib/runtime/types";

export const NOT_IMPLEMENTED_REASON = "not_implemented — mutations are Wave 2, founder-gated";

export class RefusingExecutor implements Executor {
  /** Every refusal, for tests and audits. */
  readonly refused: { action: string; platform: string; runId: string }[] = [];

  async execute(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<ExecutionResult> {
    this.refused.push({ action: mutation.action, platform: node.platform, runId: ctx.runId });
    return {
      ok: false,
      error: NOT_IMPLEMENTED_REASON,
      readback: { refused: true, reason: NOT_IMPLEMENTED_REASON, action: mutation.action, platform: node.platform },
    };
  }
}
