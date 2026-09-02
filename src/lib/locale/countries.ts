/* Per-country pricing table — client-safe constants (no env, no SDK).

   One row per country Unc sells into, keyed by ISO 3166-1 alpha-2. The resolver
   (./resolve.ts) picks a row from the visitor's country; the landing pricing card, the
   paywall and Stripe Checkout all read from that row, so a price change is a one-line edit.

   Prices are provisional — see docs/PRICING-BY-COUNTRY.md (research in progress). Every
   `price` is in integer minor units (cents / pence / paise) — never a float. `stripePriceEnv`
   names the env var that holds that currency's Stripe recurring price id; when it is unset,
   Checkout falls back to STRIPE_PRICE_ID (the USD price) — see selectPriceId() in ./resolve.ts. */

export type CountryCode = "US" | "NZ" | "AU" | "GB" | "IN";
export type Currency = "USD" | "NZD" | "AUD" | "GBP" | "INR";

export interface CountryPricing {
  country: CountryCode;
  currency: Currency;
  /** Integer minor units (e.g. 10000 = US$100.00). */
  price: number;
  /** What the founder sees on the card: "US$100", "₹4,900". */
  display: string;
  /** The small line after the price on the card. */
  suffix: string;
  /** Env var holding this currency's Stripe price id (falls back to STRIPE_PRICE_ID). */
  stripePriceEnv: string;
  /** Optional locale copy overrides. Omitted keys fall back to the verbatim landing copy. */
  copy?: {
    heroSubline?: string;
    waitlistHelper?: string;
    pricingLabel?: string;
  };
}

/** Locale surface that is safe to pass into client components (a plain, serialisable slice). */
export type LocalePricing = Pick<CountryPricing, "country" | "currency" | "price" | "display" | "suffix" | "copy">;

export const COUNTRIES: Record<CountryCode, CountryPricing> = {
  US: {
    country: "US",
    currency: "USD",
    price: 10000, // provisional — see docs/PRICING-BY-COUNTRY.md
    display: "US$100",
    suffix: "/ month",
    stripePriceEnv: "STRIPE_PRICE_ID_USD",
  },
  NZ: {
    country: "NZ",
    currency: "NZD",
    price: 14900, // provisional — see docs/PRICING-BY-COUNTRY.md
    display: "NZ$149",
    suffix: "/ month",
    stripePriceEnv: "STRIPE_PRICE_ID_NZD",
  },
  AU: {
    country: "AU",
    currency: "AUD",
    price: 14900, // provisional — see docs/PRICING-BY-COUNTRY.md
    display: "A$149",
    suffix: "/ month",
    stripePriceEnv: "STRIPE_PRICE_ID_AUD",
  },
  GB: {
    country: "GB",
    currency: "GBP",
    price: 7900, // provisional — see docs/PRICING-BY-COUNTRY.md
    display: "£79",
    suffix: "/ month",
    stripePriceEnv: "STRIPE_PRICE_ID_GBP",
  },
  IN: {
    country: "IN",
    currency: "INR",
    price: 490000, // provisional — see docs/PRICING-BY-COUNTRY.md
    display: "₹4,900",
    suffix: "/ month",
    stripePriceEnv: "STRIPE_PRICE_ID_INR",
  },
};

export const DEFAULT_COUNTRY: CountryCode = "US";
export const DEFAULT = COUNTRIES[DEFAULT_COUNTRY];

export const isCountryCode = (v: string): v is CountryCode => Object.prototype.hasOwnProperty.call(COUNTRIES, v);

/** The client-safe slice of a row (drops the env var name — the client never needs it). */
export function toLocalePricing(row: CountryPricing): LocalePricing {
  const { country, currency, price, display, suffix, copy } = row;
  return copy ? { country, currency, price, display, suffix, copy } : { country, currency, price, display, suffix };
}
