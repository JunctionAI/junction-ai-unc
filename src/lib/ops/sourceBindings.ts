import { z } from "zod";
import type { DbClient } from "@/lib/db/types";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const sourceSystem = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/);
const sourceProject = z.string().min(2).max(100);
const sourceKind = z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/);
const sourceKey = z.string().min(1).max(200).regex(/^\S+$/);

export const sourceBindingSchema = z.object({
  id: uuid,
  accountId: uuid,
  sourceSystem,
  sourceProject,
  sourceKind,
  sourceKey,
  displayName: z.string().trim().min(1).max(200),
  status: z.enum(["verified", "superseded"]),
  evidenceRef: z.string().trim().min(10).max(500),
  revision: z.number().int().nonnegative(),
  verifiedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  verifiedBy: uuid,
  sourceReadAuthorized: z.boolean().optional().default(false),
});
export type SourceBinding = z.infer<typeof sourceBindingSchema>;

export const sourceBindingWriteSchema = z.object({
  accountId: uuid,
  contextGeneration: z.number().int().nonnegative(),
  sourceSystem,
  sourceProject,
  sourceKind,
  sourceKey,
  displayName: z.string().trim().min(1).max(200),
  status: z.enum(["verified", "superseded"]),
  evidenceRef: z.string().trim().min(10).max(500),
  expectedRevision: z.number().int().nonnegative().nullable(),
}).strict();
export type SourceBindingWrite = z.infer<typeof sourceBindingWriteSchema>;

export function parseSourceBindings(value: unknown, accountId?: string): SourceBinding[] | null {
  const parsed = z.array(sourceBindingSchema).max(200).safeParse(value);
  if (!parsed.success || (accountId && parsed.data.some(row => row.accountId !== accountId))) return null;
  const ids = new Set<string>(), sources = new Set<string>();
  for (const row of parsed.data) {
    const source = [row.sourceSystem, row.sourceProject, row.sourceKind, row.sourceKey].join("\u0000");
    if (ids.has(row.id) || sources.has(source)) return null;
    ids.add(row.id); sources.add(source);
  }
  return parsed.data;
}

export async function readSourceBindings(db: DbClient, userId: string, accountId?: string) {
  const result = await db.rpc("read_ops_account_source_bindings", { p_user_id: userId, p_account_id: accountId ?? null });
  if (result.error) return { data: null, error: result.error };
  const data = parseSourceBindings(result.data, accountId);
  return data ? { data, error: null } : { data: null, error: { code: "invalid_projection" } };
}

export async function writeSourceBinding(db: DbClient, userId: string, input: SourceBindingWrite) {
  const result = await db.rpc("upsert_ops_account_source_binding", {
    p_user_id: userId, p_account_id: input.accountId, p_context_generation: input.contextGeneration,
    p_source_system: input.sourceSystem, p_source_project: input.sourceProject,
    p_source_kind: input.sourceKind, p_source_key: input.sourceKey, p_display_name: input.displayName,
    p_status: input.status, p_evidence_ref: input.evidenceRef, p_expected_revision: input.expectedRevision,
  });
  if (result.error) return { data: null, error: result.error };
  const parsed = sourceBindingSchema.safeParse(result.data);
  return parsed.success && parsed.data.accountId === input.accountId
    ? { data: parsed.data, error: null }
    : { data: null, error: { code: "invalid_projection" } };
}
