/* The Routines view's real state for an account (GET /api/routines/state):

     per catalog routine  enabled · version · availability · last run · last draft ·
                          recommended (the agreed plan's phase-1, wave-1 routines)
     once                 recommendedFirst[] · planChannel · connected platforms

   Only a routine's REQUIRED reads (and its skill minimum's platforms) gate availability; optional
   reads surface as "Better with X connected" (betterWith) — a hint, never a block.

   Three store reads (states, newest runs, newest draft receipts) + three DB reads (connectors,
   the latest plan, the business profile) — never one query per routine. Store-agnostic
   (MemoryStore in tests). The business type (business_profiles.profile — scan / founder) gates
   availability: a store-only routine for a business with no store is "For stores — not your
   model" — off, not recommended, still listed honestly. Unknown type ⇒ nothing is hidden. */

import { connectorHasRealSync } from "../connectors/sync";
import { unwrap, type DbClient } from "../db/types";
import { skillSourceFor } from "../n8n/registry";
import { ALL_SYSTEMS } from "../platform/catalog";
import { modelFromProfile, type BusinessModel } from "../unc/businessType";
import { availabilityCopy, betterWith, betterWithCopy, canEnable, fitsBusiness, routineAvailability, type Availability } from "./availability";
import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "./catalog-specs";
import type { Store } from "./store/interface";
import type { Receipt, RunStatus } from "./types";
import { getOrInitState, setEnabled } from "./versioning";

export interface RoutineLastRun {
  id: string;
  at: string;
  finishedAt: string | null;
  status: RunStatus;
  summary: string;
}

export interface RoutineLastDraft {
  receiptId: string;
  runId: string;
  description: string;
  at: string;
}

export interface RoutineStateView {
  routineId: string;
  name: string;
  category: string;
  wave: 1 | 2;
  enabled: boolean;
  version: number;
  availability: Availability;
  availabilityCopy: string;
  canEnable: boolean;
  /** Helpful platforms (optional reads, the skill minimum's `helpful`) not yet connected — a nudge, never a block. */
  betterWith: string[];
  /** "Better with Gorgias, LinkedIn connected", or null. */
  betterWithCopy: string | null;
  recommended: boolean;
  lastRun: RoutineLastRun | null;
  lastDraft: RoutineLastDraft | null;
  /** Who drafts the produce step: an active n8n workflow (own, else global), the built-in skill card, or nothing yet. */
  skillSource: "n8n" | "builtin" | "none";
}

export interface RoutinesStateListing {
  routines: RoutineStateView[];
  /** Phase-1, wave-1 routine ids from the agreed plan, in plan order. */
  recommendedFirst: string[];
  /** The plan's first channel (category name), or null without a plan. */
  planChannel: string | null;
  connected: string[];
  /** What kind of business this is (null fields when unknown) — why some rows read "For stores — not your model". */
  business: BusinessModel;
  /** Only with ?routineId=: the receipt trail of that routine's last run, oldest first. */
  lastRunReceipts?: { id: string; kind: string; platform: string | null; description: string; createdAt: string }[];
}

export interface RoutinesStateDeps {
  store: Store;
  /** Service-role client for connectors + plans; null in demo (no connectors, no plan). */
  db: DbClient | null;
  now?: () => Date;
}

const RUNS_WINDOW = 300;
const DRAFTS_WINDOW = 300;
const catalog = new Map(ALL_SYSTEMS.map((s) => [s.id, s]));
const ID_BY_NAME = new Map(ALL_SYSTEMS.map((s) => [s.name, s.id]));

export async function connectedPlatformsFor(db: DbClient | null, accountId: string): Promise<string[]> {
  if (!db) return [];
  const rows = await unwrap<{ platform: string; last_sync_result: string | null }[]>(
    "connectors.select",
    db.from("connectors").select("platform, last_sync_result").eq("account_id", accountId).eq("status", "connected"),
  );
  return [...new Set(rows.filter((r) => connectorHasRealSync("connected", r.last_sync_result)).map((r) => r.platform))];
}

/** The latest plan's phase-1 routine names → catalog ids (unknown names dropped). */
export function phaseOneRoutineIds(phases: unknown): string[] {
  if (!Array.isArray(phases) || !phases.length) return [];
  const first = phases[0] as { routines?: unknown };
  if (!first || !Array.isArray(first.routines)) return [];
  return first.routines.map((n) => (typeof n === "string" ? ID_BY_NAME.get(n) : undefined)).filter((id): id is string => !!id);
}

/** Recommended first = phase-1 routines that are in the launch wave (draft-only). */
export function recommendedFirstFrom(phases: unknown): string[] {
  return phaseOneRoutineIds(phases).filter((id) => CATALOG_SPEC_BY_ID[id]?.wave === 1);
}

