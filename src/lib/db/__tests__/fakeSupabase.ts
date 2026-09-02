/* In-memory fake of the supabase-js query builder, schema-checked against the real
   migrations. It does two jobs:

   1. Executes queries against in-memory tables with Postgres-like semantics (primary keys,
      unique indexes, upsert onConflict merge, .single() / .maybeSingle() row-count errors,
      column projection, ordering, limits) so adapters run end-to-end.
   2. Parses supabase/migrations/*.sql at load and rejects any table or column the app
      touches that the migrations don't define, plus any value outside an inline
      check (col in (...)) enum. That is how "the columns match the migrations" is asserted
      without a database.

   Every executed query is also appended to `calls` so tests can assert exact shapes. */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DbClient, DbFilter, DbResult, DbTable, Row } from "../types";

// ---------- schema from the migrations ----------

export interface TableSchema {
  name: string;
  columns: Set<string>;
  primaryKey: string[];
  /** Unique column sets (PK + unique constraints + unique indexes). `partialNotNull` marks
      partial indexes of the form `where col is not null`. */
  uniques: { columns: string[]; partialNotNull?: string }[];
  enums: Record<string, Set<string>>;
}
export type Schema = Record<string, TableSchema>;

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../supabase/migrations");

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Split on commas at parenthesis depth 0. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const cols = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);

export function loadSchema(dir = MIGRATIONS_DIR): Schema {
  const schema: Schema = {};
  const table = (name: string) => (schema[name] ??= { name, columns: new Set(), primaryKey: [], uniques: [], enums: {} });
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = stripComments(readFileSync(path.join(dir, f), "utf8"));

    // create table
    const createRe = /create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\);/g;
    for (const m of sql.matchAll(createRe)) {
      const t = table(m[1]);
      for (const def of splitTopLevel(m[2])) {
        const low = def.toLowerCase();
        if (low.startsWith("primary key")) {
          t.primaryKey = cols(def.match(/\(([^)]*)\)/)![1]);
          continue;
        }
        if (low.startsWith("unique")) {
          t.uniques.push({ columns: cols(def.match(/\(([^)]*)\)/)![1]) });
          continue;
        }
        if (low.startsWith("check") || low.startsWith("constraint") || low.startsWith("foreign")) continue;
        const col = def.split(" ")[0];
        t.columns.add(col);
        if (/\bprimary key\b/i.test(def)) t.primaryKey = [col];
        if (/\bunique\b/i.test(def)) t.uniques.push({ columns: [col] });
        const en = def.match(/check \((\w+) in \(([^)]+)\)\)/i);
        if (en) t.enums[en[1]] = new Set(en[2].split(",").map((v) => v.trim().replace(/^'|'$/g, "")));
      }
      if (t.primaryKey.length) t.uniques.unshift({ columns: t.primaryKey });
    }

    // alter table … add column
    const alterRe = /alter table (\w+)([\s\S]*?);/g;
    for (const m of sql.matchAll(alterRe)) {
      if (!/add column/i.test(m[2])) continue;
      const t = table(m[1]);
      for (const part of splitTopLevel(m[2])) {
        const am = part.match(/add column (?:if not exists )?(\w+)/i);
        if (!am) continue;
        t.columns.add(am[1]);
        const en = part.match(/check \((\w+) in \(([^)]+)\)\)/i);
        if (en) t.enums[en[1]] = new Set(en[2].split(",").map((v) => v.trim().replace(/^'|'$/g, "")));
      }
    }

    // unique indexes (incl. partial "where col is not null")
    const idxRe = /create unique index (?:if not exists )?\w+ on (\w+) \(([^)]*)\)(?: where (\w+) is not null)?/gi;
    for (const m of sql.matchAll(idxRe)) {
      table(m[1]).uniques.push({ columns: cols(m[2]), partialNotNull: m[3] });
    }
  }
  return schema;
}

