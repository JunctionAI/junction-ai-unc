/* Presets — storage and resolution (migration 0015: account_presets, routine_params).

     accountResolveInput(db, accountId)          what resolvePreset needs, off the account's own rows:
                                                 business_profiles.profile (type · category), accounts.currency,
                                                 resource_profiles (budget, gross margin), kpi_snapshots aov_28d,
                                                 the niche brief's band (memories tagged "niche")
     getPreset(db, accountId, domain)            account override → industry band → unknown-model defaults
     getRoutinePreset(db, accountId, routineId)  the same, with the routine's own overrides + its steps
     setAccountPreset / setRoutineParams         validated writes (ranges refused, never clamped)
     presetSource(db?) / getMetaPreset(accountId) the paid set as the actions library's Partial<MetaPreset>
                                                 (src/lib/actions/presets.ts PresetSource — inject it as
                                                 ServiceDeps.presets)

   Every reader takes the client explicitly (session RLS client or the service role — both pass
   member_all). Relative imports only (worker-buildable). */

import { asDb } from "../../db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../../db/server";
import { unwrap, type DbClient, type Row } from "../../db/types";
import { listMemories } from "../../brain/memory";
import { modelFromProfile } from "../../unc/businessType";
import { isBandId, resolvePreset, type BandId, type ResolveInput } from "./industry";
import { applyParamsToSpec, domainOf, optionalSteps, relevantFields, boundFields, type OptionalStep } from "./routines";
import { crossFieldIssues, isPresetSource, validateParams, type ParamIssue, type PresetDomain, type PresetParams, type PresetSet, type PresetSource, type PresetValue } from "./types";
import type { RoutineSpec } from "../types";
import type { MetaPreset as ActionsMetaPreset, PresetSource as ActionsPresetSource } from "../../actions/presets";

export const NICHE_TAG = "niche";
export const NICHE_BAND_TAG = "niche_band";

// ---------- what the account tells us ----------

/** The niche brief writes one memory "Category band: <id>" (tags niche, niche_band); read it back. */
export function nicheBandFromMemories(memories: { text: string; tags: string[] }[]): BandId | null {
  for (const m of memories) {
    if (!m.tags.includes(NICHE_BAND_TAG)) continue;
    const id = m.text.match(/band:\s*([a-z_]+)/i)?.[1]?.toLowerCase();
    if (isBandId(id)) return id;
  }
  return null;
}

