/* Industry parameter presets — the schema.

   Founder intent: "There are parameters — target CPA, max CPA, what you hold, scale, turn off —
   based on industry levels. They don't need to be over-complicated." So: per domain a SMALL typed
   set of fields, each with a plain-language label, a one-line helper in Unc's voice, a sane range,
   and a `source` that says who set it (industry band · the founder · Unc).

   Values are numbers, a choice from a short list, or null — null means "I don't have what I need
   to set this" (a money field before the average order value is known), never a guess.

   Pure: no database, no network. src/lib/runtime/presets/industry.ts holds the bands;
   store.ts reads / writes the account's overrides. */

export type PresetDomain = "paid" | "email" | "content" | "seo" | "sales";
export const PRESET_DOMAINS: readonly PresetDomain[] = ["paid", "email", "content", "seo", "sales"] as const;
export const isPresetDomain = (v: unknown): v is PresetDomain => typeof v === "string" && (PRESET_DOMAINS as readonly string[]).includes(v);

/** Who set a value: the industry band, the founder (inspector / API), or Unc (a self-review adjustment). */
export type PresetSource = "industry" | "founder" | "unc";
export const isPresetSource = (v: unknown): v is PresetSource => v === "industry" || v === "founder" || v === "unc";

/** "money" renders in the account currency; "x" is a multiple (ROAS, frequency); the rest are literal. */
export type PresetUnit = "money" | "x" | "%" | "days" | "per week" | "per month" | "emails" | "touches" | "score" | "searches / month" | "";

export type PresetValue = number | string | null;

export interface NumberFieldDef {
  key: string;
  kind: "number";
  label: string;
  unit: PresetUnit;
  /** One line, Unc's voice — what the number does. */
  helper: string;
  /** Inclusive; a founder value outside it is refused. */
  range: [number, number];
  /** Slider granularity. */
  step: number;
  integer?: boolean;
}

export interface ChoiceFieldDef {
  key: string;
  kind: "choice";
  label: string;
  unit: "";
  helper: string;
  options: { value: string; label: string }[];
}

export type PresetFieldDef = NumberFieldDef | ChoiceFieldDef;

/** The industry side of a field: a band's range and value plus where the number comes from. */
export interface IndustryValue {
  low: number | null;
  high: number | null;
  value: PresetValue;
  /** "content/playbooks/paid/meta-consolidated-structure.md" · "reasoned default" · "derived: AOV × margin". */
  provenance: string;
}

/** One resolved field as the inspector / API sees it. */
export interface PresetField {
  key: string;
  kind: "number" | "choice";
  label: string;
  unit: PresetUnit;
  helper: string;
  range: [number, number] | null;
  options: { value: string; label: string }[] | null;
  value: PresetValue;
  source: PresetSource;
  industry: IndustryValue | null;
}

export type PresetParams = Record<string, PresetValue>;

export interface PresetBandRef {
  id: string;
  label: string;
  /** Why this band was picked, one line. */
  why: string;
}

/** A domain's resolved parameter set for an account. */
export interface PresetSet {
  domain: PresetDomain;
  currency: string;
  band: PresetBandRef | null;
  fields: PresetField[];
}

// ---------- the fields, per domain ----------

const money = (key: string, label: string, helper: string, range: [number, number], step = 1): NumberFieldDef => ({ key, kind: "number", label, unit: "money", helper, range, step });
const num = (key: string, label: string, unit: PresetUnit, helper: string, range: [number, number], step = 1, integer = false): NumberFieldDef => ({ key, kind: "number", label, unit, helper, range, step, ...(integer ? { integer: true } : {}) });
const choice = (key: string, label: string, helper: string, options: { value: string; label: string }[]): ChoiceFieldDef => ({ key, kind: "choice", label, unit: "", helper, options });

export const PAID_FIELDS: PresetFieldDef[] = [
  money("targetCpa", "Target cost per order", "What I aim to pay for one first order. Below it I lean in.", [1, 5000]),
  money("maxCpa", "Max cost per order", "The line. An ad past this for a full window gets paused, not defended.", [1, 10000]),
  num("roasFloor", "ROAS floor", "x", "Return I need on ad spend before I move budget toward a winner.", [1, 10], 0.1),
  money("minSpendBeforeJudging", "Spend before judging", "I don't call an ad good or bad before it has spent this much.", [10, 5000], 5),
  num("fatigueFrequency", "Fatigue frequency", "x", "Average times one person has seen an ad. Past this I call it tired.", [2, 8], 0.5),
  num("fatigueCtrDropPct", "Fatigue CTR drop", "%", "How far click-through can fall from its best week before I rotate the creative.", [5, 60], 5, true),
  num("scaleStepPct", "Scale step", "%", "How much I raise a winner's budget in one move. Never doublings.", [5, 50], 5, true),
  num("holdDays", "Hold between moves", "days", "Days I leave a budget alone after a change so the platform can settle.", [1, 28], 1, true),
  money("dailyBudgetCap", "Daily budget cap", "Hard rail. Nothing I propose takes the day past this.", [1, 100000]),
];

