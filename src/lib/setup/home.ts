/* Home in accounts mode — the real-only view model (docs/PRODUCT-EXPERIENCE.md "Real only").
   Pure over PlatformState + what the setup-progress / telemetry fetches return, so nothing
   from derive.ts's demo constants can reach a real account's Home:

     savedPlanTimeline  persisted phases only; agreement is not execution progress
     realProposals      "Setting up next" = phase-1 wave-1 routines not yet on, with the honest
                        availability ("needs Klaviyo connected" only when that connector is
                        really not connected)
     automationStrip    enabled / total, runs this week, hours saved — all from real rows
     categoryDots       per category, strictly routine_states.enabled (never the catalog's demo
                        "Active" defaults)
     cadenceLabel       the spec's trigger cron, in words
     HOME_COPY          the copy floor for the empty states */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { CATEGORIES, ALL_SYSTEMS } from "../platform/catalog";
import { scoreChannels, type ChannelKey } from "../platform/plan";
import type { PlatformState } from "../platform/state";
import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import type { Platform, RoutineId } from "../runtime/types";
import { modelFromProfile, type BusinessModel } from "../unc/businessType";
import { platformName, recommendationPool, requiredPlatform } from "./channels";
import type { AccountFacts } from "../unc/accountFacts";
import { fitsBusiness } from "../runtime/availability";

export const HOME_COPY = {
  nothingWaiting: "Nothing waiting on you right now — I’ll bring the next decision here.",
  noDraftsYet: "No drafts yet. Choose a ready routine to request a draft.",
  noDraftsRunning: "A routine is enabled. Its first verified draft will appear here after a successful run.",
  /** Generic on purpose: the platform is the founder's own (noKpiLine), never a default. */
  noKpi: "Connect a data source, select the right account, and verify its first read.",
  firstDay: "We can review your setup and choose a ready routine. Nothing has run yet.",
  firstDayRunning: "A routine is enabled. Check its run history for progress; enabled does not mean a run has finished.",
  paused: "Automation is paused for setup verification. Your connections and account chat remain available.",
  noPlan: "No saved plan yet. Confirm your business settings before reviewing a proposed plan.",
  noReceipts: "No receipts yet — the first run writes one, and it lands here.",
  nothingScheduled: "No enabled routines. A schedule is not proof of a completed run.",
  setupDone: "Setup milestones recorded ✓ — check run history for current activity.",
  goalNotSet: "Tell me the goal — a number and a date — and I’ll work the pace out from there.",
  allProposalsOn: "Every phase-1 routine is on. I’ll propose the next one when the numbers earn it.",
} as const;

// ---------- the plan timeline ----------

export interface PlanPhaseView {
  n: number;
  weeks: string;
  title: string;
  focus: string;
  st: "Done" | "Now" | "Next" | "Later" | "Draft" | "Agreed" | "Paused";
  on: boolean;
}

export function phaseChannels(S: Pick<PlatformState, "posture" | "obStrengths" | "budgetMo">): ChannelKey[] {
  return scoreChannels(S.posture, S.obStrengths ?? [], S.budgetMo).map((c) => c.k);
}

/** Persisted phases only. Time elapsed, default posture and a saved phase label
 * cannot prove execution progress. Agreement is consent to a plan, not a run. */
export function savedPlanTimeline(plan: AccountFacts["plan"], paused = false): PlanPhaseView[] {
  return (plan?.phases ?? []).map((p, i) => ({
    n: i + 1, weeks: `Phase ${i + 1}`, title: p.name, focus: p.from_you,
    st: paused ? "Paused" : plan?.agreedAt ? "Agreed" : "Draft", on: false,
  }));
}
export function savedPlanRoutineIds(plan: AccountFacts["plan"]): RoutineId[] {
  const names = new Set(plan?.phases[0]?.routines ?? []);
  return ALL_SYSTEMS.filter((s) => names.has(s.id) || names.has(s.name)).map((s) => s.id as RoutineId);
}

/** True when paid media is in the first two phases — the only time Home explains the ad budget. */
export function paidInPlan(S: Pick<PlatformState, "posture" | "obStrengths" | "budgetMo">): boolean {
  return phaseChannels(S).slice(0, 2).includes("Paid ads");
}

// ---------- "Setting up next" ----------

export interface ProposalView {
  id: RoutineId;
  name: string;
  why: string;
  ready: boolean;
  blocked: boolean;
  blockedLabel?: string;
  requiredPlatform: Platform | null;
}

const NAME_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s]));

