/* The skills registry — which source serves each routine's produce step (GET/POST/PATCH
   /api/skills/n8n, the "Skills" settings; docs/N8N-ROUTINES.md).

     source per routine   "n8n"      an active n8n_workflows row (the account's own wins, then a global one)
                          "builtin"  the wave-1 skill card + LlmProducer (src/lib/runtime/skills)
                          "none"     nothing produces yet (wave-2 chains without a produce node)
     register             owner only; `global` (account_id null = every account) is admin only
                          (UNC_ADMIN_EMAILS — a comma list; Tom)
     test                 POST the same signed payload the engine sends, built from fixture reads,
                          to a webhook and show what came back (artifact / needs / accepted / error)

   Store-agnostic and env-injected; the routes are thin. */

import { unwrap, type DbClient } from "../db/types";
import { ALL_SYSTEMS } from "../platform/catalog";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { capsFor } from "../runtime/engine";
import { newId } from "../runtime/context";
import { SKILL_BY_ID } from "../runtime/skills";
import type { Store } from "../runtime/store/interface";
import type { N8nWorkflow, ProduceNode, ReadResult, RunContext } from "../runtime/types";
import { ROUTINE_ID_RE } from "../runtime/validate";
import { DEMO_ACCOUNT } from "../../worker/accounts";
import { FixtureCredentialProvider } from "../../worker/credentials";
import { WorkerConnectorReader } from "../../worker/providers/connectorReader";
import { HttpN8nBridge, N8N_SECRET_ENV } from "../../worker/providers/n8n";
import { TEST_RUN_PREFIX } from "./dataToken";

export const ADMIN_EMAILS_ENV = "UNC_ADMIN_EMAILS";
export const TEST_TIMEOUT_MS = 30_000;
export const WEBHOOK_URL_MAX = 2000;

export type SkillSource = "n8n" | "builtin" | "none";

export interface WorkflowView {
  id: string;
  webhookUrl: string;
  active: boolean;
  global: boolean;
}

export interface SkillRow {
  routineId: string;
  name: string;
  category: string;
  wave: 1 | 2;
  /** Has a built-in skill card (LlmProducer can draft it). */
  builtIn: boolean;
  /** Has a produce step at all. */
  produces: boolean;
  source: SkillSource;
  /** The row that would serve the step (own active → global active → own inactive → global inactive), or null. */
  workflow: WorkflowView | null;
  /** All rows that apply (own + global), for the UI to pause / resume each. */
  workflows: WorkflowView[];
}

export function isAdminEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return false;
  return (env[ADMIN_EMAILS_ENV] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(addr);
}

export async function isAccountOwner(db: DbClient, accountId: string, userId: string): Promise<boolean> {
  const row = await unwrap<{ role: string } | null>("account_members.role", db.from("account_members").select("role").eq("account_id", accountId).eq("user_id", userId).maybeSingle());
  return row?.role === "owner";
}

const view = (w: N8nWorkflow): WorkflowView => ({ id: w.id, webhookUrl: w.webhookUrl, active: w.active, global: w.accountId === null });

/** The engine's precedence (findN8nWorkflow): the account's active row, then a global active row. */
export function servingWorkflow(rows: N8nWorkflow[], accountId: string, routineId: string): N8nWorkflow | null {
  const mine = rows.filter((w) => w.routineId === routineId);
  return mine.find((w) => w.accountId === accountId && w.active) ?? mine.find((w) => w.accountId === null && w.active) ?? null;
}

export function skillSourceFor(rows: N8nWorkflow[], accountId: string, routineId: string): SkillSource {
  if (servingWorkflow(rows, accountId, routineId)) return "n8n";
  if (SKILL_BY_ID[routineId]) return "builtin";
  return "none";
}

export function skillRows(rows: N8nWorkflow[], accountId: string): SkillRow[] {
  return ALL_SYSTEMS.map((def) => {
    const spec = CATALOG_SPEC_BY_ID[def.id];
    const mine = rows.filter((w) => w.routineId === def.id);
    const serving = servingWorkflow(rows, accountId, def.id) ?? mine.find((w) => w.accountId === accountId) ?? mine.find((w) => w.accountId === null) ?? null;
    return {
      routineId: def.id,
      name: def.name,
      category: def.cat,
      wave: spec?.wave ?? 2,
      builtIn: !!SKILL_BY_ID[def.id],
      produces: !!spec?.nodes.some((n) => n.kind === "produce" || n.kind === "n8n"),
      source: skillSourceFor(rows, accountId, def.id),
      workflow: serving ? view(serving) : null,
      workflows: mine.map(view),
    };
  });
}

export async function listSkills(store: Store, accountId: string): Promise<SkillRow[]> {
  return skillRows(await store.listN8nWorkflows(accountId), accountId);
}

/** https only (http allowed for localhost / when N8N_ALLOW_HTTP=1 — a dev n8n). null = fine, else the reason. */
export function webhookUrlProblem(url: unknown, env: Record<string, string | undefined> = process.env): string | null {
  if (typeof url !== "string" || !url.trim()) return "webhookUrl is required";
  const s = url.trim();
  if (s.length > WEBHOOK_URL_MAX) return `webhookUrl is too long (${WEBHOOK_URL_MAX} chars)`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "webhookUrl must be an absolute URL";
  }
  const allowHttp = (env.N8N_ALLOW_HTTP ?? "").trim() === "1" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && allowHttp)) return "webhookUrl must be https";
  if (u.username || u.password) return "webhookUrl must not carry credentials";
  return null;
}

