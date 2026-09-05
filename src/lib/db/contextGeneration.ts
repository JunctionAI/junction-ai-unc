/* Business-context identity, separate from the ordinary autosave revision.
 * Capture once before using input; never silently rebase old work to a new generation. */
import type { DbClient, DbResult, Row } from "./types";
import { unwrap } from "./types";

export const CONTEXT_CHANGED_MESSAGE = "Your business context changed. Reload Unc before continuing. This response was not accepted for the new context.";

export const contextChangedResponse = () => Response.json({ error: CONTEXT_CHANGED_MESSAGE, code: "context_changed" }, { status: 409 });

/** Use only after server-side membership/owner verification. */
export async function captureMemoryContext(db: DbClient, accountId: string, req?: Request) {
  try {
    const generation = await accountContextGeneration(db, accountId);
    if (req && !contextRequestMatches(req, generation)) return contextChangedResponse();
    return { generation, db: contextMemoryDb(db, accountId, generation) };
  } catch {
    return Response.json({ error: "Couldn't verify your business context." }, { status: 503 });
  }
}

export async function accountContextGeneration(db: DbClient, accountId: string): Promise<number> {
  const row = await unwrap<{ context_generation?: unknown } | null>("accounts.context_generation",
    db.from("accounts").select("context_generation").eq("id", accountId).maybeSingle());
  if (!row) throw new Error("Account context unavailable");
  const generation = row.context_generation ?? 0;
  if (!Number.isSafeInteger(generation) || (generation as number) < 0) throw new Error("Invalid account context generation");
  return generation as number;
}

export function contextRequestMatches(req: Request, generation: number): boolean {
  const value = req.headers.get("x-unc-context-generation");
  // Initial generation permits the legacy app during a coordinated rollout only.
  return value === null ? generation === 0 : value === String(generation);
}

export async function contextStillCurrent(db: DbClient, accountId: string, generation: number): Promise<boolean> {
  return await accountContextGeneration(db, accountId) === generation;
}

/** Memory writes carry their operation's captured generation. The SQL trigger takes
 * an account lock and rejects a stale operation atomically, including after an LLM wait.
 * Other tables are unchanged; this wrapper does NOT claim to fence artifacts or workers. */
export function contextMemoryDb(db: DbClient, accountId: string, generation: number): DbClient {
  const stamp = (row: Row): Row => {
    if (row.account_id !== undefined && row.account_id !== accountId) throw new Error("Memory account mismatch");
    return { ...row, account_id: accountId, context_generation: generation };
  };
  const values = (rows: Row | Row[]) => Array.isArray(rows) ? rows.map(stamp) : stamp(rows);
  return {
    from(table) {
      const source = db.from(table);
      if (table !== "memories") return source;
      return {
        select(columns) {
          return source.select(columns).eq("account_id", accountId).eq("context_generation", generation);
        },
        insert(rows) { return source.insert(values(rows)); },
        upsert(rows, opts) { return source.upsert(values(rows), opts); },
        update(row) { return source.update(stamp(row)).eq("account_id", accountId).eq("context_generation", generation); },
        delete() { throw new Error("Context memory deletion requires the explicit history/deletion path"); },
      };
    },
    async rpc(fn, args): Promise<DbResult> {
      if (fn !== "match_memories") return await db.rpc(fn, args);
      const result = await db.rpc(fn, { ...args, acct: accountId });
      if (result.error || !Array.isArray(result.data)) return result;
      const ids = result.data.map((row: Row) => row.id);
      if (!ids.length) return result;
      const allowed = await db.from("memories").select("id").eq("account_id", accountId).eq("context_generation", generation).in("id", ids);
      if (allowed.error) return { data: null, error: allowed.error };
      const keep = new Set((allowed.data as Row[]).map(row => row.id));
      return { data: result.data.filter((row: Row) => keep.has(row.id)), error: null };
    },
  };
}