export async function latestPlanPhases(db: DbClient | null, accountId: string): Promise<unknown> {
  if (!db) return null;
  const row = await unwrap<{ phases: unknown } | null>("plans.select", db.from("plans").select("phases").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  return row?.phases ?? null;
}

/** The account's business model off business_profiles.profile (all null in demo / before a scan). */
export async function businessModelFor(db: DbClient | null, accountId: string): Promise<BusinessModel> {
  if (!db) return modelFromProfile(null);
  const row = await unwrap<{ profile: unknown } | null>("business_profiles.select", db.from("business_profiles").select("profile").eq("account_id", accountId).maybeSingle());
  return modelFromProfile(row?.profile ?? null);
}

export async function routinesStateForAccount(deps: RoutinesStateDeps, accountId: string, opts: { routineId?: string; contextGeneration?: number } = {}): Promise<RoutinesStateListing> {
  const [states, runs, drafts, connected, phases, business, workflows] = await Promise.all([
    deps.store.listRoutineStates(accountId),
    deps.store.listRuns(accountId, { limit: RUNS_WINDOW, ...(opts.contextGeneration !== undefined ? { contextGeneration: opts.contextGeneration } : {}) }),
    deps.store.listReceipts(accountId, { kind: "draft", limit: DRAFTS_WINDOW, ...(opts.contextGeneration !== undefined ? { contextGeneration: opts.contextGeneration } : {}) }),
    connectedPlatformsFor(deps.db, accountId),
    latestPlanPhases(deps.db, accountId),
    businessModelFor(deps.db, accountId),
    deps.store.listN8nWorkflows(accountId),
  ]);
  const stateById = new Map(states.map((s) => [s.routineId, s]));
  const lastRunById = new Map<string, RoutineLastRun>();
  const routineOfRun = new Map<string, string>();
  for (const r of runs) {
    routineOfRun.set(r.id, r.routineId);
    if (!lastRunById.has(r.routineId)) lastRunById.set(r.routineId, { id: r.id, at: r.startedAt, finishedAt: r.finishedAt ?? null, status: r.status, summary: r.summary ?? "" });
  }
  const lastDraftById = new Map<string, RoutineLastDraft>();
  for (const d of drafts) {
    const routineId = routineOfRun.get(d.runId);
    if (!routineId || lastDraftById.has(routineId)) continue;
    lastDraftById.set(routineId, { receiptId: d.id, runId: d.runId, description: d.description, at: d.createdAt });
  }
  // A store-only routine is never "recommended first" for a business with no store.
  const recommendedFirst = recommendedFirstFrom(phases).filter((id) => fitsBusiness({ id }, business));
  const planChannel = recommendedFirst.length ? (catalog.get(recommendedFirst[0])?.cat ?? null) : phaseOneRoutineIds(phases).length ? (catalog.get(phaseOneRoutineIds(phases)[0])?.cat ?? null) : null;

  const routines: RoutineStateView[] = CATALOG_SPECS.map((spec) => {
    const def = catalog.get(spec.id);
    const st = stateById.get(spec.id);
    const availability = routineAvailability(spec, connected, business);
    const helpful = betterWith(spec, connected, business);
    return {
      routineId: spec.id,
      name: def?.name ?? spec.name,
      category: def?.cat ?? "",
      wave: spec.wave,
      enabled: st?.enabled ?? false,
      version: st?.version ?? 1,
      availability,
      availabilityCopy: availabilityCopy(availability),
      canEnable: canEnable(availability),
      betterWith: helpful,
      betterWithCopy: betterWithCopy(helpful),
      recommended: recommendedFirst.includes(spec.id),
      lastRun: lastRunById.get(spec.id) ?? null,
      lastDraft: lastDraftById.get(spec.id) ?? null,
      skillSource: skillSourceFor(workflows, accountId, spec.id),
    };
  });

  const out: RoutinesStateListing = { routines, recommendedFirst, planChannel, connected, business };
  if (opts.routineId) {
    const last = lastRunById.get(opts.routineId);
    out.lastRunReceipts = last ? (await deps.store.listReceipts(accountId, { runId: last.id })).map(receiptLine) : [];
  }
  return out;
}

function receiptLine(r: Receipt) {
  return { id: r.id, kind: r.kind, platform: r.platform ?? null, description: r.description, createdAt: r.createdAt };
}

/** Persist the switch. Returns the routine's fresh view. */
export async function setRoutineEnabled(deps: RoutinesStateDeps, accountId: string, routineId: string, enabled: boolean): Promise<RoutineStateView> {
  if (!CATALOG_SPEC_BY_ID[routineId]) throw new Error(`routine "${routineId}" is not in the catalog`);
  await getOrInitState({ store: deps.store, now: deps.now }, accountId, routineId);
  await setEnabled({ store: deps.store, now: deps.now }, accountId, routineId, enabled);
  const listing = await routinesStateForAccount(deps, accountId);
  return listing.routines.find((r) => r.routineId === routineId)!;
}
