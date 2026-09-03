/* GET   /api/routines/params?routineId=D0x-W0y   — "Adjust this routine": the routine's preset
        →  { routineId, domain, currency, band: { id, label, why } | null,
             fields: [{ key, kind, label, unit, helper, range, options, value, source, industry, relevant, bound }],
             steps:  [{ id, label, kind, included }],
             version: { live, draft }, canPromote }
        or { fallback: true } demo mode · 401 | 403 | 503 { error }

   PATCH /api/routines/params  { routineId, params?: { key: value | null }, steps?: { id: boolean } }
        → the same shape. Saves routine_params (ranges refused, never clamped — 400 { error, issues })
          and, when the values change the chain, writes a new DRAFT version through the existing
          versioning (saveDraft: v live+1) so the dry-run / promote flow is unchanged.

   POST  /api/routines/params  { routineId, action: "validate" | "promote" | "discard" }
        → validate: dry-runs the draft with the worker's adapters → { run: { runId, status, summary }, passed, version }
          promote:  promoteDraft (refused with 409 { error } until a dry run of exactly this draft passed)
          discard:  drops the draft

   Session-bound (src/lib/db/session.ts): always the caller's own account. Store = getStore(). */

import { requireAccountSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { accountResolveInput, changesSpec, getRoutinePreset, nodesFor, PresetValidationError, setRoutineParams, type RoutinePresetView } from "@/lib/runtime/presets";
import { getStore } from "@/lib/runtime/store";
import type { Store } from "@/lib/runtime/store/interface";
import type { DbClient } from "@/lib/db/types";
import type { RoutineSpec } from "@/lib/runtime/types";
import { scoreAgreement } from "@/lib/runtime/agreement";
import { skillFor } from "@/lib/runtime/skills";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { discardDraft, effectiveSpec, getOrInitState, latestDryRunFor, dryRunPassed, PromoteRefusedError, promoteDraft, saveDraft, validateDraft } from "@/lib/runtime/versioning";
import { buildAdapters, resolveAccount, WorkerError } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { workerErrorStatus } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function routineIdOf(v: unknown): string | null {
  const id = typeof v === "string" ? v.trim() : "";
  return ROUTINE_ID_RE.test(id) && CATALOG_SPEC_BY_ID[id] ? id : null;
}

/** The response shape: fields flagged relevant / bound, the steps, the version pair. */
export async function shapeView(store: Store, accountId: string, catalog: RoutineSpec, view: RoutinePresetView) {
  const state = await getOrInitState({ store }, accountId, catalog.id);
  const draft = state.draftSpec;
  let canPromote = false;
  if (draft) {
    const run = await latestDryRunFor(store, accountId, draft);
    canPromote = !!run && dryRunPassed(run.status);
  }
  const relevant = new Set(view.relevant);
  const bound = new Set(view.bound);
  return {
    routineId: catalog.id,
    domain: view.domain,
    currency: view.set.currency,
    band: view.set.band,
    fields: view.set.fields.map((f) => ({ ...f, relevant: relevant.has(f.key), bound: bound.has(f.key) })),
    steps: view.steps,
    version: { live: state.version, draft: draft?.version ?? null },
    canPromote,
    skillFile: skillFor(catalog.id)?.file ?? null,
    agreement: await scoreAgreement(store, accountId, catalog.id),
  };
}

async function currentView(db: DbClient, store: Store, accountId: string, catalog: RoutineSpec) {
  const state = await getOrInitState({ store }, accountId, catalog.id);
  const spec = effectiveSpec(state, catalog);
  const view = await getRoutinePreset(db, accountId, spec);
  if (!view) throw new Error(`routine ${catalog.id} has no preset domain`);
  return { spec, view };
}

async function handleGET(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const routineId = routineIdOf(new URL(req.url).searchParams.get("routineId"));
  if (!routineId) return bad("routineId must be a catalog routine (D0x-W0y)");
  const store = getStore();
  const catalog = CATALOG_SPEC_BY_ID[routineId];
  try {
    const { view } = await currentView(session.service, store, session.accountId, catalog);
    return Response.json(await shapeView(store, session.accountId, catalog, view), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return bad(err instanceof Error ? err.message : "couldn't read the routine's settings", 500);
  }
}

async function handlePATCH(req: Request) {
  const body = await readBody(req);
  if (!body) return bad("invalid JSON body");
  const routineId = routineIdOf(body.routineId);
  if (!routineId) return bad("routineId must be a catalog routine (D0x-W0y)");
  if (body.params !== undefined && (!body.params || typeof body.params !== "object" || Array.isArray(body.params))) return bad("params must be an object of field → value");
  let steps: Record<string, boolean> | undefined;
  if (body.steps !== undefined) {
    if (!body.steps || typeof body.steps !== "object" || Array.isArray(body.steps)) return bad("steps must be an object of step id → true/false");
    steps = {};
    for (const [k, v] of Object.entries(body.steps as Record<string, unknown>)) {
      if (typeof v !== "boolean") return bad(`steps.${k} must be true or false`);
      steps[k] = v;
    }
  }
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const store = getStore();
  const catalog = CATALOG_SPEC_BY_ID[routineId];
  try {
    const state = await getOrInitState({ store }, session.accountId, catalog.id);
    const spec = effectiveSpec(state, catalog);
    await setRoutineParams(session.service, session.accountId, spec, { params: body.params, steps });
    const input = await accountResolveInput(session.service, session.accountId);
    const view = await getRoutinePreset(session.service, session.accountId, spec, { input });
    if (!view) return bad(`routine ${routineId} has no preset domain`, 500);
    const values = Object.fromEntries(view.set.fields.map((f) => [f.key, f.value]));
    // The founder's numbers live in the spec too: a new draft version, promoted through the existing flow.
    if (changesSpec(spec, values, view.own?.disabledSteps ?? [])) await saveDraft({ store }, session.accountId, catalog, nodesFor(spec, view));
    return Response.json(await shapeView(store, session.accountId, catalog, view));
  } catch (err) {
    if (err instanceof PresetValidationError) return bad(err.message, 400, { issues: err.issues });
    return bad(err instanceof Error ? err.message : "couldn't save", 500);
  }
}

async function handlePOST(req: Request) {
  const body = await readBody(req);
  if (!body) return bad("invalid JSON body");
  const routineId = routineIdOf(body.routineId);
  if (!routineId) return bad("routineId must be a catalog routine (D0x-W0y)");
  const action = body.action;
  if (action !== "validate" && action !== "promote" && action !== "discard") return bad("action must be validate, promote or discard");
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const store = getStore();
  const catalog = CATALOG_SPEC_BY_ID[routineId];
  try {
    if (action === "discard") {
      await discardDraft({ store }, session.accountId, routineId);
    } else if (action === "promote") {
      await promoteDraft({ store }, session.accountId, routineId);
    } else {
      const deps = { store, accounts: defaultAccountsSource() };
      const acct = await resolveAccount(deps, session.accountId);
      const outcome = await validateDraft({ store }, buildAdapters(deps), session.accountId, routineId, { account: acct.account, triggeredBy: "manual", vars: acct.vars ?? {} });
      const { view } = await currentView(session.service, store, session.accountId, catalog);
      return Response.json({ ...(await shapeView(store, session.accountId, catalog, view)), run: { runId: outcome.run.runId, status: outcome.run.status, summary: outcome.run.summary }, passed: outcome.passed });
    }
    const { view } = await currentView(session.service, store, session.accountId, catalog);
    return Response.json(await shapeView(store, session.accountId, catalog, view));
  } catch (err) {
    if (err instanceof PromoteRefusedError) return bad(err.message, 409);
    if (err instanceof WorkerError) return bad(err.message, workerErrorStatus(err));
    const message = err instanceof Error ? err.message : "action failed";
    return bad(message, /no draft/.test(message) ? 409 : 500);
  }
}

export const GET = withErrorCapture("api/routines/params", handleGET);
export const PATCH = withErrorCapture("api/routines/params", handlePATCH);
export const POST = withErrorCapture("api/routines/params", handlePOST);
