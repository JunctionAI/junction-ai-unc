/* The slice of the supabase-js client the app actually uses.

   Everything in src/lib/db and the SupabaseStore is written against this minimal
   structural interface rather than `SupabaseClient` directly so that:
     - the in-memory fake (src/lib/db/__tests__/fakeSupabase.ts) can stand in for the real
       client in unit tests without a live project, and
     - the SQL we generate is visible as a recorded call shape (table, columns, filters)
       that the tests check against supabase/migrations/*.sql.

   The real client satisfies it structurally (see asDb() in client.ts / server.ts). */

export interface DbError {
  message: string;
  code?: string;
  details?: string;
}

export interface DbResult<T = unknown> {
  data: T;
  error: DbError | null;
}

export type Row = Record<string, unknown>;

/** Filter/transform chain (what select/insert/update/upsert return). Thenable → { data, error }. */
export interface DbFilter extends PromiseLike<DbResult> {
  select(columns?: string): DbFilter;
  eq(column: string, value: unknown): DbFilter;
  in(column: string, values: unknown[]): DbFilter;
  gte(column: string, value: unknown): DbFilter;
  lte(column: string, value: unknown): DbFilter;
  is(column: string, value: null | boolean): DbFilter;
  order(column: string, opts?: { ascending?: boolean }): DbFilter;
  limit(count: number): DbFilter;
  /** Exactly one row, else error (PGRST116). */
  single(): DbFilter;
  /** Zero or one row; null when none. */
  maybeSingle(): DbFilter;
}

export interface DbTable {
  select(columns?: string): DbFilter;
  insert(values: Row | Row[]): DbFilter;
  update(values: Row): DbFilter;
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): DbFilter;
  delete(): DbFilter;
}

export interface DbClient {
  from(table: string): DbTable;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

/** Throw on a { error } result, otherwise return the data. Every adapter call goes through it
    so a failed query never silently reads as "no rows". */
export async function unwrap<T>(op: string, q: PromiseLike<DbResult>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${op}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  return data as T;
}
