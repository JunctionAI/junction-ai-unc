/* The intake contract — the JSON body POST /api/intake accepts (docs/N8N-INTAKE.md).

   Every field is optional; unknown fields are dropped with a warning rather than rejected so a
   Typeform/Tally → n8n mapping can grow without breaking the workflow. Strings are trimmed and
   capped; arrays are capped; numbers must be finite. A body that is not a JSON object, or a
   field of the wrong shape, is an error (400) — silent coercion would poison the memory. */

export const MAX_STR = 2000;
export const MAX_LIST = 100;
export const MAX_BODY_BYTES = 256 * 1024;

export interface IntakeBusiness {
  name?: string;
  website?: string;
  socials?: string[];
  category?: string;
  products?: string[];
  voice_notes?: string;
  market?: string;
}
export interface IntakeGoal {
  title?: string;
  baseline?: number;
  deadline?: string; // ISO date (YYYY-MM-DD) or datetime
  currency?: string;
}
export interface IntakeTeamMember {
  name: string;
  role?: string;
}
export interface IntakeResources {
  budget_monthly?: number;
  hours_weekly?: number;
  team?: IntakeTeamMember[];
}
export interface IntakePlatform {
  platform: string;
  external_ref?: string;
}
export interface IntakeContact {
  name: string;
  role?: string;
  email?: string;
}
export interface IntakeEvent {
  text: string;
  at?: string;
}
export interface IntakePayload {
  business?: IntakeBusiness;
  goal?: IntakeGoal;
  resources?: IntakeResources;
  platforms?: IntakePlatform[];
  contacts?: IntakeContact[];
  facts?: string[];
  preferences?: string[];
  constraints?: string[];
  events?: IntakeEvent[];
  notes?: string;
}

export type ParseResult = { ok: true; payload: IntakePayload; warnings: string[] } | { ok: false; error: string };

const TOP_KEYS = ["business", "goal", "resources", "platforms", "contacts", "facts", "preferences", "constraints", "events", "notes"] as const;

class Bad extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function str(v: unknown, path: string, max = MAX_STR): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Bad(`${path} must be a string`);
  const s = v.trim().slice(0, max);
  return s || undefined;
}
function num(v: unknown, path: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Bad(`${path} must be a number`);
  return n;
}
function strList(v: unknown, path: string, warnings: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const arr = typeof v === "string" ? v.split(/\r?\n|;/) : v;
  if (!Array.isArray(arr)) throw new Bad(`${path} must be a list of strings`);
  const out: string[] = [];
  for (const [i, item] of arr.entries()) {
    if (typeof item !== "string") throw new Bad(`${path}[${i}] must be a string`);
    const s = item.trim().slice(0, MAX_STR);
    if (s && !out.includes(s)) out.push(s);
  }
  if (out.length > MAX_LIST) {
    warnings.push(`${path}: kept the first ${MAX_LIST} of ${out.length}`);
    out.length = MAX_LIST;
  }
  return out;
}
function objList<T>(v: unknown, path: string, warnings: string[], one: (o: Record<string, unknown>, p: string) => T | null): T[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Bad(`${path} must be a list`);
  const out: T[] = [];
  for (const [i, item] of v.entries()) {
    const p = `${path}[${i}]`;
    if (typeof item === "string") {
      const t = one({ name: item, text: item, platform: item }, p);
      if (t) out.push(t);
      continue;
    }
    if (!isObj(item)) throw new Bad(`${p} must be an object`);
    const t = one(item, p);
    if (t) out.push(t);
  }
  if (out.length > MAX_LIST) {
    warnings.push(`${path}: kept the first ${MAX_LIST} of ${out.length}`);
    out.length = MAX_LIST;
  }
  return out;
}

