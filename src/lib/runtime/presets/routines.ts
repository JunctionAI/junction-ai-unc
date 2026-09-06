/* Presets ↔ routines: which domain a routine belongs to, which 3–6 fields matter for it, which
   of its steps are optional (switchable), and how saved values land in its spec.

     domainOf(routineId)                      D01 content · D02 paid · D03 seo · D04 sales · D05 email
     relevantFields(routineId)                the field keys the inspector shows for it
     optionalSteps(spec)                      nodes marked `optional: true` → toggle rows
     applyParamsToSpec(spec, params, off)     the node chain with the founder's numbers bound into
                                              the thresholds that read them and the switched-off
                                              optional steps removed — what saveDraft stores

   Binding is declarative (PARAM_BINDINGS: routine → field → node id + path) so a number the
   founder sets is visible in the draft spec itself, not only in a side table. D02-W01 also
   carries its rules-engine inputs in versioned decide.policy metadata. */

import type { DecideNode, MetaAdsetDecisionPolicy, Node, RoutineSpec } from "../types";
import { FIELDS_BY_DOMAIN, type PresetDomain, type PresetParams } from "./types";

export const DOMAIN_BY_CATEGORY: Record<string, PresetDomain> = { D01: "content", D02: "paid", D03: "seo", D04: "sales", D05: "email" };

export function domainOf(routineId: string): PresetDomain | null {
  return DOMAIN_BY_CATEGORY[routineId.slice(0, 3)] ?? null;
}

/** 3–6 fields per routine; a routine not listed shows its domain's first six. */
const RELEVANT: Record<string, string[]> = {
  // D02 paid
  "D02-W01": ["roasFloor", "scaleStepPct", "holdDays", "dailyBudgetCap", "targetCpa", "maxCpa"],
  "D02-W02": ["minSpendBeforeJudging", "targetCpa", "maxCpa", "dailyBudgetCap"],
  "D02-W03": ["fatigueFrequency", "fatigueCtrDropPct", "holdDays", "minSpendBeforeJudging"],
  "D02-W04": ["fatigueFrequency", "fatigueCtrDropPct", "maxCpa", "minSpendBeforeJudging"],
  "D02-W05": ["targetCpa", "minSpendBeforeJudging", "dailyBudgetCap"],
  "D02-W06": ["minSpendBeforeJudging", "targetCpa", "maxCpa", "holdDays"],
  "D02-W07": ["dailyBudgetCap", "scaleStepPct", "holdDays"],
  "D02-W08": ["targetCpa", "roasFloor", "dailyBudgetCap"],
  // D05 email
  "D05-W01": ["welcomeFlowLength", "discountCeilingPct", "sendCadencePerWeek"],
  "D05-W02": ["discountCeilingPct", "sendCadencePerWeek", "welcomeFlowLength"],
  "D05-W03": ["winbackWindowDays", "sendCadencePerWeek"],
  "D05-W04": ["winbackWindowDays", "discountCeilingPct", "sendCadencePerWeek"],
  "D05-W05": ["welcomeFlowLength", "discountCeilingPct", "winbackWindowDays"],
  "D05-W06": ["winbackWindowDays", "sendCadencePerWeek", "discountCeilingPct"],
  "D05-W07": ["sendCadencePerWeek", "discountCeilingPct", "winbackWindowDays"],
  "D05-W08": [],
  // D04 sales
  "D04-W01": ["leadScoreThreshold", "maxTouches", "followUpCadenceDays"],
  "D04-W02": ["maxTouches", "leadScoreThreshold", "followUpCadenceDays"],
  "D04-W04": ["followUpCadenceDays", "maxTouches", "leadScoreThreshold"],
  "D04-W06": ["followUpCadenceDays", "maxTouches"],
};

export function relevantFields(routineId: string): string[] {
  const domain = domainOf(routineId);
  if (!domain) return [];
  const all = FIELDS_BY_DOMAIN[domain].map((f) => f.key);
  if (Object.hasOwn(RELEVANT, routineId)) return RELEVANT[routineId].filter((k) => all.includes(k));
  return all.slice(0, 6);
}

// ---------- optional steps ----------

export interface OptionalStep {
  id: string;
  /** "Include: Gorgias tickets · 7d" */
  label: string;
  kind: Node["kind"];
}

/** The readable name of a node for a toggle row. */
export function stepLabel(n: Node): string {
  switch (n.kind) {
    case "read":
      return `${n.label ?? n.source.replace(/_/g, " ")} ${n.query.resource}${n.query.window ? ` · ${n.query.window}` : ""}`;
    case "check":
      return n.label ?? `${n.id.replace(/_/g, " ")} check`;
    default:
      return n.label ?? n.id.replace(/_/g, " ");
  }
}

/** Nodes the spec marks optional (today: the wave-1 optional reads). Never the trigger, produce, gate or receipt. */
export function optionalSteps(spec: Pick<RoutineSpec, "nodes">): OptionalStep[] {
  return spec.nodes.filter((n) => (n as { optional?: boolean }).optional === true && n.kind !== "trigger" && n.kind !== "produce" && n.kind !== "gate" && n.kind !== "receipt").map((n) => ({ id: n.id, label: stepLabel(n), kind: n.kind }));
}

// ---------- bindings ----------

interface Binding {
  field: string;
  nodeId: string;
  /** Dotted path inside the node; `[id=x]` selects an array item by id. */
  path: string;
  /** Turn the field value into what the path holds (default: identity). */
  map?: (v: number) => unknown;
}

