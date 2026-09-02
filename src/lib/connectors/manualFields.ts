/* "Connect with a token" — the owner's paste path, described as data so the Connectors card
   can render the right form per platform and the API can validate the same fields.

   Client-safe: no node imports, no secrets, no env. The server side is manual.ts. */

export type ManualPlatform = "shopify" | "klaviyo" | "meta_ads" | "ga4" | "google_ads" | "hubspot";

export const MANUAL_PLATFORMS: ManualPlatform[] = ["shopify", "klaviyo", "meta_ads", "ga4", "google_ads", "hubspot"];

export function hasTokenPath(platform: string): platform is ManualPlatform {
  return (MANUAL_PLATFORMS as string[]).includes(platform);
}

export interface ManualField {
  /** Body key: `token` is sealed; `external_ref` and `shop` are stored on the row (non-secret). */
  key: "token" | "external_ref" | "shop";
  label: string;
  placeholder: string;
  /** Rendered masked; never echoed back. */
  secret: boolean;
}

export interface ManualForm {
  fields: ManualField[];
  /** One line on where the founder gets the key — Unc's voice, no hype. */
  where: string;
}

export const MANUAL_FORMS: Record<ManualPlatform, ManualForm> = {
  shopify: {
    fields: [
      { key: "shop", label: "Store", placeholder: "your-store.myshopify.com", secret: false },
      { key: "token", label: "Admin API access token", placeholder: "shpat_…", secret: true },
    ],
    where: "Shopify admin → Settings → Apps and sales channels → Develop apps → your app → API credentials. Read scopes on orders, products and customers are enough.",
  },
  klaviyo: {
    fields: [{ key: "token", label: "Private API key", placeholder: "pk_…", secret: true }],
    where: "Klaviyo → Settings → API keys → Create private key. Read-only access to accounts, campaigns, flows, metrics and profiles is enough.",
  },
  meta_ads: {
    fields: [
      { key: "external_ref", label: "Ad account id", placeholder: "act_1234567890", secret: false },
      { key: "token", label: "System-user or long-lived token", placeholder: "EAA…", secret: true },
    ],
    where: "Business settings → System users → Generate token with ads_read and read_insights, then assign the ad account to that user.",
  },
  ga4: {
    fields: [
      { key: "external_ref", label: "GA4 property id", placeholder: "123456789", secret: false },
      { key: "token", label: "OAuth refresh token", placeholder: "1//…", secret: true },
    ],
    where: "A refresh token minted for Junction's Google app with the analytics.readonly scope (OAuth Playground with the app's client id works). The property id is under Admin → Property details.",
  },
  google_ads: {
    fields: [
      { key: "external_ref", label: "Customer id", placeholder: "123-456-7890", secret: false },
      { key: "token", label: "OAuth refresh token", placeholder: "1//…", secret: true },
    ],
    where: "A refresh token minted for Junction's Google app with the adwords scope; the customer id is at the top right of Google Ads.",
  },
  hubspot: {
    fields: [{ key: "token", label: "Private app access token", placeholder: "pat-…", secret: true }],
    where: "HubSpot → Settings → Integrations → Private apps → Create. Read scopes on contacts, deals and owners are enough.",
  },
};

/** Copy in Unc's voice for the token path (accounts mode, owner only). */
export const MANUAL_COPY = {
  link: "Connect with a token",
  helper: "Paste the key and I'll test it before I keep it.",
  cta: "Test & connect",
  testing: "Testing it against their API now…",
  connected: "It works — connected. Reading your last 90 days now.",
  reading: "Reading…",
  readingLong: "Reading your last 90 days…",
  readOk: (n: number) => (n === 1 ? "Read ✓ · 1 metric" : `Read ✓ · ${n} metrics`),
  readEmpty: "Read ✓ · nothing in the window yet",
  readFailed: (reason: string) => `Couldn't read: ${reason}`,
  sealedNoReader: "Connected · key sealed — reads for this one come in wave 2",
  reconnect: "Reconnect",
  cancel: "Cancel",
  ownerOnly: "Only the account owner can paste a key.",
  notStored: "Nothing was stored.",
} as const;
