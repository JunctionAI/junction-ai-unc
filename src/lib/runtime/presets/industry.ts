/* Industry presets — defaults per business band, with provenance on every number.

   Seven bands (business type × category): DTC supplements · DTC apparel & accessories (the
   general DTC band) · local services · B2B / services · SaaS · creator · fitness / gym.
   Every number is a band, not a fake decimal, and carries where it came from: a playbook file
   under content/playbooks, a catalog constant (src/lib/runtime/catalog-specs.ts), the plan's
   learning gate (src/lib/platform/plan.ts), a derivation from the founder's own inputs, or
   "reasoned default" when the playbooks stop short of a number.

   Money fields (target / max cost per order, spend before judging, daily budget cap) can't come
   from a table: they are derived from the account — average order value × gross margin gives the
   allowable cost per first order (content/playbooks/paid/drop-and-scarcity-paid.md), the daily
   cap from the monthly budget ÷ 30 (the runtime's own SpendCaps). Without those inputs the field is
   null and the helper says what I need.

     pickBand(input)                  the nearest band + why (null when I don't know the model yet)
     resolvePreset(input, domain)     the domain's PresetSet: band values, or the conservative
                                      unknown-model defaults, plus the account's overrides on top

   Pure — no database (store.ts feeds it). */

import type { BusinessType, Sells, Storefront } from "../../unc/businessType";
import { FIELDS_BY_DOMAIN, isMoneyField, type IndustryValue, type PresetDomain, type PresetField, type PresetFieldDef, type PresetParams, type PresetSet, type PresetSource, type PresetValue } from "./types";

export type BandId = "dtc_supplements" | "dtc_apparel" | "local_services" | "b2b_services" | "saas" | "creator" | "fitness_gym";
export const BAND_IDS: readonly BandId[] = ["dtc_supplements", "dtc_apparel", "local_services", "b2b_services", "saas", "creator", "fitness_gym"] as const;
export const isBandId = (v: unknown): v is BandId => typeof v === "string" && (BAND_IDS as readonly string[]).includes(v);

export const BAND_LABEL: Record<BandId, string> = {
  dtc_supplements: "DTC supplements & consumables",
  dtc_apparel: "DTC apparel, accessories & general store",
  local_services: "Local services",
  b2b_services: "B2B & professional services",
  saas: "Software / SaaS",
  creator: "Creator / media",
  fitness_gym: "Fitness, gym & studio",
};

// ---------- provenance shorthands ----------

