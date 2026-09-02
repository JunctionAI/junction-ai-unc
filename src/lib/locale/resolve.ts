/* Locale resolution — pure functions, no Next imports (the request-bound helpers live in
   ./server.ts). Resolution order, first hit wins:

     1. ?country=XX   explicit override (testing / sales links) — the proxy also pins it
                      into the cookie so the rest of the session keeps it
     2. cookie        unc_country=XX (pinned by the proxy from an earlier override)
     3. header        x-vercel-ip-country (set by Vercel at the edge; absent locally)
     4. default       US

   Anything not in the COUNTRIES table (an unknown country, garbage, "XX") is ignored at its
   step and resolution continues — the visitor always gets a real row. */

import { COUNTRIES, DEFAULT, DEFAULT_COUNTRY, isCountryCode, type CountryCode, type CountryPricing } from "./countries";

export const COUNTRY_COOKIE = "unc_country";
export const COUNTRY_HEADER = "x-vercel-ip-country";
export const COUNTRY_QUERY = "country";
/** 30 days — long enough to hold a pin across a beta, short enough to self-heal. */
export const COUNTRY_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export type LocaleSource = "override" | "cookie" | "header" | "default";

export interface LocaleInputs {
  /** `?country=XX` */
  override?: string | null;
  /** value of the unc_country cookie */
  cookie?: string | null;
  /** value of x-vercel-ip-country */
  header?: string | null;
}

export interface ResolvedLocale extends CountryPricing {
  /** Which input won. */
  source: LocaleSource;
  /** The raw header value (upper-cased) even when it wasn't a country we price for — for logging. */
  detected: string | null;
}

/** "nz" → "NZ"; anything that isn't a priced country → null. */
export function normalizeCountry(v: string | null | undefined): CountryCode | null {
  if (!v) return null;
  const up = v.trim().toUpperCase();
  return isCountryCode(up) ? up : null;
}

export function resolveLocale(inputs: LocaleInputs = {}): ResolvedLocale {
  const detected = inputs.header ? inputs.header.trim().toUpperCase() || null : null;
  const steps: [LocaleSource, string | null | undefined][] = [
    ["override", inputs.override],
    ["cookie", inputs.cookie],
    ["header", inputs.header],
  ];
  for (const [source, raw] of steps) {
    const code = normalizeCountry(raw);
    if (code) return { ...COUNTRIES[code], source, detected };
  }
  return { ...DEFAULT, source: "default", detected };
}

/** Parse one cookie out of a raw Cookie header (route handlers get the header, not a store). */
export function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return null;
}

/** Resolve from a Fetch Request (route handlers): query override → cookie → Vercel header → default. */
export function resolveLocaleFromRequest(request: Request | undefined | null): ResolvedLocale {
  if (!request) return resolveLocale();
  let override: string | null = null;
  try {
    override = new URL(request.url).searchParams.get(COUNTRY_QUERY);
  } catch {
    override = null;
  }
  return resolveLocale({
    override,
    cookie: cookieValue(request.headers.get("cookie"), COUNTRY_COOKIE),
    header: request.headers.get(COUNTRY_HEADER),
  });
}

/** Which Stripe price id to charge for a locale: STRIPE_PRICE_ID_<CUR> when set, else the
    base STRIPE_PRICE_ID. Returns null only when neither exists (billing isn't configured). */
export function selectPriceId(row: Pick<CountryPricing, "stripePriceEnv">, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): { priceId: string | null; from: string } {
  const specific = (env[row.stripePriceEnv] || "").trim();
  if (specific) return { priceId: specific, from: row.stripePriceEnv };
  const base = (env.STRIPE_PRICE_ID || "").trim();
  return { priceId: base || null, from: "STRIPE_PRICE_ID" };
}

export { DEFAULT_COUNTRY };
