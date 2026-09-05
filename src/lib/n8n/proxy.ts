/* The n8n data proxy — what a workflow calls with its run-scoped data token
   (src/lib/n8n/dataToken.ts). The customer authenticated ONCE in Junction; n8n never sees a
   credential. Three handlers, each behind the same authenticate():

     readForToken(deps, auth, query)     GET /api/n8n/reads   — the SAME reader the worker uses
                                          (src/worker/providers/connectorReader.ts), the sealed
                                          credential resolved server-side, a `read` receipt on the
                                          run ("via n8n"), an honest "couldn't ask" when it can't.
     contextForToken(deps, auth)         GET /api/n8n/context — the compact account context the
                                          built-in LlmProducer drafts from (profile, goal, plan,
                                          memories recalled for the routine's purpose, ≤ 3 playbooks,
                                          prior artifacts, the skill card's craft rules).
     proposeAction(deps, auth, body)     POST /api/n8n/actions — wave-2 shape, gated: records the
                                          proposed mutation as a pending approval + a draft receipt
                                          on the run and NEVER executes (LIVE_MODE_ENABLED stays
                                          false; the executor is never touched).

   Every dependency is injected so the routes stay thin and the tests run against MemoryStore,
   a fixture credential provider and the schema-checked fake database. */

import { recallPlaybooks, type Playbook } from "../brain/playbooks";
import type { DbClient } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { assertSameRuntimeContext, RuntimeContextError } from "../runtime/contextFence";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import { newId } from "../runtime/context";
import { SKILL_BY_ID } from "../runtime/skills";
import type { Skill } from "../runtime/skills/types";
import type { RunRecord, Store } from "../runtime/store/interface";
import type { ApprovalRecord, Platform, ReadQuery, Receipt, RoutineSpec, RunContext } from "../runtime/types";
import { PLATFORMS } from "../runtime/validate";
import { skillContextFrom } from "../artifacts/material";
import { ALL_SYSTEMS } from "../platform/catalog";
import type { CredentialProvider } from "../../worker/credentials";
import { WorkerConnectorReader } from "../../worker/providers/connectorReader";
import { accountDataReader, storedDataEnabled } from "../data/datasets";
import { DbProducerContext, EmptyProducerContext, PLAYBOOKS_PER_PRODUCE, renderProfile } from "../../worker/providers/producer";
import type { Reader } from "../../worker/readers/types";
import type { CredentialsKind } from "../../worker/wiring";
import { bearerToken, hasScope, RateLimiter, scopesAreSubset, scopesForSpec, tokenKey, verifyDataToken, type DataTokenClaims } from "./dataToken";
import type { ShadowAdmission } from "./shadowAdmission";

export const READ_LIMIT_MAX = 500;
export const ACTION_EXPIRY_HOURS = 24 * 7;
export const PLAYBOOK_BODY_CHARS = 700;

export interface ProxyDeps {
  store: Store;
  /** N8N_SIGNING_SECRET; null / "" = the proxy refuses everything (503). */
  secret: string | null | undefined;
  credentials: CredentialProvider;
  /** What the credential provider is (wiring.ts credentialsKind) — for the honest "couldn't ask" line. */
  credentialsKind: CredentialsKind;
  /** Service-role client for the context (profile, memories, goal, plan); null = run context only. */
  db: DbClient | null;
  readers?: Partial<Record<Platform, Reader>>;
  limiter?: RateLimiter;
  now?: () => Date;
  idGen?: () => string;
  fetch?: typeof fetch;
  dataEnv?: Record<string, string | undefined>;
  /** Test seam; real authority resolves its durable admission from the service DB. */
  shadowAdmission?: ShadowAdmission;
  /** Playbook recall; undefined = recallPlaybooks (env-gated), null = none. */
  playbooks?: ((query: string, domains: Skill["domain"][] | null, limit: number) => Promise<Playbook[]>) | null;
}

export type ProxyAuth = { ok: true; claims: DataTokenClaims; run: RunRecord; spec: RoutineSpec } | { ok: false; status: number; error: string };

const sharedLimiter = new RateLimiter();

export async function assertProxyRuntimeContext(deps: ProxyDeps, run: RunRecord): Promise<void> {
  if (run.snapshot) assertSameRuntimeContext(run, run.snapshot.ctx.account);
  if (deps.db) await assertRuntimeContext(deps.db, run);
}

