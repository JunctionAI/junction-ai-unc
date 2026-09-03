/* Hold / scale / turn-off as data.

   evaluateAdset(metrics, preset) walks META_ADSET_RULES in order; the first rule whose
   `when` holds gives the verdict. Deterministic: the same metrics + preset always yield the
   same verdict, reason code, reason line and proposed action. The LLM never picks a verdict —
   it may only WRITE the reasoning line from the numbers in `evidence`.

   Verdicts
     not_enough_data  the evidence gates are not met (spend under the minimum, or the ad set
                      is younger than minAgeHours) — nothing is judged
     turn_off         losing money past the cap — proposes meta.adset.pause
     hold             a blocking signal — no change, with a reason code and a next action
     scale            at/under the cap with a clean streak — proposes set_daily_budget
     keep             inside the acceptable band — nothing to do

   The CPA cap. Two sources, the same rules:
     • preset: targetCpa (the scale line) and maxCpa (the off line)
     • product price (the n8n oracle policy cpa_cap_off_hold_scale_v1): when the ad set carries
       `productPrice`, cap = productPrice × cpaCapFromProductPricePct / 100 and BOTH lines sit
       on it (at-or-below → scale, above → off). `productPrice: null` means the policy applies
       but the price is unmapped → hold pending_product_price; `undefined` means the policy
       is not in use for this ad set.

   Reason codes are shared with the n8n policy so the two can be compared on the same data:
     insufficient_or_initial_evidence · pending_3d_scale_streak · pending_product_price ·
     soft_off_blocked_unclean_measurement · cpa_over_cap · no_results_over_cap ·
     roas_under_floor · fatigue_frequency · fatigue_ctr · learning_hold · budget_not_read ·
     account_daily_budget_ceiling · at_or_below_cap · in_band
   Next actions name what unblocks a hold: GATHER_EVIDENCE · REPAIR_MEASUREMENT ·
     RESOLVE_PRODUCT_PRICE_MAPPING · REFRESH_CREATIVE · READ_BUDGET · REVIEW_BUDGET_CEILING.

   The order matters: evidence gates first, then money protection (with the soft-off block
   when measurement is not clean), then the reasons not to scale, then scaling, then the band.
   Every rule carries a stable id for the receipts. */

import type { MetaPreset } from "../presets";
import { withPresetDefaults } from "../presets";
import type { ActionProposal } from "../types";

export type Verdict = "scale" | "hold" | "turn_off" | "keep" | "not_enough_data";

export type ReasonCode =
  | "insufficient_or_initial_evidence"
  | "pending_3d_scale_streak"
  | "pending_product_price"
  | "soft_off_blocked_unclean_measurement"
  | "cpa_over_cap"
  | "no_results_over_cap"
  | "roas_under_floor"
  | "fatigue_frequency"
  | "fatigue_ctr"
  | "learning_hold"
  | "budget_not_read"
  | "account_daily_budget_ceiling"
  | "at_or_below_cap"
  | "in_band";

export type NextAction = "GATHER_EVIDENCE" | "REPAIR_MEASUREMENT" | "RESOLVE_PRODUCT_PRICE_MAPPING" | "REFRESH_CREATIVE" | "READ_BUDGET" | "REVIEW_BUDGET_CEILING";

export interface AdsetMetrics {
  adsetId: string;
  adsetName?: string;
  /** Spend over the read window (account currency). */
  spend: number;
  purchases: number;
  purchaseValue: number;
  /** spend / purchases; null when purchases = 0. */
  cpa: number | null;
  roas: number;
  frequency: number;
  ctr: number;
  /** CTR when the ad set was launched / last refreshed; null = unknown. */
  ctrBaseline?: number | null;
  /** Current daily budget (account currency); null = not read. */
  dailyBudget: number | null;
  /** Days since the last budget/creative change; null = unknown. */
  daysSinceLastChange?: number | null;
  /** Hours since the ad set started delivering; null = unknown (the age gate is skipped). */
  ageHours?: number | null;
  /** Consecutive days (ending today) with CPA at/under the cap; null = not measured. */
  daysAtOrBelowCapStreak?: number | null;
  /** false = platform revenue and store revenue do not reconcile — an OFF becomes a hold. */
  measurementClean?: boolean | null;
  /** Certified product price behind the ad set; null = policy applies but unmapped; undefined = policy not in use. */
  productPrice?: number | null;
  status?: string;
}

export interface CpaCaps {
  /** At/under → scale. */
  scaleLine: number;
  /** Over → turn off. */
  offLine: number;
  source: "preset" | "product_price";
}