export async function accountResolveInput(db: DbClient, accountId: string): Promise<ResolveInput> {
  const [account, profileRow, resources, aovRows, memories] = await Promise.all([
    unwrap<{ currency: string | null } | null>("accounts.select", db.from("accounts").select("currency").eq("id", accountId).maybeSingle()),
    unwrap<{ profile: unknown } | null>("business_profiles.select", db.from("business_profiles").select("profile").eq("account_id", accountId).maybeSingle()),
    unwrap<{ budget_monthly: number | string | null; gross_margin_pct: number | string | null } | null>("resource_profiles.select", db.from("resource_profiles").select("budget_monthly, gross_margin_pct").eq("account_id", accountId).maybeSingle()),
    unwrap<{ value: number | string }[]>("kpi_snapshots.select", db.from("kpi_snapshots").select("value").eq("account_id", accountId).eq("metric_key", "aov_28d").order("window_end", { ascending: false }).limit(1)),
    listMemories(db, accountId, { kinds: ["fact"], limit: 200 }).catch(() => []),
  ]);
  const p = (profileRow?.profile && typeof profileRow.profile === "object" ? profileRow.profile : {}) as Record<string, unknown>;
  const model = modelFromProfile(p);
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const products = Array.isArray(p.products) ? (p.products as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  return {
    businessType: model.businessType,
    sells: model.sells,
    storefront: model.storefront,
    category: typeof p.category === "string" ? p.category : null,
    descriptor: [typeof p.name === "string" ? p.name : "", typeof p.oneLiner === "string" ? p.oneLiner : "", ...products].filter(Boolean).join(" · ") || null,
    nicheBand: nicheBandFromMemories(memories.filter((m) => m.tags.includes(NICHE_TAG))),
    currency: account?.currency ?? "NZD",
    aov: num(aovRows?.[0]?.value),
    grossMarginPct: num(resources?.gross_margin_pct),
    budgetMonthly: num(resources?.budget_monthly),
  };
}

// ---------- account_presets ----------

export interface AccountPresetRecord {
  domain: PresetDomain;
  params: PresetParams;
  source: PresetSource;
  updatedAt: string;
}

const paramsOfRow = (v: unknown): PresetParams => (v && typeof v === "object" && !Array.isArray(v) ? (v as PresetParams) : {});

export async function getAccountPreset(db: DbClient, accountId: string, domain: PresetDomain): Promise<AccountPresetRecord | null> {
  const row = await unwrap<Row | null>("account_presets.select", db.from("account_presets").select("domain, params, source, updated_at").eq("account_id", accountId).eq("domain", domain).maybeSingle());
  if (!row) return null;
  return { domain, params: paramsOfRow(row.params), source: isPresetSource(row.source) ? row.source : "founder", updatedAt: String(row.updated_at ?? "") };
}

export class PresetValidationError extends Error {
  constructor(public readonly issues: ParamIssue[]) {
    super(issues.map((i) => (i.key ? `${i.key}: ${i.message}` : i.message)).join("; "));
    this.name = "PresetValidationError";
  }
}

function validated(domain: PresetDomain, raw: unknown): PresetParams {
  const v = validateParams(domain, raw);
  const cross = v.ok ? crossFieldIssues(domain, v.params) : [];
  if (!v.ok || cross.length) throw new PresetValidationError([...v.issues, ...cross]);
  return v.params;
}

export async function setAccountPreset(db: DbClient, accountId: string, domain: PresetDomain, raw: unknown, opts: { source?: PresetSource; now?: () => Date } = {}): Promise<AccountPresetRecord> {
  const params = validated(domain, raw);
  const existing = await getAccountPreset(db, accountId, domain);
  const merged: PresetParams = { ...(existing?.params ?? {}), ...params };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const source = opts.source ?? "founder";
  await unwrap("account_presets.upsert", db.from("account_presets").upsert({ account_id: accountId, domain, params: merged, source, updated_at: now }, { onConflict: "account_id,domain" }));
  return { domain, params: merged, source, updatedAt: now };
}

// ---------- routine_params ----------

export interface RoutineParamsRecord {
  routineId: string;
  domain: PresetDomain;
  params: PresetParams;
  disabledSteps: string[];
  source: PresetSource;
  updatedAt: string;
}

export async function getRoutineParams(db: DbClient, accountId: string, routineId: string): Promise<RoutineParamsRecord | null> {
  const row = await unwrap<Row | null>("routine_params.select", db.from("routine_params").select("routine_id, domain, params, disabled_steps, source, updated_at").eq("account_id", accountId).eq("routine_id", routineId).maybeSingle());
  if (!row) return null;
  const domain = domainOf(routineId);
  if (!domain) return null;
  return {
    routineId,
    domain,
    params: paramsOfRow(row.params),
    disabledSteps: Array.isArray(row.disabled_steps) ? (row.disabled_steps as unknown[]).filter((x): x is string => typeof x === "string") : [],
    source: isPresetSource(row.source) ? row.source : "founder",
    updatedAt: String(row.updated_at ?? ""),
  };
}

export interface SetRoutineParamsInput {
  /** Field → value; null clears the field back to the account / industry value. Absent fields are kept. */
  params?: unknown;
  /** Optional step id → included? Absent steps keep their state. */
  steps?: Record<string, boolean>;
}

/** Validate + persist the routine's own values and switched-off steps. `spec` (the routine's
    effective spec) is what the step ids are checked against. */
export async function setRoutineParams(db: DbClient, accountId: string, spec: RoutineSpec, input: SetRoutineParamsInput, opts: { source?: PresetSource; now?: () => Date } = {}): Promise<RoutineParamsRecord> {
  const domain = domainOf(spec.id);
  if (!domain) throw new PresetValidationError([{ key: "", message: `routine ${spec.id} has no preset domain` }]);
  const params = input.params === undefined ? {} : validated(domain, input.params);
  const existing = await getRoutineParams(db, accountId, spec.id);
  const merged: PresetParams = { ...(existing?.params ?? {}), ...params };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const optional = new Set(optionalSteps(spec).map((s) => s.id));
  const off = new Set(existing?.disabledSteps.filter((id) => optional.has(id)) ?? []);
  for (const [id, included] of Object.entries(input.steps ?? {})) {
    if (!optional.has(id)) throw new PresetValidationError([{ key: id, message: `${id} is not an optional step of ${spec.id}` }]);
    if (included) off.delete(id);
    else off.add(id);
  }
  const disabledSteps = [...off];
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const source = opts.source ?? "founder";
  await unwrap("routine_params.upsert", db.from("routine_params").upsert({ account_id: accountId, routine_id: spec.id, domain, params: merged, disabled_steps: disabledSteps, source, updated_at: now }, { onConflict: "account_id,routine_id" }));
  return { routineId: spec.id, domain, params: merged, disabledSteps, source, updatedAt: now };
}

// ---------- resolution ----------

/** Account override → industry band (from the profile + niche brief) → unknown-model defaults. */
export async function getPreset(db: DbClient, accountId: string, domain: PresetDomain, opts: { input?: ResolveInput; routine?: RoutineParamsRecord | null } = {}): Promise<PresetSet> {
  const [input, account] = await Promise.all([opts.input ? Promise.resolve(opts.input) : accountResolveInput(db, accountId), getAccountPreset(db, accountId, domain)]);
  return resolvePreset(input, domain, { account: account?.params ?? null, accountSource: account?.source, routine: opts.routine?.params ?? null, routineSource: opts.routine?.source });
}

export interface RoutinePresetView {
  routineId: string;
  domain: PresetDomain;
  set: PresetSet;
  /** The 3–6 field keys the inspector shows. */
  relevant: string[];
  /** Fields whose value is bound into the spec itself. */
  bound: string[];
  steps: (OptionalStep & { included: boolean })[];
  /** The routine's own row (null before the founder saves anything). */
  own: RoutineParamsRecord | null;
}

export async function getRoutinePreset(db: DbClient, accountId: string, spec: RoutineSpec, opts: { input?: ResolveInput } = {}): Promise<RoutinePresetView | null> {
  const domain = domainOf(spec.id);
  if (!domain) return null;
  const own = await getRoutineParams(db, accountId, spec.id);
  const set = await getPreset(db, accountId, domain, { input: opts.input, routine: own });
  const off = new Set(own?.disabledSteps ?? []);
  return { routineId: spec.id, domain, set, relevant: relevantFields(spec.id), bound: boundFields(spec.id), steps: optionalSteps(spec).map((s) => ({ ...s, included: !off.has(s.id) })), own };
}

/** The node chain a saved routine should run: the resolved values bound in, disabled steps out. */
export function nodesFor(spec: RoutineSpec, view: RoutinePresetView) {
  const values: PresetParams = Object.fromEntries(view.set.fields.map((f) => [f.key, f.value]));
  return applyParamsToSpec(spec, values, view.own?.disabledSteps ?? []);
}

// ---------- the actions library's PresetSource ----------

/* src/lib/actions/presets.ts owns `MetaPreset` (the numbers the hold / scale / turn-off rules run
   on) and reads it through `PresetSource.getPreset(accountId, "meta")` → Partial<MetaPreset>. This
   is that source: the account's resolved PAID set, mapped onto their keys (fatigueCtrDropPct →
   fatigueCtrDrop, band → industry). Money fields the account can't derive yet (no AOV × margin)
   are left out so their industry default stands; the rest of their shape (maxBudgetChangePct)
   is theirs to default. Inject `presetSource()` as ServiceDeps.presets in the worker wiring. */

export type { ActionsMetaPreset, ActionsPresetSource };

/** Our seven bands → the actions library's six industries (the nearest economics). */
export const META_INDUSTRY_BY_BAND: Record<BandId, ActionsMetaPreset["industry"]> = {
  dtc_supplements: "dtc_supplements",
  dtc_apparel: "dtc_fashion",
  local_services: "lead_gen_services",
  b2b_services: "lead_gen_services",
  saas: "b2b_saas",
  creator: "dtc_general",
  fitness_gym: "lead_gen_services",
};

/** The paid set in plain numbers (our own shape; null where the account hasn't given enough). */
export interface PaidPreset {
  currency: string;
  band: BandId | null;
  targetCpa: number | null;
  maxCpa: number | null;
  roasFloor: number;
  minSpendBeforeJudging: number;
  fatigueFrequency: number;
  fatigueCtrDropPct: number;
  scaleStepPct: number;
  holdDays: number;
  dailyBudgetCap: number | null;
}

const numOr = (v: PresetValue, fallback: number): number => (typeof v === "number" ? v : fallback);
const numOrNull = (v: PresetValue): number | null => (typeof v === "number" ? v : null);

export function paidPresetFrom(set: PresetSet): PaidPreset {
  const g = (k: string): PresetValue => set.fields.find((f) => f.key === k)?.value ?? null;
  return {
    currency: set.currency,
    band: isBandId(set.band?.id) ? set.band!.id : null,
    targetCpa: numOrNull(g("targetCpa")),
    maxCpa: numOrNull(g("maxCpa")),
    roasFloor: numOr(g("roasFloor"), 3),
    minSpendBeforeJudging: numOr(g("minSpendBeforeJudging"), 50),
    fatigueFrequency: numOr(g("fatigueFrequency"), 4),
    fatigueCtrDropPct: numOr(g("fatigueCtrDropPct"), 25),
    scaleStepPct: numOr(g("scaleStepPct"), 20),
    holdDays: numOr(g("holdDays"), 7),
    dailyBudgetCap: numOrNull(g("dailyBudgetCap")),
  };
}

/** Our paid set as the actions library's Partial<MetaPreset>: null money fields are omitted. */
export function toActionsMetaPreset(set: PresetSet): Partial<ActionsMetaPreset> {
  const p = paidPresetFrom(set);
  const out: Partial<ActionsMetaPreset> = {
    industry: p.band ? META_INDUSTRY_BY_BAND[p.band] : "dtc_general",
    roasFloor: p.roasFloor,
    minSpendBeforeJudging: p.minSpendBeforeJudging,
    fatigueFrequency: p.fatigueFrequency,
    fatigueCtrDrop: p.fatigueCtrDropPct,
    scaleStepPct: p.scaleStepPct,
    holdDays: p.holdDays,
  };
  if (p.targetCpa !== null) out.targetCpa = p.targetCpa;
  if (p.maxCpa !== null) out.maxCpa = p.maxCpa;
  return out;
}

let dbResolver: () => DbClient | null = () => {
  try {
    return isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  } catch {
    return null;
  }
};
/** Tests point the source at a FakeSupabase; pass undefined to restore. */
export function setPresetDbForTests(f: (() => DbClient | null) | undefined): void {
  dbResolver = f ?? (() => (isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null));
}

/** The account's paid preset in the actions library's shape. No database (demo) → null, so their
    default stands; a read failure → null too (resolveMetaPreset treats a throw the same way). */
export async function getMetaPreset(accountId: string, db?: DbClient | null): Promise<Partial<ActionsMetaPreset> | null> {
  const client = db === undefined ? dbResolver() : db;
  if (!client) return null;
  try {
    return toActionsMetaPreset(await getPreset(client, accountId, "paid"));
  } catch {
    return null;
  }
}

/** The injectable PresetSource for the worker (ServiceDeps.presets) / the Meta executor. */
export function presetSource(db?: DbClient | null): ActionsPresetSource {
  return { getPreset: (accountId) => getMetaPreset(accountId, db) };
}