let cachedSchema: Schema | null = null;
export function migrationSchema(): Schema {
  return (cachedSchema ??= loadSchema());
}

// ---------- recorded calls ----------

export type Op = "select" | "insert" | "update" | "upsert" | "delete";
export interface Filter {
  kind: "eq" | "in" | "gte" | "lte" | "is";
  column: string;
  value: unknown;
}
export interface Call {
  table: string;
  op: Op;
  columns?: string;
  values?: Row | Row[];
  filters: Filter[];
  order?: { column: string; ascending: boolean };
  limit?: number;
  single?: "single" | "maybeSingle";
  onConflict?: string;
  returning: boolean;
}

// ---------- the fake ----------

let uuidCounter = 0;
export const fakeUuid = () => {
  const n = (++uuidCounter).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
};

export class FakeSupabase implements DbClient {
  readonly tables = new Map<string, Row[]>();
  readonly calls: Call[] = [];
  /** RPCs the fake answers; create_account is built in. */
  readonly rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  /** auth.uid() for the built-in RPCs. */
  userId: string | null = "user-1";
  now: () => string = () => new Date().toISOString();

  constructor(readonly schema: Schema = migrationSchema()) {
    this.rpcs.create_account = (args) => {
      if (!this.userId) throw new Error("not signed in");
      const id = fakeUuid();
      this.insertRow("accounts", { id, name: (args.p_name as string) ?? "", currency: (args.p_currency as string) || "NZD" });
      this.insertRow("account_members", { account_id: id, user_id: this.userId, role: "owner" });
      return id;
    };
  }

  rows(table: string): Row[] {
    this.assertTable(table);
    return this.tables.get(table) ?? [];
  }
  seed(table: string, rows: Row[]) {
    for (const r of rows) this.insertRow(table, r);
  }
  callsFor(table: string, op?: Op) {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }
  lastCall(table: string, op?: Op): Call {
    const c = this.callsFor(table, op);
    if (!c.length) throw new Error(`no ${op ?? ""} call recorded for ${table}`);
    return c[c.length - 1];
  }

  from(table: string): DbTable {
    this.assertTable(table);
    return new FakeTable(this, table);
  }

