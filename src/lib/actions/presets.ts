/* Decision presets — the numbers the hold / scale / turn-off rules run on.

   The shape is owned here; the STORE (per-account presets, the inspector's editor) lives in
   src/lib/runtime/presets/ and is built separately. The two meet through PresetSource:

     interface PresetSource { getPreset(accountId, "meta"): Promise<Partial<MetaPreset> | null> }

   resolveMetaPreset(accountId, source) reads through the source, fills every missing field
   from the default (or the named industry preset) and validates the result, so a partial or
   malformed stored preset never reaches the rules. No source → DEFAULT_META_PRESET.

   Units: money in the account currency; percentages as whole numbers (20 = 20%). */

export interface MetaPreset {
  /** Which industry preset this was derived from ("dtc_general" …) — informational. */
  industry: MetaIndustry;
  /** The CPA we are happy to pay — at or under it an ad set may scale. */
  targetCpa: number;
  /** The CPA we will not tolerate — above it an ad set is turned off. */
  maxCpa: number;
  /** ROAS under this is a loss — an ad set below it (with a CPA over target) is turned off. */
  roasFloor: number;
  /** Spend (in the window) before any verdict but not_enough_data. */
  minSpendBeforeJudging: number;
  /** Frequency at/over which an ad set is fatigued (hold; refresh creative). */
  fatigueFrequency: number;
  /** CTR drop from baseline (%) at/over which an ad set is fatigued. */
  fatigueCtrDrop: number;
  /** Budget step when scaling (% of current daily budget). */
  scaleStepPct: number;
  /** Hard bound on any single daily-budget change (%, either direction). */
  maxBudgetChangePct: number;
  /** Days after a budget change during which the ad set is held (learning phase). */
  holdDays: number;
  /** CPA cap as a % of the certified product price when an ad set carries one (the n8n oracle
      policy uses 50). 0 = never derive the cap from price. */
  cpaCapFromProductPricePct: number;
  /** Hours of delivery before an ad set is judged at all (0 = no age gate). */
  minAgeHours: number;
  /** Consecutive days at/under the cap required before a scale, when the streak is measured (0 = off). */
  scaleStreakDays: number;
}

export type MetaIndustry = "dtc_general" | "dtc_fashion" | "dtc_supplements" | "dtc_premium" | "lead_gen_services" | "b2b_saas";

export const DEFAULT_META_PRESET: MetaPreset = {
  industry: "dtc_general",
  targetCpa: 40,
  maxCpa: 70,
  roasFloor: 2.0,
  minSpendBeforeJudging: 100,
  fatigueFrequency: 4.0,
  fatigueCtrDrop: 30,
  scaleStepPct: 20,
  maxBudgetChangePct: 25,
  holdDays: 3,
  cpaCapFromProductPricePct: 50,
  minAgeHours: 48,
  scaleStreakDays: 3,
};

/** Industry starting points. Numbers are conservative defaults a founder edits in the
    inspector — never a claim about any account. */
export const INDUSTRY_META_PRESETS: Record<MetaIndustry, MetaPreset> = {
  dtc_general: DEFAULT_META_PRESET,
  dtc_fashion: { ...DEFAULT_META_PRESET, industry: "dtc_fashion", targetCpa: 35, maxCpa: 60, roasFloor: 2.5, fatigueFrequency: 3.5, scaleStepPct: 20 },
  dtc_supplements: { ...DEFAULT_META_PRESET, industry: "dtc_supplements", targetCpa: 30, maxCpa: 55, roasFloor: 2.0, minSpendBeforeJudging: 120, fatigueFrequency: 4.5 },
  dtc_premium: { ...DEFAULT_META_PRESET, industry: "dtc_premium", targetCpa: 120, maxCpa: 220, roasFloor: 2.5, minSpendBeforeJudging: 300, fatigueFrequency: 3.0, scaleStepPct: 15, maxBudgetChangePct: 20, holdDays: 4 },
  lead_gen_services: { ...DEFAULT_META_PRESET, industry: "lead_gen_services", targetCpa: 25, maxCpa: 50, roasFloor: 0, minSpendBeforeJudging: 80, fatigueFrequency: 5.0, scaleStepPct: 25 },
  b2b_saas: { ...DEFAULT_META_PRESET, industry: "b2b_saas", targetCpa: 80, maxCpa: 160, roasFloor: 0, minSpendBeforeJudging: 200, fatigueFrequency: 5.0, scaleStepPct: 15, holdDays: 5 },
};

