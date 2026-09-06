import { z } from "zod";
import { digest } from "../commands/queue";
import type { DbClient } from "../db/types";
import { assertSameRuntimeContext, runtimeGeneration } from "../runtime/contextFence";
import { runRoutine } from "../runtime/engine";
import type { Store } from "../runtime/store/interface";
import type { RoutineSpec, RunResult } from "../runtime/types";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { buildAdapters, type ServiceDeps } from "../../worker/service";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const inputs = z.record(z.string(), z.string().max(4_000)).refine(
  (value) => Object.keys(value).length <= 12 && Object.keys(value).every((key) => /^[a-z][a-z0-9_]{0,63}$/.test(key)),
  "Invalid preview inputs.",
);

export const opsDraftPreviewBody = z.object({
  accountId: uuid,
  contextGeneration: z.number().int().nonnegative(),
  requestId: uuid,
  routineId: z.string().regex(/^D0[1-5]-W[0-9]{2}$/),
  inputs,
}).strict();
export type OpsDraftPreviewBody = z.infer<typeof opsDraftPreviewBody>;

const authorizationSchema = z.object({
  requestId: uuid,
  accountId: uuid,
  contextGeneration: z.number().int().nonnegative(),
  routineId: z.string(),
  requestedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  automationPaused: z.boolean(),
}).strict();

export class OpsDraftPreviewError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/** Preview lane is deliberately smaller than ordinary dry-run: one built-in producer,
 * no workflow handoff and no execute node. A gate is only a receipt in dry-run mode. */
export function isSafeOpsDraftPreview(spec: RoutineSpec): boolean {
  return !spec.mutates
    && spec.nodes.filter((node) => node.kind === "trigger").length === 1
    && spec.nodes.some((node) => node.kind === "trigger" && node.cadence === "manual")
    && spec.nodes.filter((node) => node.kind === "produce").length === 1
    && !spec.nodes.some((node) => node.kind === "n8n" || node.kind === "execute");
}

async function savedResult(store: Store, body: OpsDraftPreviewBody): Promise<RunResult | null> {
  const run = await store.getRun(body.requestId);
  if (!run) return null;
  if (run.accountId !== body.accountId || run.contextGeneration !== body.contextGeneration
    || run.routineId !== body.routineId || run.mode !== "dry_run")
    throw new OpsDraftPreviewError("That preview request ID belongs to different work.", 409);
  const [receipts, artifacts] = await Promise.all([
    store.listReceipts(body.accountId, { runId: run.id, limit: 500 }),
    store.listArtifacts(body.accountId, { runId: run.id, contextGeneration: body.contextGeneration, limit: 1 }),
  ]);
  return { runId: run.id, routineId: run.routineId, version: run.version, mode: run.mode,
    status: run.status, summary: run.summary ?? "Preview is still running; inspect this request instead of starting another.",
    receipts, ...(artifacts[0] ? { artifact: artifacts[0] } : {}), ...(run.snapshot?.needs ? { needs: run.snapshot.needs } : {}) };
}

export async function executeOpsDraftPreview(db: DbClient, userId: string, body: OpsDraftPreviewBody,
  deps: ServiceDeps & { store: Store }): Promise<RunResult> {
  const spec = CATALOG_SPEC_BY_ID[body.routineId];
  if (!spec || !isSafeOpsDraftPreview(spec))
    throw new OpsDraftPreviewError("Only a built-in, manual, non-mutating draft routine can use operator preview.", 400);

  const authorize = async () => {
    const { data, error } = await db.rpc("authorize_ops_draft_preview", {
      p_user_id: userId, p_account_id: body.accountId, p_context_generation: body.contextGeneration,
      p_request_id: body.requestId, p_routine_id: body.routineId,
      p_spec_hash: digest(spec), p_inputs_hash: digest(body.inputs),
    });
    if (error) throw new OpsDraftPreviewError(
      error.code === "42501" ? "Separate, unexpired operator draft-preview access is required for this client."
        : error.code === "40001" ? "Client context changed. Refresh before previewing."
          : error.code === "22023" ? "That preview request ID or contract no longer matches."
            : "Draft preview authorization could not be verified.",
      error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "40001" ? 409 : 503,
    );
    const parsed = authorizationSchema.safeParse(data);
    if (!parsed.success || parsed.data.requestId !== body.requestId || parsed.data.accountId !== body.accountId
      || parsed.data.contextGeneration !== body.contextGeneration || parsed.data.routineId !== body.routineId)
      throw new OpsDraftPreviewError("Draft preview authorization could not be verified.", 503);
    return parsed.data;
  };

  await authorize();
  const existing = await savedResult(deps.store, body);
  if (existing) return existing;
  const account = await deps.accounts.getAccount(body.accountId);
  if (!account || account.account.accountId !== body.accountId)
    throw new OpsDraftPreviewError("Client account is unavailable.", 404);
  assertSameRuntimeContext({ accountId: body.accountId, contextGeneration: body.contextGeneration }, account.account);
  const base = buildAdapters(deps);
  const adapters = { ...base, assertContext: async (current: Parameters<NonNullable<typeof base.assertContext>>[0]) => {
    assertSameRuntimeContext({ accountId: body.accountId, contextGeneration: body.contextGeneration }, current);
    await base.assertContext?.(current);
    await authorize();
  } };
  try {
    return await runRoutine(spec, { account: { ...account.account, contextGeneration: runtimeGeneration(account.account.contextGeneration) },
      triggeredBy: "manual", vars: account.vars ?? {}, inputs: body.inputs }, adapters, { mode: "dry_run", runId: body.requestId });
  } catch (error) {
    // The run row is the atomic execution claim. A concurrent or lost response is read,
    // never restarted. An unfinished saved run remains honestly running.
    const raced = await savedResult(deps.store, body);
    if (raced) return raced;
    throw error;
  }
}