const P = {
  consolidated: "content/playbooks/paid/meta-consolidated-structure.md (plus twenty percent steps every few days, never doublings)",
  creativeScaling: "content/playbooks/paid/meta-creative-testing-and-scaling.md (raise budget by about twenty percent; retire creative when frequency runs high and click-through drops)",
  thinVolume: "content/playbooks/paid/google-ads-thin-volume.md (kill or keep on three-to-four-week windows)",
  fatigueCatalog: "src/lib/runtime/catalog-specs.ts D02-W04 (worst frequency ≥ 4; KPI worst frequency ≤ 3.5)",
  roasCatalog: "src/lib/runtime/catalog-specs.ts D02-W01 (scale the winner at 7-day ROAS ≥ 2.5; KPI blended ROAS 2.5)",
  learningGate: "src/lib/platform/plan.ts NZ$50/day learning gate · catalog D02-W04 (pause only past 50 spend)",
  allowableCpa: "derived: average order value × gross margin = allowable cost per first order (content/playbooks/paid/drop-and-scarcity-paid.md)",
  dailyCap: "derived: monthly budget ÷ 30 (the runtime's SpendCaps)",
  cadence: "content/playbooks/email/campaign-cadence-and-mix.md (three to five campaigns a week to the engaged segment, one or two to the broader list)",
  welcome: "content/playbooks/email/welcome-flow-that-converts.md (seven emails, day 0 to day 14)",
  winback: "content/playbooks/email/winback-sunset-cascade.md (lapsed 60–90+ days) · segmentation-and-list-health.md (lapsed = 90–180 days)",
  replenish: "content/playbooks/email/post-purchase-and-replenishment-flow.md (reminder at days of supply minus five; a 30-day pack reminds around day 25)",
  discountRestraint: "content/playbooks/email/winback-sunset-cascade.md + abandoned-cart-and-browse-recovery.md (a discount belongs only at the last step) — the percentage is a reasoned default",
  organicSocial: "content/playbooks/content/organic-social-operating-system.md (a steady three posts a week; education ~30 · product ~20 · proof ~20 · behind the scenes ~15 · lifestyle ~15)",
  hooks: "content/playbooks/content/hook-writing-and-viral-pattern-extraction.md (angle buckets: contrarian, taboo, personal history; test three to five hooks)",
  mediaCompany: "content/playbooks/content/media-company-content-system.md (people not logos; entertainment · inspiration · education · product)",
  keywordTiers: "content/playbooks/seo/keyword-tiers-and-content-velocity.md (one primary keyword per article; velocity is the biggest lever) — the count is a reasoned default",
  geo: "content/playbooks/seo/ai-search-visibility-geo.md (commercial journeys first, volume vanity never) — the floor is a reasoned default",
  crm: "content/playbooks/sales/crm-hygiene-and-stage-discipline.md (contacted: chase in about three days; qualified: reply within two days; proposal out: give a week)",
  pipeline: "content/playbooks/sales/b2b-pipeline-operating-rhythm.md (stalled at 7, 14 and 30 days)",
  leadSkill: "src/lib/runtime/skills/leadResearch.ts (provisional score 0–10) — the threshold is a reasoned default",
  reasoned: "reasoned default",
} as const;

// ---------- band tables ----------

/** A band's non-money numbers: low, high, value, provenance. */
type Cell = { low: number; high: number; value: number; provenance: string } | { value: string; provenance: string };
type BandParams = Record<string, Cell>;
type BandTable = Record<BandId, BandParams>;

const cell = (low: number, high: number, value: number, provenance: string): Cell => ({ low, high, value, provenance });
const pick = (value: string, provenance: string): Cell => ({ value, provenance });

/** Paid: what every band shares, then the per-band economics. Money fields are derived (see below). */
const PAID_COMMON: BandParams = {
  scaleStepPct: cell(10, 30, 20, P.consolidated),
  holdDays: cell(2, 7, 3, P.consolidated),
  fatigueFrequency: cell(3, 5, 4, P.fatigueCatalog),
  fatigueCtrDropPct: cell(15, 40, 25, `${P.creativeScaling} — the percentage is a reasoned default`),
};

const PAID: BandTable = {
  dtc_supplements: { ...PAID_COMMON, roasFloor: cell(2, 3, 2.5, `${P.roasCatalog}; repeat purchase carries the first order`) },
  dtc_apparel: { ...PAID_COMMON, roasFloor: cell(2.5, 4, 3, `${P.roasCatalog}; returns and one-off buys need more margin on the first order — reasoned`) },
  local_services: { ...PAID_COMMON, roasFloor: cell(2, 4, 3, `${P.reasoned} — one booking's value over its ad cost`), holdDays: cell(7, 28, 14, `${P.thinVolume} — a local account rarely clears one conversion a day`) },
  b2b_services: { ...PAID_COMMON, roasFloor: cell(2, 5, 3, `${P.reasoned} — pipeline value over spend, judged on won deals`), holdDays: cell(14, 28, 21, P.thinVolume) },
  saas: { ...PAID_COMMON, roasFloor: cell(1, 3, 2, `${P.reasoned} — first-year subscription value, not first payment`), holdDays: cell(7, 21, 14, P.thinVolume) },
  creator: { ...PAID_COMMON, roasFloor: cell(1, 3, 1.5, `${P.reasoned} — audience growth spend rarely pays back inside a window`), scaleStepPct: cell(10, 20, 15, P.consolidated) },
  fitness_gym: { ...PAID_COMMON, roasFloor: cell(2, 4, 3, `${P.reasoned} — a membership's first three months over its ad cost`), holdDays: cell(5, 14, 7, P.thinVolume) },
};