export const EMAIL_FIELDS: PresetFieldDef[] = [
  num("sendCadencePerWeek", "Campaigns per week", "per week", "Sends to the engaged segment. Consistency beats bursts.", [0, 7], 1, true),
  num("welcomeFlowLength", "Welcome flow length", "emails", "Emails in the welcome series. The first one gets the best open rate you will ever see.", [1, 8], 1, true),
  num("winbackWindowDays", "Winback after", "days", "Days since the last order before I call a customer lapsed and draft the winback.", [30, 365], 5, true),
  num("discountCeilingPct", "Discount ceiling", "%", "The most I will ever put in an offer, and only at the last step of a flow. 0 means never.", [0, 50], 5, true),
];

export const CONTENT_FIELDS: PresetFieldDef[] = [
  num("postsPerWeek", "Posts per week", "per week", "A steady three every week beats seven then silence.", [1, 14], 1, true),
  choice("formatsMix", "Formats mix", "Which jobs the posts do. Product posts stay under a fifth.", [
    { value: "education_led", label: "Education-led (education 30 · product 20 · proof 20 · behind the scenes 15 · lifestyle 15)" },
    { value: "proof_led", label: "Proof-led (proof 30 · education 25 · product 20 · behind the scenes 25)" },
    { value: "founder_led", label: "Founder-led (behind the scenes 35 · education 30 · product 15 · proof 20)" },
    { value: "entertainment_led", label: "Entertainment-led (entertainment 40 · education 25 · product 15 · proof 20)" },
  ]),
  choice("hookStyle", "Hook style", "The default opening move. I test three to five hooks against one skeleton.", [
    { value: "proof", label: "Proof first (a number, a result, a review)" },
    { value: "story", label: "Story first (a moment, an object, the founder)" },
    { value: "contrarian", label: "Contrarian (name the enemy or the myth)" },
    { value: "how_to", label: "How-to (the useful thing, up front)" },
    { value: "question", label: "Question (the one customers actually ask)" },
  ]),
];

export const SEO_FIELDS: PresetFieldDef[] = [
  num("targetKeywordsPerMonth", "Target keywords per month", "per month", "Tier-1 buyer terms I put pages against each month. One primary per article.", [1, 30], 1, true),
  num("minSearchVolume", "Minimum search volume", "searches / month", "Below this I don't chase a term unless the intent is clearly buying.", [0, 5000], 10, true),
];

export const SALES_FIELDS: PresetFieldDef[] = [
  num("followUpCadenceDays", "Follow-up cadence", "days", "Days a deal can sit quiet before I draft the nudge.", [1, 30], 1, true),
  num("maxTouches", "Max touches", "touches", "Follow-ups per lead before I stop drafting and call it cold.", [1, 12], 1, true),
  num("leadScoreThreshold", "Lead score threshold", "score", "Score out of 10 a lead needs before I draft outreach for it.", [0, 10], 1, true),
];

export const FIELDS_BY_DOMAIN: Record<PresetDomain, PresetFieldDef[]> = { paid: PAID_FIELDS, email: EMAIL_FIELDS, content: CONTENT_FIELDS, seo: SEO_FIELDS, sales: SALES_FIELDS };

export function fieldDef(domain: PresetDomain, key: string): PresetFieldDef | null {
  return FIELDS_BY_DOMAIN[domain].find((f) => f.key === key) ?? null;
}

/** Money fields carry the account currency; their industry ranges are derived, not tabled. */
export const isMoneyField = (f: PresetFieldDef): f is NumberFieldDef => f.kind === "number" && f.unit === "money";

// ---------- validation ----------

export interface ParamIssue {
  key: string;
  message: string;
}

export interface ValidatedParams {
  ok: boolean;
  params: PresetParams;
  issues: ParamIssue[];
}

/** Coerce + range-check a founder's values for a domain. Unknown keys are refused, numbers must sit
    inside the field's range (integers where the field says so), choices must be listed; null clears
    a field back to the industry value. Nothing is silently clamped. */
export function validateParams(domain: PresetDomain, raw: unknown): ValidatedParams {
  const issues: ParamIssue[] = [];
  const params: PresetParams = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, params, issues: [{ key: "", message: "params must be an object of field → value" }] };
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = fieldDef(domain, key);
    if (!def) {
      issues.push({ key, message: `not a ${domain} field` });
      continue;
    }
    if (v === null) {
      params[key] = null;
      continue;
    }
    if (def.kind === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) {
        issues.push({ key, message: `${def.label} must be a number` });
        continue;
      }
      if (def.integer && !Number.isInteger(n)) {
        issues.push({ key, message: `${def.label} must be a whole number` });
        continue;
      }
      if (n < def.range[0] || n > def.range[1]) {
        issues.push({ key, message: `${def.label} must be between ${def.range[0]} and ${def.range[1]}${def.unit === "money" || def.unit === "" ? "" : ` ${def.unit}`}` });
        continue;
      }
      params[key] = n;
    } else {
      if (typeof v !== "string" || !def.options.some((o) => o.value === v)) {
        issues.push({ key, message: `${def.label} must be one of ${def.options.map((o) => o.value).join(", ")}` });
        continue;
      }
      params[key] = v;
    }
  }
  return { ok: issues.length === 0, params, issues };
}

/** Cross-field sanity the ranges alone can't say. */
export function crossFieldIssues(domain: PresetDomain, params: PresetParams): ParamIssue[] {
  const out: ParamIssue[] = [];
  if (domain === "paid") {
    const t = params.targetCpa;
    const m = params.maxCpa;
    if (typeof t === "number" && typeof m === "number" && t > m) out.push({ key: "targetCpa", message: "Target cost per order can't sit above the max" });
  }
  return out;
}
