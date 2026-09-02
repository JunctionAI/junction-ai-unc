import { describe, expect, it } from "vitest";
import { COUNTRIES, DEFAULT, DEFAULT_COUNTRY, isCountryCode, toLocalePricing } from "../countries";
import { COUNTRY_COOKIE, COUNTRY_HEADER, cookieValue, normalizeCountry, resolveLocale, resolveLocaleFromRequest, selectPriceId } from "../resolve";

describe("countries table", () => {
  it("ships US (default), NZ, AU, GB, IN with integer minor-unit prices and a display string", () => {
    expect(Object.keys(COUNTRIES).sort()).toEqual(["AU", "GB", "IN", "NZ", "US"]);
    for (const row of Object.values(COUNTRIES)) {
      expect(Number.isInteger(row.price)).toBe(true);
      expect(row.price).toBeGreaterThan(0);
      expect(row.display.length).toBeGreaterThan(1);
      expect(row.stripePriceEnv).toMatch(/^STRIPE_PRICE_ID_[A-Z]{3}$/);
      expect(row.stripePriceEnv.endsWith(row.currency)).toBe(true);
    }
    expect(DEFAULT_COUNTRY).toBe("US");
    expect(DEFAULT).toBe(COUNTRIES.US);
    expect(COUNTRIES.US).toMatchObject({ currency: "USD", price: 10000, display: "US$100" });
    expect(COUNTRIES.NZ).toMatchObject({ currency: "NZD", price: 14900, display: "NZ$149" });
    expect(COUNTRIES.AU).toMatchObject({ currency: "AUD", price: 14900, display: "A$149" });
    expect(COUNTRIES.GB).toMatchObject({ currency: "GBP", price: 7900, display: "£79" });
    expect(COUNTRIES.IN).toMatchObject({ currency: "INR", price: 490000, display: "₹4,900" });
  });
  it("isCountryCode is a strict table lookup (no prototype keys)", () => {
    expect(isCountryCode("NZ")).toBe(true);
    expect(isCountryCode("nz")).toBe(false);
    expect(isCountryCode("toString")).toBe(false);
    expect(isCountryCode("")).toBe(false);
  });
  it("toLocalePricing drops the env var name (never reaches the client)", () => {
    const slice = toLocalePricing(COUNTRIES.GB);
    expect(slice).toEqual({ country: "GB", currency: "GBP", price: 7900, display: "£79", suffix: "/ month" });
    expect("stripePriceEnv" in slice).toBe(false);
  });
});

describe("normalizeCountry", () => {
  it("upper-cases and trims; unknown → null", () => {
    expect(normalizeCountry("nz")).toBe("NZ");
    expect(normalizeCountry(" au ")).toBe("AU");
    expect(normalizeCountry("XX")).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry("__proto__")).toBeNull();
  });
});

describe("resolveLocale — header / override / cookie / default", () => {
  it("defaults to US with nothing at all", () => {
    expect(resolveLocale()).toMatchObject({ country: "US", source: "default", detected: null });
    expect(resolveLocale({})).toMatchObject({ country: "US", source: "default" });
  });
  it("uses the Vercel header", () => {
    expect(resolveLocale({ header: "NZ" })).toMatchObject({ country: "NZ", currency: "NZD", source: "header", detected: "NZ" });
    expect(resolveLocale({ header: "gb" })).toMatchObject({ country: "GB", source: "header" });
  });
  it("falls through to default when the header is a country we don't price for (but remembers it)", () => {
    expect(resolveLocale({ header: "DE" })).toMatchObject({ country: "US", source: "default", detected: "DE" });
  });
  it("cookie beats header", () => {
    expect(resolveLocale({ header: "NZ", cookie: "AU" })).toMatchObject({ country: "AU", source: "cookie", detected: "NZ" });
  });
  it("override beats cookie and header", () => {
    expect(resolveLocale({ header: "NZ", cookie: "AU", override: "IN" })).toMatchObject({ country: "IN", currency: "INR", source: "override" });
    expect(resolveLocale({ header: "NZ", cookie: "AU", override: "in" })).toMatchObject({ country: "IN", source: "override" });
  });
  it("an invalid override or cookie is skipped, not fatal", () => {
    expect(resolveLocale({ override: "ZZ", cookie: "junk", header: "NZ" })).toMatchObject({ country: "NZ", source: "header" });
    expect(resolveLocale({ override: "", cookie: "", header: "" })).toMatchObject({ country: "US", source: "default", detected: null });
  });
  it("the resolved row carries the full pricing row", () => {
    const r = resolveLocale({ header: "GB" });
    expect(r.display).toBe("£79");
    expect(r.price).toBe(7900);
    expect(r.stripePriceEnv).toBe("STRIPE_PRICE_ID_GBP");
  });
});