/** Cost-per-first-order as a share of the allowable (AOV × margin). Repeat categories can pay the whole first-order margin. */
const CPA_OF_ALLOWABLE_PCT: Record<BandId, { target: [number, number, number]; max: [number, number, number]; why: string }> = {
  dtc_supplements: { target: [60, 90, 80], max: [90, 120, 100], why: "replenishment: the second order pays for the first" },
  dtc_apparel: { target: [40, 70, 60], max: [70, 100, 80], why: "one-off buys and returns: the first order has to carry itself" },
  local_services: { target: [40, 70, 50], max: [70, 100, 80], why: "one booking has to carry its ad cost" },
  b2b_services: { target: [10, 30, 20], max: [30, 50, 40], why: "a lead is not a deal: a fraction of average job value × close rate" },
  saas: { target: [20, 50, 30], max: [50, 80, 60], why: "a sign-up pays back over months, not on day one" },
  creator: { target: [20, 50, 30], max: [50, 80, 60], why: "a follower or subscriber pays back slowly" },
  fitness_gym: { target: [50, 80, 60], max: [80, 120, 100], why: "a membership pays back over its first months" },
};

const EMAIL: BandTable = {
  dtc_supplements: { sendCadencePerWeek: cell(2, 4, 3, P.cadence), welcomeFlowLength: cell(5, 7, 7, P.welcome), winbackWindowDays: cell(45, 90, 60, `${P.replenish} · ${P.winback}`), discountCeilingPct: cell(0, 15, 10, P.discountRestraint) },
  dtc_apparel: { sendCadencePerWeek: cell(2, 4, 3, P.cadence), welcomeFlowLength: cell(4, 7, 6, P.welcome), winbackWindowDays: cell(60, 120, 90, P.winback), discountCeilingPct: cell(0, 20, 15, P.discountRestraint) },
  local_services: { sendCadencePerWeek: cell(1, 2, 1, `${P.cadence} — broader-list cadence`), welcomeFlowLength: cell(2, 4, 3, `${P.welcome} — shortened; reasoned`), winbackWindowDays: cell(60, 180, 90, P.winback), discountCeilingPct: cell(0, 10, 0, P.discountRestraint) },
  b2b_services: { sendCadencePerWeek: cell(1, 2, 1, `${P.cadence} — broader-list cadence`), welcomeFlowLength: cell(2, 4, 3, `${P.welcome} — shortened; reasoned`), winbackWindowDays: cell(90, 180, 120, P.winback), discountCeilingPct: cell(0, 0, 0, `${P.discountRestraint} — never discount a service`) },
  saas: { sendCadencePerWeek: cell(1, 2, 1, `${P.cadence} — broader-list cadence`), welcomeFlowLength: cell(4, 7, 5, P.welcome), winbackWindowDays: cell(30, 90, 45, `${P.winback} — a lapsed trial goes cold fast; reasoned`), discountCeilingPct: cell(0, 20, 0, `${P.discountRestraint} — trials, not discounts`) },
  creator: { sendCadencePerWeek: cell(1, 3, 1, P.cadence), welcomeFlowLength: cell(2, 5, 3, `${P.welcome} — shortened; reasoned`), winbackWindowDays: cell(60, 120, 90, P.winback), discountCeilingPct: cell(0, 20, 0, P.discountRestraint) },
  fitness_gym: { sendCadencePerWeek: cell(1, 3, 2, P.cadence), welcomeFlowLength: cell(3, 5, 4, `${P.welcome} — shortened; reasoned`), winbackWindowDays: cell(30, 90, 45, `${P.winback} — a lapsed member is lapsed at a month; reasoned`), discountCeilingPct: cell(0, 20, 10, P.discountRestraint) },
};