const PARAM_BINDINGS: Record<string, Binding[]> = {
  "D02-W01": [
    { field: "roasFloor", nodeId: "decide", path: "rule.value" },
    { field: "scaleStepPct", nodeId: "decide", path: "options[id=scale].spend.multiplier", map: (v) => v / 100 },
    { field: "scaleStepPct", nodeId: "decide", path: "options[id=scale].params.changePct" },
  ],
  "D02-W04": [
    { field: "fatigueFrequency", nodeId: "tired_ad", path: "predicate.all[0].value" },
    { field: "minSpendBeforeJudging", nodeId: "decide", path: "rule.value" },
  ],
  "D02-W07": [
    { field: "dailyBudgetCap", nodeId: "over_pace", path: "predicate.any[0].value" },
    { field: "dailyBudgetCap", nodeId: "over_pace", path: "predicate.any[1].value" },
    { field: "dailyBudgetCap", nodeId: "decide", path: "rule.value" },
  ],
  "D04-W04": [{ field: "followUpCadenceDays", nodeId: "read_deals", path: "query.filter.lastActivityOlderThanDays" }],
  "D05-W04": [{ field: "winbackWindowDays", nodeId: "read_lapsed", path: "query.filter.lastOrderOlderThanDays" }],
};

export function bindingsFor(routineId: string): Binding[] {
  return PARAM_BINDINGS[routineId] ?? [];
}

/** Which fields of a routine actually change its spec (the rest steer the skill / the preset getter). */
export function boundFields(routineId: string): string[] {
  return [...new Set(bindingsFor(routineId).map((b) => b.field))];
}

const SEG_RE = /^([a-zA-Z_]+)(?:\[(?:(\d+)|id=([a-zA-Z_0-9]+))\])?$/;

function setPath(target: unknown, path: string, value: unknown): boolean {
  const segs = path.split(".");
  let cur: unknown = target;
  for (let i = 0; i < segs.length; i++) {
    const m = segs[i].match(SEG_RE);
    if (!m || !cur || typeof cur !== "object") return false;
    const [, key, idx, id] = m;
    const obj = cur as Record<string, unknown>;
    const last = i === segs.length - 1;
    if (idx === undefined && id === undefined) {
      if (last) {
        obj[key] = value;
        return true;
      }
      if (obj[key] === undefined || obj[key] === null) obj[key] = {};
      cur = obj[key];
      continue;
    }
    const arr = obj[key];
    if (!Array.isArray(arr)) return false;
    const item = idx !== undefined ? arr[Number(idx)] : arr.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === id);
    if (item === undefined) return false;
    if (last) return false; // a binding path never ends on an array item
    cur = item;
  }
  return false;
}

/** The chain with the founder's values bound in and the switched-off optional steps removed. Pure:
    the input spec is never mutated. Unknown node ids / paths are skipped, never thrown. */
export function applyParamsToSpec(spec: RoutineSpec, params: PresetParams, disabledSteps: string[] = []): Node[] {
  const optional = new Set(optionalSteps(spec).map((s) => s.id));
  const off = new Set(disabledSteps.filter((id) => optional.has(id)));
  const nodes: Node[] = spec.nodes.filter((n) => !off.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)) as Node);
  for (const b of bindingsFor(spec.id)) {
    const v = params[b.field];
    if (typeof v !== "number") continue;
    const node = nodes.find((n) => n.id === b.nodeId);
    if (!node) continue;
    setPath(node, b.path, b.map ? b.map(v) : v);
  }
  return nodes;
}

/** The D02-W01 rule engine reads routine-specific values only from this versioned snapshot.
    `routine_params` remains editor state; it cannot become live until these nodes are promoted.
    Only explicit routine overrides are snapshotted, so an absent key continues to inherit the
    account/industry preset at run time. */
export function applyDecisionPolicy(spec: Pick<RoutineSpec, "id">, nodes: Node[], routineParams: PresetParams = {}): Node[] {
  if (spec.id !== "D02-W01") return nodes;
  const decide = nodes.find((node): node is DecideNode => node.kind === "decide");
  if (!decide) return nodes;

  const preset: NonNullable<MetaAdsetDecisionPolicy["preset"]> = {};
  const copy = (from: string, to: keyof typeof preset = from as keyof typeof preset) => {
    const value = routineParams[from];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) preset[to] = value;
  };
  copy("targetCpa");
  copy("maxCpa");
  copy("roasFloor");
  copy("minSpendBeforeJudging");
  copy("fatigueFrequency");
  copy("fatigueCtrDropPct", "fatigueCtrDrop");
  copy("scaleStepPct");
  copy("holdDays");
  const dailyBudgetCap = routineParams.dailyBudgetCap;

  if (Object.keys(preset).length || (typeof dailyBudgetCap === "number" && Number.isFinite(dailyBudgetCap) && dailyBudgetCap >= 0)) {
    decide.policy = {
      kind: "meta.adset",
      ...(Object.keys(preset).length ? { preset } : {}),
      ...(typeof dailyBudgetCap === "number" && Number.isFinite(dailyBudgetCap) && dailyBudgetCap >= 0 ? { dailyBudgetCap } : {}),
    };
  } else {
    delete decide.policy;
  }
  return nodes;
}

/** True when saving these params / toggles would change the spec at all. */
export function changesSpec(spec: RoutineSpec, params: PresetParams, disabledSteps: string[] = []): boolean {
  return JSON.stringify(applyParamsToSpec(spec, params, disabledSteps)) !== JSON.stringify(spec.nodes);
}