const connectedSet = (S: Pick<PlatformState, "connState">): Set<string> =>
  new Set(
    Object.entries(S.connState)
      .filter(([, st]) => st === "ok")
      .map(([name]) => CONNECTOR_PLATFORMS[name])
      .filter(Boolean),
  );

/** Enabled routine ids, strictly from routine_states (S.routineOn is that table's projection). */
export function enabledRoutineIds(S: Pick<PlatformState, "routineOn">): RoutineId[] {
  return ALL_SYSTEMS.filter((s) => S.routineOn[s.name] === true).map((s) => s.id as RoutineId);
}

/** Name the founder's own first platform and the verification step, without promising a scheduled read. */
export function noKpiLine(anchorName: string | null | undefined): string {
  return anchorName ? `Connect ${anchorName}, select the right account, and verify its first read.` : HOME_COPY.noKpi;
}

/** The business model off the client state's scan profile (null fields when nothing is known). */
export function businessModelOf(S: { scan?: { profile: unknown } | null }): BusinessModel {
  return modelFromProfile(S.scan?.profile ?? null);
}

/** "Setting up next" = the recommendation pool (src/lib/setup/channels.ts recommendationPool:
    phase-1 wave-1 routines that fit the business, else the generic ones) minus what is on. */
export function realProposals(S: Pick<PlatformState, "routineOn" | "connState" | "posture" | "obStrengths" | "budgetMo"> & { scan?: PlatformState["scan"]; obPlatforms?: string[] }, savedRoutineIds?: readonly RoutineId[]): ProposalView[] {
  const channel = phaseChannels(S)[0];
  const on = new Set(enabledRoutineIds(S));
  const connected = connectedSet(S);
  const model = businessModelOf(S);
  const pool = savedRoutineIds === undefined
    ? recommendationPool(channel, { model, knownPlatforms: S.obPlatforms ?? [] })
    : CATALOG_SPECS.filter((spec) => savedRoutineIds.includes(spec.id) && spec.wave === 1 && fitsBusiness(spec, model));
  return pool
    .filter((spec) => !on.has(spec.id))
    .map((spec) => {
      const def = NAME_BY_ID.get(spec.id);
      const req = requiredPlatform(spec);
      const blocked = !!req && !connected.has(req);
      return {
        id: spec.id,
        name: def?.name ?? spec.id,
        why: `${def?.benefit ?? ""}${def?.benefit ? ". " : ""}Draft-only for now — nothing sends without you.`,
        ready: !blocked,
        blocked,
        blockedLabel: blocked ? `Needs ${platformName(req!)} connected` : undefined,
        requiredPlatform: req,
      };
    });
}

// ---------- automation strip ----------

export interface AutomationView {
  on: number;
  total: number;
  pct: string;
  runsThisWeek: number;
  hoursSavedWk: number;
  line: string;
  cats: { name: string; on: number; total: number; dots: boolean[]; sub: string }[];
}

export function automationStrip(S: Pick<PlatformState, "routineOn">, telemetry: { runsThisWeek: number; hoursSavedWk: number } | null): AutomationView {
  const on = enabledRoutineIds(S).length;
  const total = CATALOG_SPECS.length;
  const runs = telemetry?.runsThisWeek ?? 0;
  const hours = telemetry?.hoursSavedWk ?? 0;
  const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const cats = CATEGORIES.map((c) => {
    const dots = c.systems.map((n) => S.routineOn[n] === true);
    const onN = dots.filter(Boolean).length;
    return { name: c.name, on: onN, total: c.systems.length, dots, sub: onN === c.systems.length ? "All on ✓" : `${onN} of ${c.systems.length} on` };
  });
  return {
    on,
    total,
    pct: `${Math.round((on / total) * 100)}%`,
    runsThisWeek: runs,
    hoursSavedWk: hours,
    line: `${on} of ${total} routines on · ${runs} ${runs === 1 ? "run" : "runs"} this week · ~${hoursLabel} h saved this week`,
    cats,
  };
}

// ---------- running & next ----------

export function cadenceLabel(routineId: string): string {
  const spec = CATALOG_SPEC_BY_ID[routineId as RoutineId];
  const trig = spec?.nodes.find((n) => n.kind === "trigger");
  const cron = trig && trig.kind === "trigger" ? trig.cadence : "manual";
  switch (cron) {
    case "0 7 * * *":
      return "daily at 07:00";
    case "0 8 * * 1":
      return "weekly on Monday 08:00";
    case "0 */6 * * *":
      return "every 6 hours";
    case "0 * * * *":
      return "hourly";
    case "manual":
      return "on demand";
    default:
      return cron;
  }
}