const CONTENT: BandTable = {
  dtc_supplements: { postsPerWeek: cell(3, 5, 3, P.organicSocial), formatsMix: pick("education_led", P.organicSocial), hookStyle: pick("proof", P.hooks) },
  dtc_apparel: { postsPerWeek: cell(3, 7, 4, P.organicSocial), formatsMix: pick("founder_led", `${P.organicSocial} · ${P.mediaCompany}`), hookStyle: pick("story", P.hooks) },
  local_services: { postsPerWeek: cell(2, 4, 3, P.organicSocial), formatsMix: pick("proof_led", P.organicSocial), hookStyle: pick("proof", P.hooks) },
  b2b_services: { postsPerWeek: cell(2, 3, 2, `${P.organicSocial} — LinkedIn cadence; reasoned`), formatsMix: pick("education_led", P.organicSocial), hookStyle: pick("contrarian", P.hooks) },
  saas: { postsPerWeek: cell(2, 4, 3, P.organicSocial), formatsMix: pick("education_led", P.organicSocial), hookStyle: pick("how_to", P.hooks) },
  creator: { postsPerWeek: cell(4, 7, 5, `${P.mediaCompany} — a creator's cadence; reasoned`), formatsMix: pick("entertainment_led", P.mediaCompany), hookStyle: pick("story", P.hooks) },
  fitness_gym: { postsPerWeek: cell(3, 5, 4, P.organicSocial), formatsMix: pick("proof_led", P.organicSocial), hookStyle: pick("proof", P.hooks) },
};

const SEO: BandTable = {
  dtc_supplements: { targetKeywordsPerMonth: cell(2, 6, 4, P.keywordTiers), minSearchVolume: cell(20, 200, 50, P.geo) },
  dtc_apparel: { targetKeywordsPerMonth: cell(2, 6, 4, P.keywordTiers), minSearchVolume: cell(20, 200, 50, P.geo) },
  local_services: { targetKeywordsPerMonth: cell(1, 3, 2, `${P.keywordTiers} — a local map pack needs few terms`), minSearchVolume: cell(10, 100, 20, `${P.geo} — local volumes are small`) },
  b2b_services: { targetKeywordsPerMonth: cell(2, 4, 3, P.keywordTiers), minSearchVolume: cell(10, 100, 30, `${P.geo} — buyer terms are small and worth it`) },
  saas: { targetKeywordsPerMonth: cell(4, 12, 8, `${P.keywordTiers} — velocity is the biggest lever`), minSearchVolume: cell(20, 300, 50, P.geo) },
  creator: { targetKeywordsPerMonth: cell(1, 4, 2, `${P.keywordTiers} — search is a side channel for a creator`), minSearchVolume: cell(20, 300, 100, P.geo) },
  fitness_gym: { targetKeywordsPerMonth: cell(1, 3, 2, `${P.keywordTiers} — local intent terms`), minSearchVolume: cell(10, 100, 20, `${P.geo} — local volumes are small`) },
};

const SALES: BandTable = {
  dtc_supplements: { followUpCadenceDays: cell(2, 5, 3, P.crm), maxTouches: cell(2, 5, 3, P.reasoned), leadScoreThreshold: cell(5, 8, 6, P.leadSkill) },
  dtc_apparel: { followUpCadenceDays: cell(2, 5, 3, P.crm), maxTouches: cell(2, 5, 3, P.reasoned), leadScoreThreshold: cell(5, 8, 6, P.leadSkill) },
  local_services: { followUpCadenceDays: cell(1, 3, 2, `${P.crm} — an enquiry cools in a day`), maxTouches: cell(2, 4, 3, P.reasoned), leadScoreThreshold: cell(4, 7, 5, P.leadSkill) },
  b2b_services: { followUpCadenceDays: cell(3, 7, 3, `${P.crm} · ${P.pipeline}`), maxTouches: cell(3, 6, 5, P.reasoned), leadScoreThreshold: cell(6, 8, 7, P.leadSkill) },
  saas: { followUpCadenceDays: cell(2, 5, 3, P.crm), maxTouches: cell(3, 6, 4, P.reasoned), leadScoreThreshold: cell(5, 8, 6, P.leadSkill) },
  creator: { followUpCadenceDays: cell(3, 7, 5, `${P.crm} — sponsor conversations run slower; reasoned`), maxTouches: cell(2, 4, 3, P.reasoned), leadScoreThreshold: cell(5, 8, 6, P.leadSkill) },
  fitness_gym: { followUpCadenceDays: cell(1, 3, 2, `${P.crm} — a trial enquiry cools in a day`), maxTouches: cell(2, 5, 3, P.reasoned), leadScoreThreshold: cell(4, 7, 5, P.leadSkill) },
};