/** Resolve the exact authority a stored run was created under. A resumable snapshot wins; a
    promoted custom live spec is accepted only at the run's version; otherwise the catalog spec
    must match. No exact spec means no data authority. */
async function specForStoredRun(deps: ProxyDeps, run: RunRecord): Promise<RoutineSpec | null> {
  const snapshot = run.snapshot?.spec;
  if (snapshot && snapshot.id === run.routineId && snapshot.version === run.version) return snapshot;
  const state = await deps.store.getRoutineState(run.accountId, run.routineId);
  if (state) {
    if (state.draftSpec?.id === run.routineId && state.draftSpec.version === run.version) return state.draftSpec;
    if (state.version !== run.version) return null;
    if (state.liveSpec) return state.liveSpec.id === run.routineId && state.liveSpec.version === run.version ? state.liveSpec : null;
  }
  const catalog = CATALOG_SPEC_BY_ID[run.routineId];
  return catalog && catalog.version === run.version ? catalog : null;
}

export async function authenticate(deps: ProxyDeps, req: Request): Promise<ProxyAuth> {
  const secret = (deps.secret ?? "").trim();
  if (!secret) return { ok: false, status: 503, error: "N8N_SIGNING_SECRET is not configured — the data proxy is off" };
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, error: "send the run's data token as Authorization: Bearer <token>" };
  const v = verifyDataToken(secret, token, { now: deps.now });
  if (!v.ok) return { ok: false, status: 401, error: `data token ${v.reason}` };
  const { claims } = v;
  const run = await deps.store.getRun(claims.runId);
  if (!run) return { ok: false, status: 404, error: "no stored run for this token" };
  if (run.accountId !== claims.accountId || run.routineId !== claims.routineId) {
    return { ok: false, status: 404, error: "no stored run for this token" };
  }
  try {
    await assertProxyRuntimeContext(deps, run);
  } catch (error) {
    return { ok: false, status: error instanceof RuntimeContextError && error.code === "context_changed" ? 409 : 503,
      error: "The stored run's business context is stale, paused or unavailable" };
  }
  const spec = await specForStoredRun(deps, run);
  if (!spec) return { ok: false, status: 403, error: "the stored run has no matching routine specification" };
  const allowedScopes = scopesForSpec(spec);
  if (!scopesAreSubset(claims.scopes, allowedScopes)) {
    return { ok: false, status: 403, error: "data token asks for scopes outside its stored routine specification" };
  }
  if (run.status !== "running") return { ok: false, status: 409, error: `run ${run.id} is ${run.status} — its data token is no longer valid` };
  if (!(deps.limiter ?? sharedLimiter).take(tokenKey(token))) return { ok: false, status: 429, error: "too many calls on this token — at most 60 a minute" };
  return { ok: true, claims, run, spec };
}

function ctxFor(claims: DataTokenClaims, run: RunRecord, currency = "NZD"): RunContext {
  const startedAt = run.startedAt;
  return {
    runId: claims.runId,
    routineId: claims.routineId,
    version: run.version,
    mode: run.mode,
    startedAt,
    account: { accountId: claims.accountId, contextGeneration: run.contextGeneration ?? 0, currency, budgetMonthly: 0 },
    caps: { currency, perDay: 0, perMonth: 0 },
    triggeredBy: "manual",
    vars: {},
    inputs: {},
    reads: {},
    checks: {},
  };
}

// ---------- reads ----------

export interface ProxyReadQuery extends ReadQuery {
  platform: string;
}

export type ProxyReadResult =
  | { ok: true; rows: Record<string, unknown>[]; count: number; metrics: Record<string, number | string | boolean | null>; provenance: { platform: string; resource: string; window: string | null; fetchedAt: string; source: string; via: "n8n"; receiptId: string | null } }
  | { ok: false; code: "bad_request" | "forbidden" | "not_connected" | "secret_store_unavailable" | "platform_error"; reason: string; status: number };

export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