export interface RegisterInput {
  accountId: string;
  routineId: string;
  webhookUrl: string;
  /** account_id null — every account. Caller has checked admin. */
  global?: boolean;
}

/** One row per (scope, routine): an existing row is updated in place (same id) and re-activated. */
export async function registerWorkflow(store: Store, input: RegisterInput, idGen: () => string = newId): Promise<N8nWorkflow> {
  if (!ROUTINE_ID_RE.test(input.routineId) || !CATALOG_SPEC_BY_ID[input.routineId]) throw new Error(`routine "${input.routineId}" is not in the catalog`);
  const scopeId = input.global ? null : input.accountId;
  const existing = (await store.listN8nWorkflows(input.accountId)).find((w) => w.routineId === input.routineId && w.accountId === scopeId);
  return store.putN8nWorkflow({ id: existing?.id ?? idGen(), accountId: scopeId, routineId: input.routineId, webhookUrl: input.webhookUrl.trim(), active: true });
}

export type PatchResult = { ok: true; workflow: N8nWorkflow } | { ok: false; status: 403 | 404; error: string };

export async function patchWorkflow(store: Store, input: { id: string; active?: boolean; webhookUrl?: string }, who: { accountId: string; admin: boolean }): Promise<PatchResult> {
  const row = (await store.listN8nWorkflows(who.accountId)).find((w) => w.id === input.id);
  if (!row) return { ok: false, status: 404, error: "no such workflow for this account" };
  if (row.accountId === null && !who.admin) return { ok: false, status: 403, error: "a global workflow can only be changed by an admin" };
  const next: N8nWorkflow = { ...row, ...(input.active !== undefined ? { active: input.active } : {}), ...(input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl.trim() } : {}) };
  return { ok: true, workflow: await store.putN8nWorkflow(next) };
}

// ---------- test call ----------

export type TestResult =
  | { ok: true; kind: "artifact"; artifact: { kind: string; title: string; body: string; items: number }; ms: number }
  | { ok: true; kind: "needs"; needs: { platform?: string; input?: string; why: string }[]; ms: number }
  | { ok: true; kind: "accepted"; note: string; ms: number }
  | { ok: false; error: string; ms: number };

export interface TestDeps {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  idGen?: () => string;
  timeoutMs?: number;
}

/** The context a test call carries: the demo account's vars, fixture reads for the routine's
    read nodes (the same readers, fixture credentials), a test run id the data proxy honours
    without a run row. */
export async function fixtureRunContext(accountId: string, routineId: string, deps: TestDeps): Promise<RunContext> {
  const spec = CATALOG_SPEC_BY_ID[routineId];
  if (!spec) throw new Error(`routine "${routineId}" is not in the catalog`);
  const now = deps.now ?? (() => new Date());
  const account = { accountId, currency: "NZD", budgetMonthly: 0 };
  const ctx: RunContext = { runId: `${TEST_RUN_PREFIX}${(deps.idGen ?? newId)()}`, routineId, version: spec.version, mode: "dry_run", startedAt: now().toISOString(), account, caps: capsFor(account), triggeredBy: "manual", vars: { ...DEMO_ACCOUNT.vars }, inputs: { about_the_business: "A test call from the Skills settings — fixture material, not this account's data." }, reads: {}, checks: {} };
  const reader = new WorkerConnectorReader({ credentials: new FixtureCredentialProvider(), now });
  for (const n of spec.nodes) {
    if (n.kind !== "read") continue;
    let r: ReadResult;
    try {
      r = await reader.read(n.source, n.query, ctx);
    } catch {
      r = { rows: [], metrics: {}, fetchedAt: now().toISOString(), provenance: "unavailable" };
    }
    ctx.reads[n.as] = { ...r, provenance: r.provenance === "ok" || r.provenance === "empty" ? "fixture" : r.provenance };
  }
  return ctx;
}

export async function testWorkflow(input: { accountId: string; routineId: string; webhookUrl: string }, deps: TestDeps): Promise<TestResult> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  if (!(deps.env[N8N_SECRET_ENV] ?? "").trim()) return { ok: false, error: `${N8N_SECRET_ENV} is not set on the server — I won’t call a workflow unsigned`, ms: ms() };
  let ctx: RunContext;
  try {
    ctx = await fixtureRunContext(input.accountId, input.routineId, deps);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: ms() };
  }
  const spec = CATALOG_SPEC_BY_ID[input.routineId];
  const produce = spec.nodes.find((n): n is ProduceNode => n.kind === "produce") ?? { kind: "produce" as const, id: "produce", skill: input.routineId };
  const bridge = new HttpN8nBridge({ env: deps.env, fetch: deps.fetch, now: deps.now, timeoutMs: deps.timeoutMs ?? TEST_TIMEOUT_MS });
  try {
    const out = await bridge.call(produce, ctx, { id: "test", accountId: input.accountId, routineId: input.routineId, webhookUrl: input.webhookUrl, active: true });
    if (out.kind === "artifact") return { ok: true, kind: "artifact", artifact: { kind: out.artifact.kind, title: out.artifact.title, body: out.artifact.body, items: out.artifact.items?.length ?? 0 }, ms: ms() };
    if (out.kind === "needs") return { ok: true, kind: "needs", needs: out.needs, ms: ms() };
    return { ok: true, kind: "accepted", note: "The workflow answered 202 — it will POST the artifact to /api/routines/artifacts later. On a real run that finishes the run; a test run has nothing to attach it to.", ms: ms() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: ms() };
  }
}