const TABLES: Record<PresetDomain, BandTable> = { paid: PAID, email: EMAIL, content: CONTENT, seo: SEO, sales: SALES };

/** Conservative values when the model is unknown — the middle of the road, never the aggressive end. */
const UNKNOWN: Record<PresetDomain, BandParams> = {
  paid: { ...PAID_COMMON, roasFloor: cell(2, 4, 3, `${P.roasCatalog} — conservative until I know the model`), holdDays: cell(3, 14, 7, `${P.consolidated} · ${P.thinVolume} — conservative`) },
  email: { sendCadencePerWeek: cell(1, 3, 1, `${P.cadence} — broader-list cadence until I know the list`), welcomeFlowLength: cell(3, 7, 4, P.welcome), winbackWindowDays: cell(60, 120, 90, P.winback), discountCeilingPct: cell(0, 10, 0, P.discountRestraint) },
  content: { postsPerWeek: cell(2, 4, 3, P.organicSocial), formatsMix: pick("education_led", P.organicSocial), hookStyle: pick("proof", P.hooks) },
  seo: { targetKeywordsPerMonth: cell(1, 4, 2, P.keywordTiers), minSearchVolume: cell(20, 200, 50, P.geo) },
  sales: { followUpCadenceDays: cell(2, 5, 3, P.crm), maxTouches: cell(2, 5, 3, P.reasoned), leadScoreThreshold: cell(5, 8, 6, P.leadSkill) },
};

/** The whole table, read-only — docs/PRESETS.md and the tests walk it. */
export const BAND_TABLES: Readonly<Record<PresetDomain, BandTable>> = TABLES;
export const UNKNOWN_MODEL_PARAMS: Readonly<Record<PresetDomain, BandParams>> = UNKNOWN;
export const CPA_SHARE_OF_ALLOWABLE = CPA_OF_ALLOWABLE_PCT;

// ---------- picking the band ----------

export interface ResolveInput {
  businessType?: BusinessType | null;
  sells?: Sells | null;
  storefront?: Storefront | null;
  /** The scan's category line ("Luxury women's golf apparel", "Marine collagen supplements"). */
  category?: string | null;
  /** Name + one-liner + products, joined — extra words for the keyword read. */
  descriptor?: string | null;
  /** The niche brief's band, when one was written (it wins over the keyword read). */
  nicheBand?: BandId | null;
  currency?: string | null;
  /** Average order value in the account currency (kpi_snapshots aov_28d, or the founder). */
  aov?: number | null;
  /** Gross margin, 0–100 (resource_profiles.gross_margin_pct). */
  grossMarginPct?: number | null;
  /** resource_profiles.budget_monthly — the hard rail. */
  budgetMonthly?: number | null;
}

const SUPPLEMENT_RE = /supplement|vitamin|nutrition|collagen|protein|probiotic|wellness|health|skincare|skin care|cosmetic|beauty|coffee|tea\b|snack|food|pet|consumable|replenish|subscription box/i;
const FITNESS_RE = /\bgym\b|fitness|crossfit|pilates|yoga|personal train|bootcamp|f45|martial arts|\bmma\b|boxing|climbing/i;
const APPAREL_RE = /apparel|clothing|fashion|jewel|bag|footwear|shoe|golf|sport(?:s)?wear|accessor|homeware|furniture|decor|gift|watch|eyewear/i;

export interface BandPick {
  band: BandId | null;
  why: string;
}