/** Parse the query string of GET /api/n8n/reads. `fields` / `filter` are JSON. */
export function parseReadQuery(params: URLSearchParams): { ok: true; query: ProxyReadQuery } | { ok: false; error: string } {
  const platform = (params.get("platform") ?? "").trim();
  const resource = (params.get("resource") ?? "").trim().slice(0, 64);
  if (!isPlatform(platform)) return { ok: false, error: `platform must be one of ${PLATFORMS.join(", ")}` };
  if (!/^[a-z][a-z0-9_]*$/.test(resource)) return { ok: false, error: "resource is required (letters, digits, underscores)" };
  const window = (params.get("window") ?? "").trim().slice(0, 8) || undefined;
  if (window && !/^\d{1,3}[hdm]$/.test(window)) return { ok: false, error: 'window looks like "24h", "7d", "28d"' };
  const limitRaw = params.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: "limit must be a positive integer" };
  let fields: string[] | undefined;
  let filter: Record<string, unknown> | undefined;
  try {
    const f = params.get("fields");
    if (f) {
      const parsed = JSON.parse(f);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) return { ok: false, error: "fields must be a JSON array of strings" };
      fields = parsed.slice(0, 40).map((x: string) => x.slice(0, 64));
    }
    const fl = params.get("filter");
    if (fl) {
      const parsed = JSON.parse(fl);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "filter must be a JSON object" };
      if (JSON.stringify(parsed).length > 2000) return { ok: false, error: "filter is too large (2 KB)" };
      filter = parsed as Record<string, unknown>;
    }
  } catch {
    return { ok: false, error: "fields / filter must be valid JSON" };
  }
  return { ok: true, query: { platform, resource, window, limit: limit ? Math.min(limit, READ_LIMIT_MAX) : undefined, fields, filter } };
}

