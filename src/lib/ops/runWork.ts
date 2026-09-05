import { z } from "zod";

export const opsUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform(s => s.toLowerCase());
const date = z.string().refine(s => Number.isFinite(Date.parse(s)));
const text = z.string().nullable();
const execution = z.object({ workflowId: text, workflowVersion: text, executionId: text,
  revisionEvidence: text, status: text, executedAction: text, verifiedAt: text }).nullable();
// Zod objects strip unknown fields at every level: no raw metadata crosses the API.
export const opsRunWorkSchema = z.object({
  checkedAt: date, auditId: opsUuid, accountId: opsUuid, contextGeneration: z.number().int().nonnegative(),
  run: z.object({ id: opsUuid, accountId: opsUuid, routineId: z.string(), version: z.number().int(),
    mode: z.string(), status: z.string(), startedAt: date, finishedAt: date.nullable() }),
  artifacts: z.array(z.object({ id: opsUuid, runId: opsUuid, kind: z.string(), title: z.string(), body: z.string(),
    editedBody: text, status: z.string(), revision: z.number().int(), createdAt: date,
    items: z.array(z.object({ title: text, body: text })), evidence: z.array(z.object({ source: text, ref: text })), execution })).max(20),
  receipts: z.array(z.object({ id: opsUuid, runId: opsUuid, kind: z.string(), platform: text,
    description: z.string(), createdAt: date, execution })).max(50),
  artifactAfter: opsUuid.nullable(), receiptAfter: opsUuid.nullable(), hasMore: z.boolean(),
});
export type OpsRunWork = z.infer<typeof opsRunWorkSchema>;
export function parseOpsRunWork(value: unknown, accountId: string, runId: string, generation?: number) {
  const parsed = opsRunWorkSchema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.accountId !== accountId || r.run.accountId !== accountId || r.run.id !== runId
    || (generation !== undefined && generation !== r.contextGeneration)
    || [...r.artifacts, ...r.receipts].some(x => x.runId !== runId)
    || new Set(r.artifacts.map(x => x.id)).size !== r.artifacts.length
    || new Set(r.receipts.map(x => x.id)).size !== r.receipts.length
    || (r.artifacts.length && r.artifactAfter !== r.artifacts.at(-1)?.id)
    || (r.receipts.length && r.receiptAfter !== r.receipts.at(-1)?.id)
    || (r.hasMore && !r.artifacts.length && !r.receipts.length)) return null;
  return r;
}
