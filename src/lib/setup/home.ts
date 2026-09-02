/* Home in accounts mode — the real-only view model (docs/PRODUCT-EXPERIENCE.md "Real only").
   Pure over PlatformState + what the setup-progress / telemetry fetches return, so nothing
   from derive.ts's demo constants can reach a real account's Home:

     realPlanTimeline   the agreed plan's three phases with weeks counted from plans.agreed_at
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
import { scoreChannels, span, type ChannelKey } from "../platform/plan";
import type { PlatformState } from "../platform/state";
import { CATALOG_SPECS, CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import type { Platform, RoutineId } from "../runtime/types";
import { platformName, requiredPlatform, waveOneRoutines } from "./channels";

export const HOME_COPY = {
  nothingWaiting: "Nothing waiting on you right now — I’ll bring the next decision here.",
  noDraftsYet: "Turn on your first routine and I’ll have a draft here within the hour.",
  noDraftsRunning: "Your first routine is on — the first draft lands here within the hour.",
  noKpi: "Connect Shopify and I’ll read your last 90 days tonight.",
  firstDay: "I’ve read your plan. Turn on your first routine and I’ll have something for you within the hour.",
  firstDayRunning: "Your first routine is running. I’ll bring what I draft here and write your first brief tomorrow morning.",
  noReceipts: "No receipts yet — the first run writes one, and it lands here.",
  nothingScheduled: "Nothing scheduled yet — turn on your first routine and it runs on its cadence.",
  setupDone: "Set up ✓ — running on your plan.",
  goalNotSet: "Tell me the goal — a number and a date — and I’ll work the pace out from there.",
  allProposalsOn: "Every phase-1 routine is on. I’ll propose the next one when the numbers earn it.",
} as const;

// ---------- the plan timeline ----------

export interface PlanPhaseView {
  n: number;
  weeks: string;
  title: string;
  focus: string;
  st: "Done" | "Now" | "Next" | "Later";
  on: boolean;
}

const WEEK_MS = 6048e5;

/** ~30/30/40 split from a real anchor (plans.agreed_at) to the deadline; < 4 weeks clamps to 4. */
export function weekSplitFrom(anchorIso: string, deadline: string): { weeksLeft: number; w1: number; w2end: number } {
  const anchor = new Date(anchorIso).getTime();
  const end = new Date(`${deadline}T00:00:00`).getTime();
  const weeksLeft = Math.max(4, Math.round((end - anchor) / WEEK_MS));
  const w1 = Math.max(2, Math.round(weeksLeft * 0.3));
  const w2end = Math.min(weeksLeft - 1, w1 + Math.max(2, Math.round(weeksLeft * 0.3)));
  return { weeksLeft, w1, w2end };
}

export function phaseChannels(S: Pick<PlatformState, "posture" | "obStrengths" | "budgetMo">): ChannelKey[] {
  return scoreChannels(S.posture, S.obStrengths ?? [], S.budgetMo).map((c) => c.k);
}

/** The three phases as Home shows them. Without an agreed_at yet the phases still show (the
    plan is real) but carry no week numbers — weeks are counted from the day it was agreed. */
export function realPlanTimeline(S: Pick<PlatformState, "posture" | "obStrengths" | "budgetMo" | "deadline" | "planAgreedAt">, now: Date = new Date()): PlanPhaseView[] {
  const chans = phaseChannels(S);
  const rest = chans.slice(2).join(" + ");
  const titles = [`${chans[0]} — your strength, running first`, `Add ${chans[1].toLowerCase()}`, rest];
  const focus = ["Get the engine working. You: taste + okays.", "Turn momentum into revenue. You: a few okays a day.", "Switch on as the numbers earn it."];
  // No agreed_at (or no deadline yet, accounts mode): the phases are real but carry no week numbers.
  if (!S.planAgreedAt || !S.deadline) {
    return titles.map((title, i) => ({ n: i + 1, weeks: `Phase ${i + 1}`, title, focus: focus[i], st: i === 0 ? "Now" : i === 1 ? "Next" : "Later", on: i === 0 }));
  }
  const { weeksLeft, w1, w2end } = weekSplitFrom(S.planAgreedAt, S.deadline);
  const elapsed = Math.floor((now.getTime() - new Date(S.planAgreedAt).getTime()) / WEEK_MS) + 1; // week 1 starts on the agreed day
  const bounds: [number, number][] = [
    [1, w1],
    [w1 + 1, w2end],
    [w2end + 1, weeksLeft],
  ];
  const idx = bounds.findIndex(([, b]) => elapsed <= b);
  const current = idx === -1 ? 2 : idx;
  return titles.map((title, i) => {
    const [a, b] = bounds[i];
    const st: PlanPhaseView["st"] = i < current ? "Done" : i === current ? "Now" : i === current + 1 ? "Next" : "Later";
    return { n: i + 1, weeks: i === 2 ? `${span(a, b)}+` : span(a, b), title, focus: focus[i], st, on: st === "Now" };
  });
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

export function realProposals(S: Pick<PlatformState, "routineOn" | "connState" | "posture" | "obStrengths" | "budgetMo">): ProposalView[] {
  const channel = phaseChannels(S)[0];
  const on = new Set(enabledRoutineIds(S));
  const connected = connectedSet(S);
  return waveOneRoutines(channel)
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
