import { unwrap, type DbClient } from "../db/types";
import { rowToArtifact, rowToApproval, rowToReceipt, rowToRun } from "../runtime/store/supabase";
import { artifactView } from "../artifacts/handlers";
import { approvalView, receiptView } from "../approvals/handlers";
import { ALL_SYSTEMS } from "../platform/catalog";

const kinds = ["artifact", "approval", "receipt", "run"] as const;
type Kind = typeof kinds[number];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const stamp = (v: unknown): v is string => typeof v === "string" && v.length < 50 &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
interface Cursor { v: 1; accountId: string; generation: number; asOf: string; at: string; kind: Kind; id: string }
export class HistoryCursorError extends Error {}
export function historyCursor(raw: string | null, accountId: string, generation: number, now: Date): Cursor | null {
  if (raw === null) return null;
  try {
    if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (!c || Object.keys(c).sort().join() !== "accountId,asOf,at,generation,id,kind,v" || c.v !== 1 ||
      c.accountId !== accountId || c.generation !== generation || !stamp(c.asOf) || !stamp(c.at) ||
      Date.parse(c.at) > Date.parse(c.asOf) || Date.parse(c.asOf) > now.getTime() + 30_000 ||
      !kinds.includes(c.kind) || !uuid.test(c.id)) throw Error();
    return c;
  } catch { throw new HistoryCursorError("History position is invalid or belongs to another business context. Start from the newest work."); }
}
type Row = { kind: Kind; id: string; occurred_at: string; record: Record<string, unknown> };
export async function readWorkspaceHistory(db: DbClient, accountId: string, actor: string, generation: number, raw: string | null, now = new Date()) {
  const cursor = historyCursor(raw, accountId, generation, now), asOf = cursor?.asOf ?? now.toISOString();
  const rows = await unwrap<Row[]>("workspace.history", db.rpc("read_workspace_history", { p_account: accountId, p_actor: actor,
    p_generation: generation, p_as_of: asOf, p_before_time: cursor?.at ?? null, p_before_kind: cursor?.kind ?? null, p_before_id: cursor?.id ?? null }));
  if (!Array.isArray(rows) || rows.length > 51 || rows.some(r => !r || !kinds.includes(r.kind) || !uuid.test(r.id) ||
    !stamp(r.occurred_at) || !r.record || r.record.id !== r.id || r.record.account_id !== accountId || r.record.context_generation !== generation))
    throw Error("History projection could not be verified");
  const page = rows.slice(0, 50), last = page.at(-1);
  const entries = page.map(r => {
    const common = { id: r.id, occurredAt: r.occurred_at };
    if (r.kind === "artifact") return { ...common, kind: "artifact" as const, artifact: artifactView(rowToArtifact(r.record), generation) };
    if (r.kind === "approval") return { ...common, kind: "approval" as const, approval: approvalView(rowToApproval(r.record)) };
    if (r.kind === "receipt") return { ...common, kind: "receipt" as const, receipt: receiptView(rowToReceipt(r.record)) };
    const run = rowToRun(r.record);
    return { ...common, kind: "run" as const, run: { id: run.id, routineId: run.routineId,
      name: ALL_SYSTEMS.find(s => s.id === run.routineId)?.name ?? run.routineId, mode: run.mode, status: run.status,
      startedAt: run.startedAt, finishedAt: run.finishedAt ?? null } };
  });
  const nextCursor = rows.length > 50 && last ? Buffer.from(JSON.stringify({ v: 1, accountId, generation, asOf,
    at: last.occurred_at, kind: last.kind, id: last.id } satisfies Cursor)).toString("base64url") : null;
  return { accountId, contextGeneration: generation, fetchedAt: now.toISOString(), asOf, entries, nextCursor };
}
export type WorkspaceHistoryPage = Awaited<ReturnType<typeof readWorkspaceHistory>>;