export const META_INDUSTRIES = Object.keys(INDUSTRY_META_PRESETS) as MetaIndustry[];

/** The interface the presets store implements (src/lib/runtime/presets/). */
export interface PresetSource {
  /** `routineId` lets a source layer routine_params over the account preset; a source may ignore it. */
  getPreset(accountId: string, platform: "meta", routineId?: string): Promise<Partial<MetaPreset> | null>;
}

/** A source that always answers the default (or a fixed preset) — tests and no-store wiring. */
export function staticPresetSource(preset: Partial<MetaPreset> | null = null): PresetSource {
  return { getPreset: async () => preset };
}

const NUMERIC_KEYS: (keyof Omit<MetaPreset, "industry">)[] = ["targetCpa", "maxCpa", "roasFloor", "minSpendBeforeJudging", "fatigueFrequency", "fatigueCtrDrop", "scaleStepPct", "maxBudgetChangePct", "holdDays", "cpaCapFromProductPricePct", "minAgeHours", "scaleStreakDays"];

/** Fill a partial preset from its industry default (or the general default) and repair
    anything that would make the rules incoherent. Never throws. */
export function withPresetDefaults(partial: Partial<MetaPreset> | null | undefined): MetaPreset {
  const industry = partial?.industry && partial.industry in INDUSTRY_META_PRESETS ? partial.industry : "dtc_general";
  const base = INDUSTRY_META_PRESETS[industry];
  const out: MetaPreset = { ...base, industry };
  for (const k of NUMERIC_KEYS) {
    const v = partial?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  // coherence: max CPA can never sit under target; a step can never exceed the hard bound
  if (out.maxCpa < out.targetCpa) out.maxCpa = out.targetCpa;
  if (out.scaleStepPct > out.maxBudgetChangePct) out.scaleStepPct = out.maxBudgetChangePct;
  if (out.scaleStepPct <= 0) out.scaleStepPct = base.scaleStepPct;
  if (out.maxBudgetChangePct <= 0) out.maxBudgetChangePct = base.maxBudgetChangePct;
  return out;
}

/** The preset the rules and guards use for an account. A source that throws counts as "none". */
export async function resolveMetaPreset(accountId: string, source?: PresetSource | null, routineId?: string): Promise<MetaPreset> {
  if (!source) return DEFAULT_META_PRESET;
  try {
    return withPresetDefaults(await source.getPreset(accountId, "meta", routineId));
  } catch {
    return DEFAULT_META_PRESET;
  }
}

/** One line per field for prompts and receipts. */
export function describePreset(p: MetaPreset, currency: string): string {
  return `${p.industry}: target CPA ${currency} ${p.targetCpa}, max CPA ${currency} ${p.maxCpa}${p.cpaCapFromProductPricePct ? ` (or ${p.cpaCapFromProductPricePct}% of product price when mapped)` : ""}, ROAS floor ${p.roasFloor}×, judge after ${currency} ${p.minSpendBeforeJudging} spend${p.minAgeHours ? ` and ${p.minAgeHours}h` : ""}, fatigue at frequency ${p.fatigueFrequency} or CTR −${p.fatigueCtrDrop}%, scale +${p.scaleStepPct}% (max ±${p.maxBudgetChangePct}%/day${p.scaleStreakDays ? `, after ${p.scaleStreakDays}d at/under cap` : ""}), hold ${p.holdDays}d after a change`;
}