const stripCouldntAsk = (m: string) => m.replace(/^couldn't ask [^:]+: /, "");

export async function readForToken(deps: ProxyDeps, auth: Extract<ProxyAuth, { ok: true }>, q: ProxyReadQuery): Promise<ProxyReadResult> {
  const now = deps.now ?? (() => new Date());
  const idGen = deps.idGen ?? newId;
  const { claims, run } = auth;
  if (!isPlatform(q.platform)) return { ok: false, code: "bad_request", reason: "unknown platform", status: 400 };
  const platform = q.platform;
  if (!hasScope(claims, platform, q.resource)) return { ok: false, code: "forbidden", reason: `this run's token is not scoped for ${platform}:${q.resource} (scopes: ${claims.scopes.join(", ") || "none"})`, status: 403 };
  const query: ReadQuery = { resource: q.resource, window: q.window, limit: q.limit, fields: q.fields, filter: q.filter };
  const ctx = ctxFor(claims, run);
  const receipt = async (kind: Receipt["kind"], description: string, payload: Record<string, unknown>) => {
    await assertProxyRuntimeContext(deps, run);
    const r: Receipt = { id: idGen(), accountId: claims.accountId, runId: run.id, kind, platform, description, payload: { via: "n8n", query, ...payload }, createdAt: now().toISOString() };
    await deps.store.appendReceipt(r);
    return r.id;
  };

  try {
    await assertProxyRuntimeContext(deps, run);
    const stored = storedDataEnabled(claims.accountId, platform, deps.dataEnv ?? {});
    const creds = stored ? null : await deps.credentials.get(claims.accountId, platform);
    if (!stored && !creds) {
      const secretStore = deps.credentialsKind === "none";
      const reason = secretStore ? "the secret store is unavailable (CONNECTOR_SECRET_KEY is not set), so no connection can be unsealed" : `${platform} is not connected for this account`;
      await receipt("notification", `Your n8n workflow asked ${platform} ${q.resource} — couldn’t ask: ${reason}.`, { rowCount: 0, provenance: "unavailable", reason });
      return { ok: false, code: secretStore ? "secret_store_unavailable" : "not_connected", reason, status: 200 };
    }
    const reader = accountDataReader(new WorkerConnectorReader({ credentials: deps.credentials, readers: deps.readers, now, fetch: deps.fetch }), deps.db, deps.dataEnv ?? {}, now);
    await assertProxyRuntimeContext(deps, run);
    const res = await reader.read(platform, query, ctx);
    const receiptId = await receipt("read", `Read ${platform} ${q.resource}${q.window ? ` over ${q.window}` : ""} via n8n: ${res.rows.length} rows.`, { rowCount: res.rows.length, metrics: res.metrics, fetchedAt: res.fetchedAt, provenance: res.provenance ?? "ok", ...(res.dataset ? { dataset: res.dataset } : {}), ...(res.sourceNote ? { sourceNote: res.sourceNote } : {}) });
    await assertProxyRuntimeContext(deps, run);
    return { ok: true, rows: res.rows, count: res.rows.length, metrics: res.metrics, provenance: { platform, resource: q.resource, window: q.window ?? null, fetchedAt: res.fetchedAt, source: res.provenance ?? "ok", via: "n8n", receiptId, ...(res.dataset ? { dataset: res.dataset } : {}), ...(res.sourceNote ? { sourceNote: res.sourceNote } : {}) } };
  } catch (err) {
    if (err instanceof RuntimeContextError) throw err;
    const reason = stripCouldntAsk(err instanceof Error ? err.message : String(err));
    await receipt("notification", `Your n8n workflow asked ${platform} ${q.resource} — couldn’t ask: ${reason}.`, { rowCount: 0, provenance: "unavailable", reason });
    return { ok: false, code: "platform_error", reason, status: 200 };
  }
}

// ---------- context ----------

function skillOrStub(routineId: string): Skill {
  const s = SKILL_BY_ID[routineId];
  if (s) return s;
  const def = ALL_SYSTEMS.find((x) => x.id === routineId);
  const name = def?.name ?? routineId;
  return {
    id: routineId,
    routineId,
    name,
    kind: "generic",
    maxItems: 10,
    purpose: name,
    inputs: [],
    file: { goal: name, owns: [], reads: [], decides: [], writes: ["an artifact from the n8n workflow"], never: ["execute a mutation"], apply: "Drafts until we graduate this routine.", examples: [] },
    minimum: { summary: "", platforms: [], inputs: [], helpful: [] },
    domain: "strategy",
    prompt: "",
    outputSpec: "",
    check: () => ({ ok: true, using: [] }),
  };
}

export async function contextForToken(deps: ProxyDeps, auth: Extract<ProxyAuth, { ok: true }>): Promise<Record<string, unknown>> {
  const now = deps.now ?? (() => new Date());
  const { claims, run } = auth;
  await assertProxyRuntimeContext(deps, run);
  const skill = skillOrStub(claims.routineId);
  const ctx = ctxFor(claims, run);
  const source = deps.db ? new DbProducerContext(deps.db, deps.store, { now }) : new EmptyProducerContext(deps.store);
  const material = await source.gather(ctx, skill);
  const sctx = skillContextFrom(ctx, material);
  let playbooks: Playbook[] = [];
  const recall = deps.playbooks === undefined ? (q: string, d: Skill["domain"][] | null, l: number) => recallPlaybooks(q, d, l, deps.db ? { db: deps.db } : {}) : deps.playbooks;
  if (recall) {
    try {
      playbooks = (await recall(`${skill.name}: ${skill.purpose}`, [skill.domain], PLAYBOOKS_PER_PRODUCE)).slice(0, PLAYBOOKS_PER_PRODUCE);
    } catch {
      playbooks = [];
    }
  }
  const spec = CATALOG_SPEC_BY_ID[claims.routineId];
  // A reset during gather/recall must not disclose a mixture of old and new business context.
  await assertProxyRuntimeContext(deps, run);
  return {
    ok: true,
    routine: { id: skill.id, name: skill.name, kind: skill.kind, maxItems: skill.maxItems, purpose: skill.purpose, domain: skill.domain, minimum: spec?.minimum ?? skill.minimum, inputs: skill.inputs, craft: skill.prompt, outputSpec: skill.outputSpec, builtIn: !!SKILL_BY_ID[claims.routineId] },
    account: { id: claims.accountId, currency: sctx.currency, today: sctx.today },
    business: sctx.profile,
    businessSummary: renderProfile(sctx.profile),
    memories: sctx.memories,
    founderNotes: sctx.founderNotes,
    goal: sctx.goal,
    plan: sctx.plan,
    priorArtifacts: sctx.priorArtifacts.map((a) => ({ id: a.id, kind: a.kind, routineId: a.routineId, title: a.title, status: a.status, createdAt: a.createdAt, excerpt: a.body.slice(0, 500) })),
    playbooks: playbooks.map((p) => ({ id: p.id, domain: p.domain, title: p.title, body: p.body.slice(0, PLAYBOOK_BODY_CHARS), tags: p.tags })),
    scopes: claims.scopes,
    run: { id: run.id, status: run.status, mode: run.mode, startedAt: run.startedAt },
  };
}

// ---------- actions (wave-2 shape; record only) ----------

export interface ProposedAction {
  platform: Platform;
  action: string;
  params: Record<string, unknown>;
  target?: Record<string, unknown>;
  title?: string;
  why?: string;
}

export function parseAction(body: unknown): { ok: true; action: ProposedAction } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (!isPlatform(b.platform)) return { ok: false, error: `platform must be one of ${PLATFORMS.join(", ")}` };
  const action = typeof b.action === "string" ? b.action.trim().slice(0, 64) : "";
  if (!/^[a-z][a-z0-9_.]*$/.test(action)) return { ok: false, error: 'action is a typed action id like "meta.adset.set_daily_budget" (lower-case, dots or underscores)' };
  const params = b.params === undefined ? {} : b.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return { ok: false, error: "params must be a JSON object" };
  if (JSON.stringify(params).length > 4000) return { ok: false, error: "params is too large (4 KB)" };
  const target = b.target && typeof b.target === "object" && !Array.isArray(b.target) ? (b.target as Record<string, unknown>) : undefined;
  return {
    ok: true,
    action: {
      platform: b.platform,
      action,
      params: params as Record<string, unknown>,
      target,
      title: typeof b.title === "string" ? b.title.trim().slice(0, 160) : undefined,
      why: typeof b.why === "string" ? b.why.trim().slice(0, 400) : undefined,
    },
  };
}