export interface Evaluation {
  verdict: Verdict;
  ruleId: string;
  reasonCode: ReasonCode;
  /** The deterministic reason with the numbers that fired the rule. */
  reason: string;
  nextAction: NextAction | null;
  proposedAction: ActionProposal | null;
  /** The cap lines the judgement used. */
  caps: CpaCaps;
  /** The numbers the reason used — for the LLM's reasoning line and the receipt. */
  evidence: Record<string, number | string | boolean | null>;
}

export interface Rule {
  id: string;
  verdict: Verdict;
  reasonCode: ReasonCode;
  nextAction: NextAction | null;
  when(m: AdsetMetrics, p: MetaPreset, caps: CpaCaps): boolean;
  reason(m: AdsetMetrics, p: MetaPreset, caps: CpaCaps): string;
  propose?(m: AdsetMetrics, p: MetaPreset, caps: CpaCaps): ActionProposal | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function ctrDropPct(m: AdsetMetrics): number | null {
  if (m.ctrBaseline === undefined || m.ctrBaseline === null || m.ctrBaseline <= 0) return null;
  return round2(((m.ctrBaseline - m.ctr) / m.ctrBaseline) * 100);
}

/** The scaled daily budget: +scaleStepPct, never over maxBudgetChangePct, rounded to cents. */
export function scaledBudget(current: number, p: MetaPreset): number {
  const step = Math.min(p.scaleStepPct, p.maxBudgetChangePct);
  return round2(current * (1 + step / 100));
}

/** The cap lines for an ad set: the product-price cap when the policy is in use and the price
    is known, else the preset's target / max. */
export function cpaCaps(m: AdsetMetrics, p: MetaPreset): CpaCaps {
  if (m.productPrice !== undefined && m.productPrice !== null && m.productPrice > 0 && p.cpaCapFromProductPricePct > 0) {
    const cap = round2((m.productPrice * p.cpaCapFromProductPricePct) / 100);
    return { scaleLine: cap, offLine: cap, source: "product_price" };
  }
  return { scaleLine: p.targetCpa, offLine: p.maxCpa, source: "preset" };
}

const money = (n: number) => n.toFixed(2);
const cpaStr = (m: AdsetMetrics) => (m.cpa === null ? "no purchases" : `CPA ${money(m.cpa)}`);
const isOff = (m: AdsetMetrics, p: MetaPreset, caps: CpaCaps) => (m.purchases === 0 && m.spend >= caps.offLine) || (m.cpa !== null && m.cpa > caps.offLine) || (p.roasFloor > 0 && m.roas < p.roasFloor && m.cpa !== null && m.cpa > caps.scaleLine);
const streakKnown = (m: AdsetMetrics) => m.daysAtOrBelowCapStreak !== undefined && m.daysAtOrBelowCapStreak !== null;

export const META_ADSET_RULES: readonly Rule[] = [
  // ----- evidence gates -----
  {
    id: "not_enough_spend",
    verdict: "not_enough_data",
    reasonCode: "insufficient_or_initial_evidence",
    nextAction: "GATHER_EVIDENCE",
    when: (m, p) => m.spend < p.minSpendBeforeJudging,
    reason: (m, p) => `spend ${money(m.spend)} is under the ${money(p.minSpendBeforeJudging)} needed before judging`,
  },
  {
    id: "too_young",
    verdict: "not_enough_data",
    reasonCode: "insufficient_or_initial_evidence",
    nextAction: "GATHER_EVIDENCE",
    when: (m, p) => p.minAgeHours > 0 && m.ageHours !== undefined && m.ageHours !== null && m.ageHours < p.minAgeHours,
    reason: (m, p) => `only ${Math.round(m.ageHours!)}h of delivery — judging starts at ${p.minAgeHours}h`,
  },
  {
    id: "pending_product_price",
    verdict: "hold",
    reasonCode: "pending_product_price",
    nextAction: "RESOLVE_PRODUCT_PRICE_MAPPING",
    when: (m, p) => p.cpaCapFromProductPricePct > 0 && m.productPrice === null,
    reason: (_m, p) => `the CPA cap is ${p.cpaCapFromProductPricePct}% of the product price and this ad set has no certified price mapped — holding until it does`,
  },
  // ----- money protection -----
  {
    id: "soft_off_blocked",
    verdict: "hold",
    reasonCode: "soft_off_blocked_unclean_measurement",
    nextAction: "REPAIR_MEASUREMENT",
    when: (m, p, caps) => m.measurementClean === false && isOff(m, p, caps),
    reason: (m, _p, caps) => `${cpaStr(m)} reads over the ${money(caps.offLine)} cap, but platform and store revenue do not reconcile — not turning it off on a number I cannot trust`,
  },
  {
    id: "turn_off_no_results",
    verdict: "turn_off",
    reasonCode: "no_results_over_cap",
    nextAction: null,
    when: (m, _p, caps) => m.purchases === 0 && m.spend >= caps.offLine,
    reason: (m, _p, caps) => `spent ${money(m.spend)} with no purchases — past the ${money(caps.offLine)} cap${caps.source === "product_price" ? " (50% of product price)" : ""}`,
    propose: (m) => ({ actionId: "meta.adset.pause", params: { adsetId: m.adsetId, reason: "no purchases past the CPA cap" } }),
  },
  {
    id: "turn_off_cpa",
    verdict: "turn_off",
    reasonCode: "cpa_over_cap",
    nextAction: null,
    when: (m, _p, caps) => m.cpa !== null && m.cpa > caps.offLine,
    reason: (m, _p, caps) => `${cpaStr(m)} is over the ${money(caps.offLine)} cap${caps.source === "product_price" ? " (from the product price)" : ""}`,
    propose: (m) => ({ actionId: "meta.adset.pause", params: { adsetId: m.adsetId, reason: "CPA over the cap" } }),
  },
  {
    id: "turn_off_roas",
    verdict: "turn_off",
    reasonCode: "roas_under_floor",
    nextAction: null,
    when: (m, p, caps) => p.roasFloor > 0 && m.roas < p.roasFloor && m.cpa !== null && m.cpa > caps.scaleLine,
    reason: (m, p, caps) => `ROAS ${m.roas.toFixed(2)}× is under the ${p.roasFloor.toFixed(2)}× floor and ${cpaStr(m)} is over the ${money(caps.scaleLine)} line`,
    propose: (m) => ({ actionId: "meta.adset.pause", params: { adsetId: m.adsetId, reason: "ROAS under floor and CPA over target" } }),
  },
  // ----- reasons not to scale -----
  {
    id: "hold_fatigue_frequency",
    verdict: "hold",
    reasonCode: "fatigue_frequency",
    nextAction: "REFRESH_CREATIVE",
    when: (m, p) => m.frequency >= p.fatigueFrequency,
    reason: (m, p) => `frequency ${m.frequency.toFixed(2)} is at/over the fatigue line of ${p.fatigueFrequency.toFixed(2)} — refresh creative before adding budget`,
  },
  {
    id: "hold_fatigue_ctr",
    verdict: "hold",
    reasonCode: "fatigue_ctr",
    nextAction: "REFRESH_CREATIVE",
    when: (m, p) => {
      const d = ctrDropPct(m);
      return d !== null && d >= p.fatigueCtrDrop;
    },
    reason: (m, p) => `CTR is down ${ctrDropPct(m)}% from its baseline — past the ${p.fatigueCtrDrop}% fatigue line`,
  },
  {
    id: "hold_recent_change",
    verdict: "hold",
    reasonCode: "learning_hold",
    nextAction: "GATHER_EVIDENCE",
    when: (m, p) => m.daysSinceLastChange !== undefined && m.daysSinceLastChange !== null && m.daysSinceLastChange < p.holdDays,
    reason: (m, p) => `changed ${m.daysSinceLastChange} day${m.daysSinceLastChange === 1 ? "" : "s"} ago — holding ${p.holdDays} days for learning`,
  },
  {
    id: "hold_roas_under_floor",
    verdict: "hold",
    reasonCode: "roas_under_floor",
    nextAction: "GATHER_EVIDENCE",
    when: (m, p) => p.roasFloor > 0 && m.roas < p.roasFloor,
    reason: (m, p) => `${cpaStr(m)} is inside the cap but ROAS ${m.roas.toFixed(2)}× is under the ${p.roasFloor.toFixed(2)}× floor — mixed signal, no change`,
  },
  {
    id: "hold_pending_streak",
    verdict: "hold",
    reasonCode: "pending_3d_scale_streak",
    nextAction: "GATHER_EVIDENCE",
    when: (m, p, caps) => m.cpa !== null && m.cpa <= caps.scaleLine && p.scaleStreakDays > 0 && streakKnown(m) && m.daysAtOrBelowCapStreak! < p.scaleStreakDays,
    reason: (m, p, caps) => `${cpaStr(m)} is at/under the ${money(caps.scaleLine)} line but only ${m.daysAtOrBelowCapStreak} of the ${p.scaleStreakDays} consecutive days needed — waiting for the streak`,
  },
  {
    id: "scale_no_budget",
    verdict: "hold",
    reasonCode: "budget_not_read",
    nextAction: "READ_BUDGET",
    when: (m, _p, caps) => m.cpa !== null && m.cpa <= caps.scaleLine && (m.dailyBudget === null || m.dailyBudget <= 0),
    reason: (m, _p, caps) => `${cpaStr(m)} is at/under the ${money(caps.scaleLine)} line but the daily budget was not read — cannot size a step`,
  },
  // ----- scaling -----
  {
    id: "scale",
    verdict: "scale",
    reasonCode: "at_or_below_cap",
    nextAction: null,
    when: (m, _p, caps) => m.cpa !== null && m.cpa <= caps.scaleLine && m.dailyBudget !== null && m.dailyBudget > 0,
    reason: (m, p, caps) => `${cpaStr(m)} is at/under the ${money(caps.scaleLine)} line${streakKnown(m) ? ` for ${m.daysAtOrBelowCapStreak} consecutive days` : " over the window (streak not measured)"} and ROAS ${m.roas.toFixed(2)}× clears the floor — step the budget up ${Math.min(p.scaleStepPct, p.maxBudgetChangePct)}%`,
    propose: (m, p, caps) => ({ actionId: "meta.adset.set_daily_budget", params: { adsetId: m.adsetId, dailyBudget: scaledBudget(m.dailyBudget!, p), currentDailyBudget: m.dailyBudget!, reason: `CPA ${money(m.cpa!)} at/under the ${money(caps.scaleLine)} line` } }),
  },
  // ----- the band -----
  {
    id: "keep_in_band",
    verdict: "keep",
    reasonCode: "in_band",
    nextAction: null,
    when: () => true,
    reason: (m, _p, caps) => `${cpaStr(m)} sits between the ${money(caps.scaleLine)} scale line and the ${money(caps.offLine)} cap — inside the band, nothing to change`,
  },
];

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalise(metrics: AdsetMetrics): AdsetMetrics {
  const spend = num(metrics.spend);
  const purchases = num(metrics.purchases);
  return {
    ...metrics,
    spend,
    purchases,
    purchaseValue: num(metrics.purchaseValue),
    roas: num(metrics.roas),
    frequency: num(metrics.frequency),
    ctr: num(metrics.ctr),
    cpa: metrics.cpa === null || metrics.cpa === undefined ? (purchases ? round2(spend / purchases) : null) : num(metrics.cpa),
  };
}

export function evaluateAdset(metrics: AdsetMetrics, preset: MetaPreset | Partial<MetaPreset>): Evaluation {
  const p = withPresetDefaults(preset);
  const m = normalise(metrics);
  const caps = cpaCaps(m, p);
  for (const rule of META_ADSET_RULES) {
    if (!rule.when(m, p, caps)) continue;
    return {
      verdict: rule.verdict,
      ruleId: rule.id,
      reasonCode: rule.reasonCode,
      reason: rule.reason(m, p, caps),
      nextAction: rule.nextAction,
      proposedAction: rule.propose ? rule.propose(m, p, caps) : null,
      caps,
      evidence: {
        adsetId: m.adsetId,
        adsetName: m.adsetName ?? null,
        spend: m.spend,
        purchases: m.purchases,
        cpa: m.cpa,
        roas: m.roas,
        frequency: m.frequency,
        ctr: m.ctr,
        ctrDropPct: ctrDropPct(m),
        dailyBudget: m.dailyBudget,
        daysSinceLastChange: m.daysSinceLastChange ?? null,
        ageHours: m.ageHours ?? null,
        streakDays: m.daysAtOrBelowCapStreak ?? null,
        measurementClean: m.measurementClean ?? null,
        productPrice: m.productPrice ?? null,
        scaleLine: caps.scaleLine,
        offLine: caps.offLine,
        capSource: caps.source,
        roasFloor: p.roasFloor,
      },
    };
  }
  /* unreachable: keep_in_band always matches */
  throw new Error("no rule matched");
}

/** Priority when one decision must be picked across many ad sets: protect money first, then
    grow the winner, then the holds. Ties inside a verdict go to the larger spend. */
export const VERDICT_PRIORITY: Record<Verdict, number> = { turn_off: 0, scale: 1, hold: 2, keep: 3, not_enough_data: 4 };

export interface AccountEvaluationOptions {
  /** The account's daily budget ceiling (all ad sets together). A scale step that would take
      the total over it becomes a hold (account_daily_budget_ceiling). */
  accountDailyBudgetCap?: number | null;
}

export type AdsetEvaluation = Evaluation & { metrics: AdsetMetrics };

export interface AccountEvaluation {
  evaluations: AdsetEvaluation[];
  /** The one to act on today, or null when nothing proposes an action. */
  pick: AdsetEvaluation | null;
  counts: Record<Verdict, number>;
  /** Sum of the daily budgets that were read. */
  totalDailyBudget: number;
}

export function evaluateAdsets(all: AdsetMetrics[], preset: MetaPreset | Partial<MetaPreset>, opts: AccountEvaluationOptions = {}): AccountEvaluation {
  const totalDailyBudget = round2(all.reduce((a, m) => a + (m.dailyBudget ?? 0), 0));
  const cap = opts.accountDailyBudgetCap ?? null;
  const evaluations: AdsetEvaluation[] = all.map((m) => {
    const e = evaluateAdset(m, preset);
    if (e.verdict === "scale" && cap !== null && e.proposedAction) {
      const next = Number(e.proposedAction.params.dailyBudget);
      const cur = m.dailyBudget ?? 0;
      const total = round2(totalDailyBudget - cur + next);
      if (total > cap) {
        return {
          ...e,
          metrics: m,
          verdict: "hold",
          ruleId: "account_budget_ceiling",
          reasonCode: "account_daily_budget_ceiling",
          nextAction: "REVIEW_BUDGET_CEILING",
          proposedAction: null,
          reason: `${e.reason.split(" — ")[0]} — but stepping to ${money(next)}/day would take the account to ${money(total)}/day, over the ${money(cap)}/day ceiling`,
          evidence: { ...e.evidence, accountDailyBudgetCap: cap, totalDailyBudget, proposedTotal: total },
        };
      }
    }
    return { ...e, metrics: m };
  });
  const counts: Record<Verdict, number> = { scale: 0, hold: 0, turn_off: 0, keep: 0, not_enough_data: 0 };
  for (const e of evaluations) counts[e.verdict]++;
  const actionable = evaluations.filter((e) => e.proposedAction).sort((a, b) => VERDICT_PRIORITY[a.verdict] - VERDICT_PRIORITY[b.verdict] || b.metrics.spend - a.metrics.spend);
  return { evaluations, pick: actionable[0] ?? null, counts, totalDailyBudget };
}

const optNum = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : num(v));

