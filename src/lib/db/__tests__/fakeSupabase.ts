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
  uniques: { columns: string[]; partialNotNull?: string; name?: string }[];
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
    const createRe = /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/g;
    for (const m of sql.matchAll(createRe)) {
      const t = table(m[1]);
      for (const def of splitTopLevel(m[2])) {
        const low = def.toLowerCase();
        if (low.startsWith("primary key")) {
          t.primaryKey = cols(def.match(/\(([^)]*)\)/)![1]);
          continue;
        }
        if (low.startsWith("unique")) {
          const columns = cols(def.match(/\(([^)]*)\)/)![1]);
          t.uniques.push({ columns, name: `${t.name}_${columns.join("_")}_key` });
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

    // alter table … add column | add constraint … check (col in (…))  (0013 widens routine_runs.status)
    const alterRe = /alter table (?:public\.)?(\w+)\s+([\s\S]*?);/g;
    for (const m of sql.matchAll(alterRe)) {
      const dropped = m[2].match(/drop constraint (\w+)/i);
      if (dropped) table(m[1]).uniques = table(m[1]).uniques.filter(u => u.name !== dropped[1]);
      const unique = m[2].match(/add constraint (\w+) unique \(([^)]+)\)/i);
      if (unique) table(m[1]).uniques.push({ name: unique[1], columns: cols(unique[2]) });
      const con = m[2].match(/add constraint \w+\s+check \((\w+) in \(([^)]+)\)\)/i);
      if (con) table(m[1]).enums[con[1]] = new Set(con[2].split(",").map((v) => v.trim().replace(/^'|'$/g, "")));
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

    // Retired indexes must stop constraining later generation-aware fixtures.
    for (const m of sql.matchAll(/drop index (?:if exists )?(?:public\.)?(\w+)/gi))
      for (const t of Object.values(schema)) t.uniques = t.uniques.filter(u => u.name !== m[1]);
    // unique indexes (incl. partial "where col is not null")
    const idxRe = /create unique index (?:if not exists )?(\w+) on (?:public\.)?(\w+) \(([^)]*)\)(?: where (\w+) is not null)?/gi;
    for (const m of sql.matchAll(idxRe)) {
      table(m[2]).uniques.push({ name: m[1], columns: cols(m[3]), partialNotNull: m[4] });
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
  orders?: { column: string; ascending: boolean }[];
  limit?: number;
  single?: "single" | "maybeSingle";
  onConflict?: string;
  ignoreDuplicates?: boolean;
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
  /** RPCs the fake answers; core account, memory and spend-admission RPCs are built in. */
  readonly rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  /** auth.uid() for the built-in RPCs. */
  userId: string | null = "user-1";
  /** The signed-in user's CONFIRMED email (auth.users.email with email_confirmed_at set) for
      accept_beta_invites; null = unconfirmed / unknown, which attaches nothing. */
  userEmail: string | null = null;
  now: () => string = () => new Date().toISOString();

  constructor(readonly schema: Schema = migrationSchema()) {
    this.rpcs.list_context_artifacts = args => this.rows("artifacts").filter(f =>
      f.account_id === args.acct && this.rows("accounts").some(a => a.id === args.acct && a.context_generation === args.generation) &&
      this.rows("routine_runs").some(r => r.id === f.run_id && r.account_id === f.account_id && r.context_generation === args.generation) &&
      (!args.requested_run || f.run_id === args.requested_run) && (!args.requested_routine || f.routine_id === args.requested_routine) &&
      (!args.requested_status || f.status === args.requested_status))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
      .slice(0, Math.min(Number(args.max_rows ?? 12), 100));
    this.rpcs.write_decision_style_context = args => {
      const a = this.rows("accounts").find(a => a.id === args.p_account);
      if (!a || a.context_generation !== args.p_generation || a.automation_paused !== false) throw new Error("Captured style context unavailable");
      const profile = this.rows("account_profiles").find(p => p.account_id === args.p_account);
      this.upsertRow("account_profiles", { account_id: args.p_account, decision_style: { ...(profile?.decision_style as Row ?? {}), ...(args.p_style as Row) }, updated_at: args.p_now }, "account_id");
      return null;
    };
    // Query-shape/application fixture only. Real command trigger/role guarantees
    // are verified separately by the rollback SQL canary.
    this.rpcs.list_current_routine_commands = (args) => {
      const notifications = args.pending_notifications === true;
      return this.rows("routine_commands").filter(c => {
        const a = this.rows("accounts").find(a => a.id === c.account_id);
        if (!a || a.automation_paused !== false || a.context_generation !== c.context_generation) return false;
        if (!notifications) return c.status === args.command_status;
        const b = c.channel_binding as Row | null;
        if (!b || !["done", "blocked", "failed", "uncertain", "waiting"].includes(String(c.status))) return false;
        return this.rows("channel_links").some(l => l.id === b.linkId && l.account_id === c.account_id && l.user_id === c.user_id &&
          l.binding_version === b.bindingVersion && l.external_id === b.externalId && l.channel === c.channel && !!l.verified_at &&
          (l.channel !== "slack" || (l.meta as Row)?.team_id === b.scopeId)) &&
          this.rows("account_members").some(m => m.account_id === c.account_id && m.user_id === c.user_id && m.role === "owner") &&
          !this.rows("outbound_messages").some(o => o.account_id === c.account_id && o.context_generation === c.context_generation &&
            o.ref === ["command", c.id, c.notification_revision].join(":") && o.status !== "queued");
      }).sort((a, b) => cmp(notifications ? a.notification_checked_at ?? a.updated_at : a[args.command_status === "queued" ? "created_at" : "updated_at"],
        notifications ? b.notification_checked_at ?? b.updated_at : b[args.command_status === "queued" ? "created_at" : "updated_at"]) || cmp(a.id, b.id))
        .slice(0, Math.min(Math.max(Number(args.max_rows ?? 0), 0), 100));
    };
    this.rpcs.create_account = (args) => {
      if (!this.userId) throw new Error("not signed in");
      const id = fakeUuid();
      this.insertRow("accounts", { id, name: (args.p_name as string) ?? "", currency: (args.p_currency as string) || "NZD" });
      this.insertRow("account_members", { account_id: id, user_id: this.userId, role: "owner" });
      return id;
    };
    // 0009: open invites for the confirmed address → account_members (idempotent), invite marked accepted.
    this.rpcs.accept_beta_invites = () => {
      if (!this.userId) throw new Error("not signed in");
      const addr = this.userEmail?.trim().toLowerCase();
      if (!addr) return [];
      const attached: string[] = [];
      const open = (this.tables.get("beta_invites") ?? []).filter((r) => r.email === addr && (r.accepted_at === null || r.accepted_at === undefined)).sort((a, b) => cmp(a.created_at, b.created_at));
      for (const inv of open) {
        this.upsertRow("account_members", { account_id: inv.account_id, user_id: this.userId, role: inv.role ?? "owner" });
        inv.accepted_at = this.now();
        inv.accepted_user_id = this.userId;
        attached.push(inv.account_id as string);
      }
      return attached;
    };
    // 0010: cosine similarity over live memories that carry an embedding, best first.
    this.rpcs.match_memories = (args) => {
      const q = args.query_embedding;
      if (!Array.isArray(q)) throw new Error("match_memories: query_embedding must be a vector");
      const acct = args.acct;
      const kinds = Array.isArray(args.kinds) ? (args.kinds as string[]) : null;
      const count = typeof args.match_count === "number" ? args.match_count : 12;
      return (this.tables.get("memories") ?? [])
        .filter((m) => m.account_id === acct && (m.valid_to === null || m.valid_to === undefined) && Array.isArray(m.embedding) && (!kinds || kinds.includes(String(m.kind))))
        .map((m) => ({ id: m.id, kind: m.kind, text: m.text, importance: m.importance, confidence: m.confidence, happens_at: m.happens_at ?? null, similarity: cosine(q as number[], m.embedding as number[]) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, count);
    };
    // 20260903211025: one synchronous handler is one atomic fake transaction. The real RPC
    // serialises cross-instance callers by locking accounts(id) before these same sums/insert.
    this.rpcs.reserve_llm_spend = (args) => {
      const accountId = String(args.p_account_id ?? "");
      const ceilingUsd = Number(args.p_ceiling_usd);
      const fallbackCapUsd = Number(args.p_default_cap_usd);
      if (!accountId) throw new Error("account id is required");
      if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) throw new Error("request ceiling must be a finite positive amount");
      if (!Number.isFinite(fallbackCapUsd)) throw new Error("default cap must be finite");
      const account = (this.tables.get("accounts") ?? []).find((row) => row.id === accountId);
      if (!account) throw new Error("account not found");
      const capUsd = account.monthly_llm_cap_usd === null || account.monthly_llm_cap_usd === undefined ? fallbackCapUsd : Number(account.monthly_llm_cap_usd);
      if (!Number.isFinite(capUsd)) throw new Error("account cap must be finite");

      const now = new Date(this.now());
      if (!Number.isFinite(now.getTime())) throw new Error("fake clock is invalid");
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const monthDate = monthStart.toISOString().slice(0, 10);
      const expired = (this.tables.get("llm_spend_reservations") ?? []).filter((row) => row.account_id === accountId && new Date(String(row.expires_at)).getTime() <= now.getTime());
      this.deleteRows("llm_spend_reservations", expired);

      const spentUsd = (this.tables.get("llm_usage") ?? [])
        .filter((row) => {
          const created = new Date(String(row.created_at)).getTime();
          return row.account_id === accountId && created >= monthStart.getTime() && created < monthEnd.getTime();
        })
        .reduce((sum, row) => sum + (Number(row.est_cost_usd) || 0), 0);
      const reservedUsd = (this.tables.get("llm_spend_reservations") ?? [])
        .filter((row) => row.account_id === accountId && new Date(String(row.expires_at)).getTime() > now.getTime())
        .reduce((sum, row) => sum + (Number(row.ceiling_usd) || 0), 0);
      if (spentUsd + reservedUsd + ceilingUsd > capUsd) return { ok: false, reason: "budget_exceeded", spent_usd: spentUsd, reserved_usd: reservedUsd, cap_usd: capUsd };

      // A completed call releases immediately after its durable usage insert. If the process
      // crashes or that insert fails, retain the ceiling through month end (+ rollover buffer)
      // so unledgered paid usage cannot silently fall out of the cap.
      const expiresAt = new Date(monthEnd.getTime() + 30 * 60_000).toISOString();
      const reservation = this.insertRow("llm_spend_reservations", { account_id: accountId, ceiling_usd: ceilingUsd, month_start: monthDate, expires_at: expiresAt, created_at: now.toISOString() });
      return { ok: true, reservation_id: reservation.id, spent_usd: spentUsd, reserved_usd: reservedUsd, cap_usd: capUsd, expires_at: expiresAt };
    };
    this.rpcs.release_llm_spend_reservation = (args) => {
      const accountId = String(args.p_account_id ?? "");
      const reservationId = String(args.p_reservation_id ?? "");
      if (!accountId || !reservationId) throw new Error("account id and reservation id are required");
      if (!(this.tables.get("accounts") ?? []).some((row) => row.id === accountId)) throw new Error("account not found");
      const row = (this.tables.get("llm_spend_reservations") ?? []).find((candidate) => candidate.id === reservationId && candidate.account_id === accountId);
      if (!row) return false;
      this.deleteRows("llm_spend_reservations", [row]);
      return true;
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
        const code = e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : undefined;
        return { data: null, error: { message: e instanceof Error ? e.message : String(e), ...(code ? { code } : {}) } };
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
    if (t.columns.has("context_generation") && !("context_generation" in row) && table !== "outbound_messages") out.context_generation = 0;
    if (table === "channel_links" && !("binding_version" in row)) out.binding_version = 0;
    if (table === "routine_commands" && !("notification_revision" in row)) out.notification_revision = 0;
    if (table === "artifacts" && !("revision" in row)) out.revision = 0;
    if (table === "chat_messages" && !("external_scope" in row)) out.external_scope = "";
    if (table === "accounts" && !("automation_paused" in row)) out.automation_paused = false;
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
  upsertRow(table: string, row: Row, onConflict?: string): Row;
  upsertRow(table: string, row: Row, onConflict: string | undefined, ignoreDuplicates: boolean): Row | null;
  upsertRow(table: string, row: Row, onConflict?: string, ignoreDuplicates = false): Row | null {
    this.assertColumns(table, Object.keys(row));
    const t = this.assertTable(table);
    const key = onConflict ? cols(onConflict) : t.primaryKey;
    if (!key.length) throw new Error(`fake: upsert on ${table} needs onConflict (no primary key)`);
    if (!t.uniques.some((u) => u.columns.length === key.length && u.columns.every((c) => key.includes(c))))
      throw new Error(`fake: upsert onConflict "${key.join(",")}" is not a unique key of ${table}`);
    const existing = (this.tables.get(table) ?? []).find((r) => key.every((c) => r[c] === row[c]));
    if (existing) {
      if (ignoreDuplicates) return null;
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
    for (const r of rows) {
      // Application fixture for the database-owned notification revision. Actual
      // immutability, locks and permission boundaries are tested with PostgreSQL.
      if (table === "routine_commands" && (patch.status !== undefined && patch.status !== r.status || patch.reply !== undefined && patch.reply !== r.reply))
        Object.assign(r, { notification_revision: Number(r.notification_revision ?? 0) + 1, notification_status: "pending", notification_checked_at: null });
      if (table === "artifacts" && Object.entries(patch).some(([k, v]) => v !== r[k])) r.revision = Number(r.revision ?? 0) + 1;
      Object.assign(r, patch);
    }
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

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
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
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    return new FakeFilter(this.db, { table: this.table, op: "upsert", values, filters: [], onConflict: opts.onConflict, ignoreDuplicates: opts.ignoreDuplicates, returning: false });
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
    (this.call.orders ??= []).push(this.call.order);
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
          affected = vals.map((v) => this.db.upsertRow(table, v, this.call.onConflict, this.call.ignoreDuplicates ?? false)).filter((v): v is Row => v !== null);
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
        const orders = this.call.orders ?? [this.call.order];
        affected = [...affected].sort((a, b) => {
          for (const { column, ascending } of orders) {
            const comparison = (ascending ? 1 : -1) * cmp(a[column], b[column]);
            if (comparison) return comparison;
          }
          return 0;
        });
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