  rpc(fn: string, args: Record<string, unknown> = {}): PromiseLike<DbResult> {
    const run = async (): Promise<DbResult> => {
      const handler = this.rpcs[fn];
      if (!handler) throw new Error(`fake: unknown rpc ${fn}`);
      try {
        return { data: await handler(args), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    };
    return { then: (f, r) => run().then(f, r) };
  }

  // ----- internals used by the builder -----

  assertTable(table: string): TableSchema {
    const t = this.schema[table];
    if (!t) throw new Error(`fake: table "${table}" is not defined in supabase/migrations`);
    return t;
  }
  assertColumns(table: string, names: string[]) {
    const t = this.assertTable(table);
    for (const n of names) if (!t.columns.has(n)) throw new Error(`fake: column "${table}.${n}" is not defined in supabase/migrations`);
  }
  assertEnums(table: string, row: Row) {
    const t = this.assertTable(table);
    for (const [col, values] of Object.entries(t.enums)) {
      if (col in row && row[col] !== null && row[col] !== undefined && !values.has(String(row[col])))
        throw new Error(`fake: ${table}.${col} = ${JSON.stringify(row[col])} violates check (${[...values].join("|")})`);
    }
  }
  private withDefaults(table: string, row: Row): Row {
    const t = this.assertTable(table);
    const out: Row = {};
    for (const c of t.columns) out[c] = c in row ? row[c] : null;
    if (t.columns.has("id") && out.id === null) out.id = fakeUuid();
    for (const c of ["created_at", "updated_at", "started_at", "saved_at"]) if (t.columns.has(c) && out[c] === null) out[c] = this.now();
    return out;
  }
  private uniqueViolation(table: string, row: Row, ignore?: Row): string | null {
    const t = this.assertTable(table);
    for (const u of t.uniques) {
      if (u.partialNotNull && (row[u.partialNotNull] === null || row[u.partialNotNull] === undefined)) continue;
      if (u.columns.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = (this.tables.get(table) ?? []).find((r) => r !== ignore && u.columns.every((c) => r[c] === row[c]));
      if (clash) return `duplicate key value violates unique constraint (${table}: ${u.columns.join(",")})`;
    }
    return null;
  }
  insertRow(table: string, row: Row): Row {
    this.assertColumns(table, Object.keys(row));
    const full = this.withDefaults(table, row);
    this.assertEnums(table, full);
    const v = this.uniqueViolation(table, full);
    if (v) throw new DbErr(v, "23505");
    if (!this.tables.has(table)) this.tables.set(table, []);
    this.tables.get(table)!.push(full);
    return full;
  }
  upsertRow(table: string, row: Row, onConflict?: string): Row {
    this.assertColumns(table, Object.keys(row));
    const t = this.assertTable(table);
    const key = onConflict ? cols(onConflict) : t.primaryKey;
    if (!key.length) throw new Error(`fake: upsert on ${table} needs onConflict (no primary key)`);
    if (!t.uniques.some((u) => u.columns.length === key.length && u.columns.every((c) => key.includes(c))))
      throw new Error(`fake: upsert onConflict "${key.join(",")}" is not a unique key of ${table}`);
    const existing = (this.tables.get(table) ?? []).find((r) => key.every((c) => r[c] === row[c]));
    if (existing) {
      const merged = { ...existing, ...row };
      this.assertEnums(table, merged);
      const v = this.uniqueViolation(table, merged, existing);
      if (v) throw new DbErr(v, "23505");
      Object.assign(existing, row);
      return existing;
    }
    return this.insertRow(table, row);
  }
  updateRows(table: string, rows: Row[], patch: Row): Row[] {
    this.assertColumns(table, Object.keys(patch));
    for (const r of rows) {
      const merged = { ...r, ...patch };
      this.assertEnums(table, merged);
      const v = this.uniqueViolation(table, merged, r);
      if (v) throw new DbErr(v, "23505");
    }
    for (const r of rows) Object.assign(r, patch);
    return rows;
  }
  deleteRows(table: string, rows: Row[]) {
    const all = this.tables.get(table) ?? [];
    this.tables.set(
      table,
      all.filter((r) => !rows.includes(r)),
    );
  }
}

class DbErr extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const cmp = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

class FakeTable implements DbTable {
  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}
  select(columns = "*") {
    return new FakeFilter(this.db, { table: this.table, op: "select", columns, filters: [], returning: true });
  }
  insert(values: Row | Row[]) {
    return new FakeFilter(this.db, { table: this.table, op: "insert", values, filters: [], returning: false });
  }
  update(values: Row) {
    return new FakeFilter(this.db, { table: this.table, op: "update", values, filters: [], returning: false });
  }
  upsert(values: Row | Row[], opts: { onConflict?: string } = {}) {
    return new FakeFilter(this.db, { table: this.table, op: "upsert", values, filters: [], onConflict: opts.onConflict, returning: false });
  }
  delete() {
    return new FakeFilter(this.db, { table: this.table, op: "delete", filters: [], returning: false });
  }
}

class FakeFilter implements DbFilter {
  constructor(
    private readonly db: FakeSupabase,
    private readonly call: Call,
  ) {}
  private add(f: Filter) {
    this.db.assertColumns(this.call.table, [f.column]);
    this.call.filters.push(f);
    return this;
  }
  select(columns = "*") {
    // after insert/update/upsert: return the affected rows
    this.call.returning = true;
    if (this.call.op !== "select") this.call.columns = columns;
    return this;
  }
  eq(column: string, value: unknown) {
    return this.add({ kind: "eq", column, value });
  }
  in(column: string, values: unknown[]) {
    return this.add({ kind: "in", column, value: values });
  }
  gte(column: string, value: unknown) {
    return this.add({ kind: "gte", column, value });
  }
  lte(column: string, value: unknown) {
    return this.add({ kind: "lte", column, value });
  }
  is(column: string, value: null | boolean) {
    return this.add({ kind: "is", column, value });
  }
  order(column: string, opts: { ascending?: boolean } = {}) {
    this.db.assertColumns(this.call.table, [column]);
    this.call.order = { column, ascending: opts.ascending ?? true };
    return this;
  }
  limit(count: number) {
    this.call.limit = count;
    return this;
  }
  single() {
    this.call.single = "single";
    return this;
  }
  maybeSingle() {
    this.call.single = "maybeSingle";
    return this;
  }
  then<R1 = DbResult, R2 = never>(onFulfilled?: ((v: DbResult) => R1 | PromiseLike<R1>) | null, onRejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled ?? undefined, onRejected ?? undefined);
  }

  private matches(row: Row): boolean {
    return this.call.filters.every((f) => {
      const v = row[f.column];
      switch (f.kind) {
        case "eq":
          return v === f.value || String(v) === String(f.value);
        case "in":
          return (f.value as unknown[]).some((x) => x === v || String(x) === String(v));
        case "gte":
          return v !== null && v !== undefined && cmp(v, f.value) >= 0;
        case "lte":
          return v !== null && v !== undefined && cmp(v, f.value) <= 0;
        case "is":
          return f.value === null ? v === null || v === undefined : v === f.value;
      }
    });
  }

  private project(rows: Row[]): Row[] {
    const c = this.call.columns ?? "*";
    if (c.trim() === "*") return rows.map((r) => ({ ...r }));
    const names = cols(c);
    this.db.assertColumns(this.call.table, names);
    return rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n]])));
  }

  private execute(): DbResult {
    const { table, op } = this.call;
    this.db.calls.push({ ...this.call, filters: [...this.call.filters] });
    try {
      let affected: Row[];
      const all = this.db.rows(table);
      const selected = () => all.filter((r) => this.matches(r));
      switch (op) {
        case "select":
          affected = selected();
          break;
        case "insert": {
          const vals = Array.isArray(this.call.values) ? this.call.values : [this.call.values!];
          affected = vals.map((v) => this.db.insertRow(table, v));
          break;
        }
        case "upsert": {
          const vals = Array.isArray(this.call.values) ? this.call.values : [this.call.values!];
          affected = vals.map((v) => this.db.upsertRow(table, v, this.call.onConflict));
          break;
        }
        case "update":
          affected = this.db.updateRows(table, selected(), this.call.values as Row);
          break;
        case "delete":
          affected = selected();
          this.db.deleteRows(table, affected);
          break;
      }
      if (this.call.order) {
        const { column, ascending } = this.call.order;
        affected = [...affected].sort((a, b) => (ascending ? 1 : -1) * cmp(a[column], b[column]));
      }
      if (this.call.limit !== undefined) affected = affected.slice(0, this.call.limit);
      if (!this.call.returning) {
        if (this.call.single === "single" && affected.length !== 1) return { data: null, error: { message: `JSON object requested, multiple (or no) rows returned (${affected.length})`, code: "PGRST116" } };
        return { data: null, error: null };
      }
      const out = this.project(affected);
      if (this.call.single === "single") {
        if (out.length !== 1) return { data: null, error: { message: `JSON object requested, multiple (or no) rows returned (${out.length})`, code: "PGRST116" } };
        return { data: out[0], error: null };
      }
      if (this.call.single === "maybeSingle") {
        if (out.length > 1) return { data: null, error: { message: `JSON object requested, multiple rows returned (${out.length})`, code: "PGRST116" } };
        return { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    } catch (e) {
      if (e instanceof DbErr) return { data: null, error: { message: e.message, code: e.code } };
      throw e; // programming errors (unknown table/column/enum) fail the test loudly
    }
  }
}