/** The nearest band and why, in one line. Null band = I don't know the model yet. */
export function pickBand(input: ResolveInput): BandPick {
  const text = [input.category, input.descriptor].filter(Boolean).join(" · ");
  if (input.nicheBand) return { band: input.nicheBand, why: `my read of your market put you with ${BAND_LABEL[input.nicheBand].toLowerCase()}` };
  if (FITNESS_RE.test(text) && (input.businessType === "local" || input.businessType === "services" || input.businessType === "creator" || !input.businessType)) {
    return { band: "fitness_gym", why: `"${input.category ?? "your category"}" reads as fitness — memberships and class packs, not one-off orders` };
  }
  // A known non-store type wins over "sells products" (a wholesaler sells products; it is not a DTC store).
  const store = input.businessType === "ecommerce" || (!input.businessType && ((input.storefront && input.storefront !== "none") || input.sells === "products"));
  if (store) {
    if (SUPPLEMENT_RE.test(text)) return { band: "dtc_supplements", why: `a store selling "${input.category ?? "consumables"}" — repeat purchase and replenishment set the economics` };
    if (APPAREL_RE.test(text)) return { band: "dtc_apparel", why: `a store selling "${input.category ?? "products"}" — one-off buys and returns set the economics` };
    return { band: "dtc_apparel", why: `a store selling "${input.category ?? "products"}" — the general DTC band is the nearest fit until I know the category better` };
  }
  switch (input.businessType) {
    case "local":
      return { band: "local_services", why: "a place people visit or book — enquiries and bookings, small local search volumes" };
    case "services":
    case "b2b":
      return { band: "b2b_services", why: input.businessType === "b2b" ? "accounts, quotes and demos — pipeline economics, never discounts" : "clients and enquiries — a lead is not a deal, so I judge on won work" };
    case "saas":
      return { band: "saas", why: "subscriptions and trials — a sign-up pays back over months" };
    case "creator":
      return { band: "creator", why: "an audience and sponsors — growth spend pays back slowly" };
    default:
      return { band: null, why: "I don't know your model yet — these are conservative until the scan or you tell me" };
  }
}

// ---------- resolving a domain ----------

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Money ranges the table can't hold: derived from the account's own numbers, else null. */
function derivedMoney(key: string, band: BandId | null, input: ResolveInput): IndustryValue {
  const cur = input.currency ?? "";
  if (key === "dailyBudgetCap") {
    if (typeof input.budgetMonthly === "number" && input.budgetMonthly > 0) {
      const v = Math.max(1, Math.round(input.budgetMonthly / 30));
      return { low: v, high: v, value: v, provenance: P.dailyCap };
    }
    return { low: null, high: null, value: null, provenance: `${P.dailyCap} — set your monthly budget and this follows` };
  }
  if (key === "minSpendBeforeJudging") return { low: 30, high: 100, value: 50, provenance: `${P.learningGate}${cur && cur !== "NZD" ? ` — stated in NZ$, applied in ${cur}` : ""}` };
  if (key === "targetCpa" || key === "maxCpa") {
    const share = CPA_OF_ALLOWABLE_PCT[band ?? "dtc_apparel"][key === "targetCpa" ? "target" : "max"];
    const why = band ? CPA_OF_ALLOWABLE_PCT[band].why : "conservative until I know the model";
    if (typeof input.aov === "number" && input.aov > 0 && typeof input.grossMarginPct === "number" && input.grossMarginPct > 0) {
      const allowable = input.aov * (input.grossMarginPct / 100);
      const step = allowable >= 100 ? 5 : 1;
      return { low: Math.max(1, round((allowable * share[0]) / 100, step)), high: Math.max(1, round((allowable * share[1]) / 100, step)), value: Math.max(1, round((allowable * share[2]) / 100, step)), provenance: `${P.allowableCpa}; ${share[0]}–${share[1]}% of it for this band (${why})` };
    }
    return { low: null, high: null, value: null, provenance: `${P.allowableCpa} — I need your average order value and gross margin to set this` };
  }
  return { low: null, high: null, value: null, provenance: P.reasoned };
}

function industryFor(def: PresetFieldDef, band: BandId | null, domain: PresetDomain, input: ResolveInput): IndustryValue {
  if (isMoneyField(def)) return derivedMoney(def.key, band, input);
  const c = (band ? TABLES[domain][band] : UNKNOWN[domain])[def.key];
  if (!c) return { low: null, high: null, value: null, provenance: P.reasoned };
  if ("low" in c) return { low: c.low, high: c.high, value: c.value, provenance: c.provenance };
  return { low: null, high: null, value: c.value, provenance: c.provenance };
}