export type ProposeResult = { queued: true; approvalId: string; receiptId: string; executed: false; executes: "wave_2"; note: string } | { queued: false; executed: false; reason: string };

export const ACTION_NOTE = "Recorded as a proposal for the founder to approve or hold. Nothing was executed — running approved proposals arrives with wave 2 (LIVE_MODE_ENABLED is false).";

function allowedActions(spec: RoutineSpec): { platform: Platform; action: string }[] {
  const out: { platform: Platform; action: string }[] = [];
  for (const node of spec.nodes) {
    if (node.kind === "execute" && !node.mutation.action.includes("{{")) out.push({ platform: node.platform, action: node.mutation.action });
    if (node.kind === "decide") {
      for (const option of node.options) {
        const actionId = option.params?.actionId;
        const execute = spec.nodes.find((candidate) => candidate.kind === "execute");
        if (execute?.kind === "execute" && typeof actionId === "string" && !actionId.includes("{{")) out.push({ platform: execute.platform, action: actionId });
      }
    }
  }
  return out;
}

export async function proposeAction(deps: ProxyDeps, auth: Extract<ProxyAuth, { ok: true }>, action: ProposedAction): Promise<ProposeResult> {
  const now = deps.now ?? (() => new Date());
  const idGen = deps.idGen ?? newId;
  const { claims, run } = auth;
  await assertProxyRuntimeContext(deps, run);
  const spec = await specForStoredRun(deps, run);
  const permitted = spec ? allowedActions(spec) : [];
  if (!permitted.some((candidate) => candidate.platform === action.platform && candidate.action === action.action)) {
    return { queued: false, executed: false, reason: `this run is not authorised to propose ${action.action} on ${action.platform}` };
  }
  if (run.dedupKey?.startsWith("n8n:test:")) {
    return { queued: false, executed: false, reason: "test run validated the proposal shape; test calls never create approvals" };
  }
  const nowIso = now().toISOString();
  const expiresAt = new Date(now().getTime() + ACTION_EXPIRY_HOURS * 3_600_000).toISOString();
  const summary = `${action.action} on ${action.platform}`;
  const approval: ApprovalRecord = {
    id: idGen(),
    accountId: claims.accountId,
    runId: run.id,
    routineId: run.routineId,
    title: action.title || `Proposed by your n8n workflow: ${summary}`,
    detail: `Your workflow proposed ${summary}${Object.keys(action.params).length ? ` with ${JSON.stringify(action.params).slice(0, 600)}` : ""}. Nothing was executed — running approved proposals arrives with wave 2; approving or holding records your call.`,
    reasoning: action.why,
    status: "pending",
    expiresAt,
    createdAt: nowIso,
  };
  await assertProxyRuntimeContext(deps, run);
  await deps.store.createApproval(approval);
  const receipt: Receipt = {
    id: idGen(),
    accountId: claims.accountId,
    runId: run.id,
    approvalId: approval.id,
    kind: "draft",
    platform: action.platform,
    description: `Proposed (not executed): ${summary} — waiting for your call.`,
    payload: { via: "n8n", proposal: true, mutation: { platform: action.platform, action: action.action, target: action.target ?? null, params: action.params }, approvalId: approval.id, executed: false, executes: "wave_2" },
    createdAt: nowIso,
  };
  await assertProxyRuntimeContext(deps, run);
  await deps.store.appendReceipt(receipt);
  await assertProxyRuntimeContext(deps, run);
  return { queued: true, approvalId: approval.id, receiptId: receipt.id, executed: false, executes: "wave_2", note: ACTION_NOTE };
}