/** Accepts YYYY-MM-DD or a full ISO datetime; anything else is an error. Returns the ISO form. */
export function isoDate(v: unknown, path: string): string | undefined {
  const s = str(v, path, 64);
  if (s === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Bad(`${path} is not a valid date`);
    return s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Bad(`${path} must be an ISO date (YYYY-MM-DD) or datetime`);
  return d.toISOString();
}

/** connectors.platform slug: lower-case, spaces/dashes → underscore, known aliases folded. */
export function normalisePlatform(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  const alias: Record<string, string> = {
    google_analytics: "ga4",
    google_analytics_4: "ga4",
    ga: "ga4",
    meta: "meta_ads",
    facebook_ads: "meta_ads",
    facebook: "meta_ads",
    google_ads: "google_ads",
    adwords: "google_ads",
    search_console: "search_console",
    google_search_console: "search_console",
    gsc: "search_console",
    ig: "instagram",
  };
  return alias[s] ?? s;
}

export function parseIntakePayload(raw: unknown): ParseResult {
  const warnings: string[] = [];
  try {
    if (!isObj(raw)) throw new Bad("body must be a JSON object");
    for (const k of Object.keys(raw)) if (!(TOP_KEYS as readonly string[]).includes(k)) warnings.push(`ignored unknown field "${k}"`);
    const p: IntakePayload = {};

    if (raw.business !== undefined) {
      if (!isObj(raw.business)) throw new Bad("business must be an object");
      const b = raw.business;
      p.business = {
        name: str(b.name, "business.name", 200),
        website: str(b.website, "business.website", 500),
        socials: strList(b.socials, "business.socials", warnings),
        category: str(b.category, "business.category", 200),
        products: strList(b.products, "business.products", warnings),
        voice_notes: str(b.voice_notes, "business.voice_notes"),
        market: str(b.market, "business.market", 500),
      };
    }
    if (raw.goal !== undefined) {
      if (!isObj(raw.goal)) throw new Bad("goal must be an object");
      const g = raw.goal;
      const currency = str(g.currency, "goal.currency", 8)?.toUpperCase();
      if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Bad("goal.currency must be a 3-letter code");
      p.goal = { title: str(g.title, "goal.title", 300), baseline: num(g.baseline, "goal.baseline"), deadline: isoDate(g.deadline, "goal.deadline")?.slice(0, 10), currency };
    }
    if (raw.resources !== undefined) {
      if (!isObj(raw.resources)) throw new Bad("resources must be an object");
      const r = raw.resources;
      const budget = num(r.budget_monthly, "resources.budget_monthly");
      const hours = num(r.hours_weekly, "resources.hours_weekly");
      if (budget !== undefined && budget < 0) throw new Bad("resources.budget_monthly must be ≥ 0");
      if (hours !== undefined && (hours < 0 || hours > 168)) throw new Bad("resources.hours_weekly must be 0–168");
      p.resources = {
        budget_monthly: budget,
        hours_weekly: hours,
        team: objList<IntakeTeamMember>(r.team, "resources.team", warnings, (o, path) => {
          const name = str(o.name, `${path}.name`, 120);
          return name ? { name, role: str(o.role, `${path}.role`, 120) } : null;
        }),
      };
    }
    p.platforms = objList<IntakePlatform>(raw.platforms, "platforms", warnings, (o, path) => {
      const platform = str(o.platform, `${path}.platform`, 60);
      if (!platform) return null;
      const slug = normalisePlatform(platform);
      return slug ? { platform: slug, external_ref: str(o.external_ref, `${path}.external_ref`, 300) } : null;
    });
    p.contacts = objList<IntakeContact>(raw.contacts, "contacts", warnings, (o, path) => {
      const name = str(o.name, `${path}.name`, 120);
      if (!name) return null;
      const email = str(o.email, `${path}.email`, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Bad(`${path}.email is not an email address`);
      return { name, role: str(o.role, `${path}.role`, 120), email: email?.toLowerCase() };
    });
    p.facts = strList(raw.facts, "facts", warnings);
    p.preferences = strList(raw.preferences, "preferences", warnings);
    p.constraints = strList(raw.constraints, "constraints", warnings);
    p.events = objList<IntakeEvent>(raw.events, "events", warnings, (o, path) => {
      const text = str(o.text, `${path}.text`);
      if (!text) return null;
      return { text, at: isoDate(o.at, `${path}.at`) };
    });
    p.notes = str(raw.notes, "notes", 8000);

    // drop empty containers (and undefined keys) so "nothing to write" is detectable
    for (const k of TOP_KEYS) {
      const v = p[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.values(v).every((x) => x === undefined))) delete p[k];
    }
    if (Object.keys(p).length === 0) throw new Bad("nothing to take in — every field was empty");
    return { ok: true, payload: p, warnings };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}