export interface ResolveOverrides {
  /** account_presets (domain-wide) — applied first. */
  account?: PresetParams | null;
  accountSource?: PresetSource;
  /** routine_params (one routine) — applied on top. */
  routine?: PresetParams | null;
  routineSource?: PresetSource;
}

/** The domain's fields with the band's values, the account's overrides, then the routine's — each
    field says which layer it came from. Money fields render in `currency`. */
export function resolvePreset(input: ResolveInput, domain: PresetDomain, overrides: ResolveOverrides = {}): PresetSet {
  const { band, why } = pickBand(input);
  const currency = input.currency ?? "NZD";
  const fields: PresetField[] = FIELDS_BY_DOMAIN[domain].map((def) => {
    const industry = industryFor(def, band, domain, input);
    let value: PresetValue = industry.value;
    let source: PresetSource = def.key === "dailyBudgetCap" && industry.value !== null ? "founder" : "industry";
    const acc = overrides.account?.[def.key];
    if (acc !== undefined && acc !== null) {
      value = acc;
      source = overrides.accountSource ?? "founder";
    }
    const rt = overrides.routine?.[def.key];
    if (rt !== undefined && rt !== null) {
      value = rt;
      source = overrides.routineSource ?? "founder";
    }
    return {
      key: def.key,
      kind: def.kind,
      label: def.label,
      unit: def.unit,
      helper: def.helper,
      range: def.kind === "number" ? def.range : null,
      options: def.kind === "choice" ? def.options : null,
      value,
      source,
      industry,
    };
  });
  return { domain, currency, band: band ? { id: band, label: BAND_LABEL[band], why } : null, fields };
}

/** Just the values (field key → value) of a resolved set. */
export function paramsOf(set: PresetSet): PresetParams {
  return Object.fromEntries(set.fields.map((f) => [f.key, f.value]));
}

/** "Industry: NZ$25–35 · yours: NZ$30" — the one line the inspector shows under a field. */
export function industryLine(f: PresetField, currency: string): string {
  const fmt = (v: PresetValue) => formatValue(v, f, currency);
  const ind = f.industry;
  let left: string;
  if (!ind || (ind.value === null && ind.low === null)) left = "Industry: not set yet";
  else if (f.kind === "choice" || ind.low === null || ind.high === null || ind.low === ind.high) left = `Industry: ${fmt(ind.value)}`;
  else left = f.unit === "money" ? `Industry: ${fmt(ind.low)}–${fmt(ind.high).replace(currencySymbol(currency), "")}` : `Industry: ${fmt(ind.low)}–${fmt(ind.high)}`;
  return `${left} · yours: ${f.value === null ? "not set" : fmt(f.value)}`;
}

export function formatValue(v: PresetValue, f: Pick<PresetField, "kind" | "unit" | "options">, currency: string): string {
  if (v === null) return "not set";
  if (f.kind === "choice") return f.options?.find((o) => o.value === v)?.label.replace(/\s*\(.*\)$/, "") ?? String(v);
  const n = typeof v === "number" ? v : Number(v);
  switch (f.unit) {
    case "money":
      return `${currencySymbol(currency)}${Number.isInteger(n) ? n.toLocaleString("en-NZ") : n.toFixed(2)}`;
    case "x":
      return `${n}×`;
    case "%":
      return `${n}%`;
    case "":
      return String(n);
    default:
      return `${n} ${f.unit}`;
  }
}

export function currencySymbol(currency: string): string {
  switch ((currency || "").toUpperCase()) {
    case "NZD":
      return "NZ$";
    case "AUD":
      return "A$";
    case "USD":
      return "US$";
    case "GBP":
      return "£";
    case "EUR":
      return "€";
    case "CAD":
      return "C$";
    default:
      return currency ? `${currency} ` : "$";
  }
}