describe("cookieValue + resolveLocaleFromRequest", () => {
  it("parses one cookie out of a raw header", () => {
    expect(cookieValue("a=1; unc_country=NZ; b=2", COUNTRY_COOKIE)).toBe("NZ");
    expect(cookieValue("unc_country=AU", COUNTRY_COOKIE)).toBe("AU");
    expect(cookieValue("unc_country=%41U", COUNTRY_COOKIE)).toBe("AU");
    expect(cookieValue("other=NZ", COUNTRY_COOKIE)).toBeNull();
    expect(cookieValue(null, COUNTRY_COOKIE)).toBeNull();
    expect(cookieValue("", COUNTRY_COOKIE)).toBeNull();
  });
  it("route handlers resolve from the Request: query → cookie → header → default", () => {
    const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
    expect(resolveLocaleFromRequest(undefined)).toMatchObject({ country: "US", source: "default" });
    expect(resolveLocaleFromRequest(req("https://x.test/api/billing/checkout"))).toMatchObject({ country: "US", source: "default" });
    expect(resolveLocaleFromRequest(req("https://x.test/api/billing/checkout", { [COUNTRY_HEADER]: "AU" }))).toMatchObject({ country: "AU", source: "header" });
    expect(resolveLocaleFromRequest(req("https://x.test/api/billing/checkout", { [COUNTRY_HEADER]: "AU", cookie: `${COUNTRY_COOKIE}=NZ` }))).toMatchObject({ country: "NZ", source: "cookie" });
    expect(resolveLocaleFromRequest(req("https://x.test/api/billing/checkout?country=gb", { [COUNTRY_HEADER]: "AU", cookie: `${COUNTRY_COOKIE}=NZ` }))).toMatchObject({ country: "GB", source: "override" });
  });
});

describe("selectPriceId — STRIPE_PRICE_ID_<CUR> with fallback to STRIPE_PRICE_ID", () => {
  it("prefers the currency-specific env var", () => {
    expect(selectPriceId(COUNTRIES.NZ, { STRIPE_PRICE_ID: "price_usd", STRIPE_PRICE_ID_NZD: "price_nzd" })).toEqual({ priceId: "price_nzd", from: "STRIPE_PRICE_ID_NZD" });
  });
  it("falls back to STRIPE_PRICE_ID when the currency one is missing or blank", () => {
    expect(selectPriceId(COUNTRIES.NZ, { STRIPE_PRICE_ID: "price_usd" })).toEqual({ priceId: "price_usd", from: "STRIPE_PRICE_ID" });
    expect(selectPriceId(COUNTRIES.IN, { STRIPE_PRICE_ID: "price_usd", STRIPE_PRICE_ID_INR: "   " })).toEqual({ priceId: "price_usd", from: "STRIPE_PRICE_ID" });
  });
  it("US uses STRIPE_PRICE_ID_USD when set, else the base id — and null when nothing is configured", () => {
    expect(selectPriceId(COUNTRIES.US, { STRIPE_PRICE_ID: "price_base", STRIPE_PRICE_ID_USD: "price_usd" }).priceId).toBe("price_usd");
    expect(selectPriceId(COUNTRIES.US, { STRIPE_PRICE_ID: "price_base" }).priceId).toBe("price_base");
    expect(selectPriceId(COUNTRIES.US, {})).toEqual({ priceId: null, from: "STRIPE_PRICE_ID" });
  });
  it("never picks another currency's id by accident", () => {
    expect(selectPriceId(COUNTRIES.GB, { STRIPE_PRICE_ID_NZD: "price_nzd", STRIPE_PRICE_ID: "price_usd" }).priceId).toBe("price_usd");
  });
});