/** A worker-reader / read-action row → AdsetMetrics. Accepts both snake_case reader rows
    (adset_id, purchase_value, daily_budget) and PerformanceRow camelCase. */
export function adsetMetricsFromRow(row: Record<string, unknown>, budgets?: Map<string, number | null>): AdsetMetrics {
  const id = String(row.adset_id ?? row.adsetId ?? row.id ?? "");
  const spend = num(row.spend);
  const purchases = num(row.purchases);
  const fromRow = row.daily_budget ?? row.dailyBudget;
  const budget = budgets?.has(id) ? (budgets.get(id) ?? null) : optNum(fromRow);
  const has = (k: string) => row[k] !== undefined;
  return {
    adsetId: id,
    adsetName: typeof (row.adset_name ?? row.adsetName ?? row.name) === "string" ? String(row.adset_name ?? row.adsetName ?? row.name) : undefined,
    spend,
    purchases,
    purchaseValue: num(row.purchase_value ?? row.purchaseValue),
    cpa: row.cpa === null || row.cpa === undefined ? (purchases ? round2(spend / purchases) : null) : num(row.cpa),
    roas: num(row.roas),
    frequency: num(row.frequency),
    ctr: num(row.ctr),
    ctrBaseline: has("ctr_baseline") || has("ctrBaseline") ? optNum(row.ctr_baseline ?? row.ctrBaseline) : null,
    dailyBudget: budget,
    daysSinceLastChange: has("days_since_change") || has("daysSinceLastChange") ? optNum(row.days_since_change ?? row.daysSinceLastChange) : null,
    ageHours: has("age_hours") || has("ageHours") ? optNum(row.age_hours ?? row.ageHours) : null,
    daysAtOrBelowCapStreak: has("streak_days") || has("daysAtOrBelowCapStreak") ? optNum(row.streak_days ?? row.daysAtOrBelowCapStreak) : null,
    measurementClean: typeof (row.measurement_clean ?? row.measurementClean) === "boolean" ? Boolean(row.measurement_clean ?? row.measurementClean) : null,
    ...(has("product_price") || has("productPrice") ? { productPrice: optNum(row.product_price ?? row.productPrice) } : {}),
    ...(typeof row.status === "string" ? { status: row.status } : {}),
  };
}
