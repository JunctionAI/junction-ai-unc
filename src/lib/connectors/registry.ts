/* Connector registry — one typed entry per connector card (the 16 in CONNECTOR_DEFS).

   Five launch platforms carry a real OAuth flow (Shopify, Klaviyo, Meta Ads, GA4, Google
   Ads); the rest are catalogued with flow "none" so the UI can say "not switched on yet"
   honestly. Scopes are the phase-1 READ-ONLY sets from the legal/OAuth prep pack
   (clients/junction-ai/product/unc-growth-agent-design-2026-09-01/legal-and-oauth/
   OAUTH-PREP-PACK.md) — least privilege, listed to the founder before they approve.

   `unlocks` is computed from the routine catalog (every routine with a read or execute node
   on the platform), never hand-typed, so the card copy can't drift from the specs.

   Nothing here reads a secret value: env *names* only; isPlatformConfigured() checks presence. */

import { CONNECTOR_DEFS } from "@/lib/platform/catalog";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import { CATALOG_SPECS } from "@/lib/runtime/catalog-specs";
import type { Platform, RoutineId } from "@/lib/runtime/types";

export type ConnectorFlow =
  /** Standard authorization-code OAuth (Meta) — optionally with PKCE (Klaviyo, Google). */
  | "oauth"
  /** Shopify: per-shop authorize URL + HMAC-signed callback, offline token that never expires. */
  | "shopify"
  /** Catalogued, no connect flow yet. */
  | "none";

export type RefreshSemantics =
  /** refresh_token grant against refreshEndpoint (Google, Klaviyo). */
  | "refresh_token"
  /** Token expires and cannot be refreshed server-side — the founder reconnects (Meta long-lived, ~60 days). */
  | "reauth"
  /** Offline token with no expiry (Shopify). */
  | "none";

export type ExternalRefKind = "shop_domain" | "klaviyo_account_id" | "ad_account_id" | "ga4_property_id" | "google_ads_customer_id";

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  /** PKCE S256 challenge, when the entry has pkce. */
  codeChallenge?: string;
  /** Shopify only: validated myshopify.com domain. */
  shop?: string;
}

export interface ConnectorEntry {
  id: Platform;
  /** Card name — the key of PlatformState.connState. */
  name: string;
  category: string;
  /** "orders · products · customers" — the card's reads line. */
  reads: string;
  flow: ConnectorFlow;
  scopes: string[];
  pkce: boolean;
  refresh: RefreshSemantics;
  /** What connectors.external_ref holds once known. */
  externalRef: ExternalRefKind | null;
  /** Env var NAMES for the app credentials (values are read only by isPlatformConfigured / the handlers). */
  env: { clientId: string; clientSecret: string } | null;
  /** Routine ids (catalog-specs) that read or act on this platform. */
  unlocks: RoutineId[];
  authorizeUrl: (p: AuthorizeParams) => string;
  /** Token endpoint; Shopify's is per shop. */
  tokenEndpoint: (shop?: string) => string;
  /** How client credentials travel on the token call. */
  tokenAuth: "body" | "basic";
  refreshEndpoint: string | null;
}

// ---------- unlocks from the catalog ----------

function unlocksFor(platform: Platform): RoutineId[] {
  return CATALOG_SPECS.filter((s) => s.nodes.some((n) => (n.kind === "read" && n.source === platform) || (n.kind === "execute" && n.platform === platform))).map((s) => s.id);
}

// ---------- URL builders ----------

const q = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((kv): kv is [string, string] => typeof kv[1] === "string")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

export const META_GRAPH_VERSION = "v21.0";

const googleAuthorize = (p: AuthorizeParams) =>
  `https://accounts.google.com/o/oauth2/v2/auth?${q({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: p.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallenge ? "S256" : undefined,
  })}`;

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ENV = { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" };

const none = (id: Platform): Omit<ConnectorEntry, "name" | "category" | "reads"> => ({
  id,
  flow: "none",
  scopes: [],
  pkce: false,
  refresh: "none",
  externalRef: null,
  env: null,
  unlocks: unlocksFor(id),
  authorizeUrl: () => {
    throw new Error(`connector ${id} has no connect flow yet`);
  },
  tokenEndpoint: () => {
    throw new Error(`connector ${id} has no connect flow yet`);
  },
  tokenAuth: "body",
  refreshEndpoint: null,
});

const FLOWS: Record<Platform, Omit<ConnectorEntry, "name" | "category" | "reads">> = {
  shopify: {
    id: "shopify",
    flow: "shopify",
    // Launch set = exactly what the warehouse syncs (orders · products · customers). read_all_orders
    // (orders older than 60 days) is a separate Partner Dashboard request — see docs/CONNECTORS-FIRST-BOOT.md.
    scopes: ["read_orders", "read_products", "read_customers"],
    pkce: false,
    refresh: "none",
    externalRef: "shop_domain",
    env: { clientId: "SHOPIFY_CLIENT_ID", clientSecret: "SHOPIFY_CLIENT_SECRET" },
    unlocks: unlocksFor("shopify"),
    authorizeUrl: (p) => `https://${p.shop}/admin/oauth/authorize?${q({ client_id: p.clientId, scope: p.scopes.join(","), redirect_uri: p.redirectUri, state: p.state })}`,
    tokenEndpoint: (shop) => `https://${shop}/admin/oauth/access_token`,
    tokenAuth: "body",
    refreshEndpoint: null,
  },
  klaviyo: {
    id: "klaviyo",
    flow: "oauth",
    // Phase-1 read set from the prep pack minus templates:read (nothing syncs templates).
    scopes: ["accounts:read", "campaigns:read", "flows:read", "lists:read", "segments:read", "metrics:read", "events:read", "profiles:read"],
    pkce: true,
    refresh: "refresh_token",
    externalRef: "klaviyo_account_id",
    env: { clientId: "KLAVIYO_CLIENT_ID", clientSecret: "KLAVIYO_CLIENT_SECRET" },
    unlocks: unlocksFor("klaviyo"),
    authorizeUrl: (p) =>
      `https://www.klaviyo.com/oauth/authorize?${q({
        response_type: "code",
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        scope: p.scopes.join(" "),
        state: p.state,
        code_challenge: p.codeChallenge,
        code_challenge_method: "S256",
      })}`,
    tokenEndpoint: () => "https://a.klaviyo.com/oauth/token",
    tokenAuth: "basic",
    refreshEndpoint: "https://a.klaviyo.com/oauth/token",
  },
  meta_ads: {
    id: "meta_ads",
    flow: "oauth",
    scopes: ["ads_read", "read_insights", "business_management"],
    pkce: false,
    refresh: "reauth",
    externalRef: "ad_account_id",
    env: { clientId: "META_APP_ID", clientSecret: "META_APP_SECRET" },
    unlocks: unlocksFor("meta_ads"),
    authorizeUrl: (p) =>
      `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${q({ client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state, scope: p.scopes.join(","), response_type: "code" })}`,
    tokenEndpoint: () => `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    tokenAuth: "body",
    refreshEndpoint: null,
  },
  ga4: {
    id: "ga4",
    flow: "oauth",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    pkce: true,
    refresh: "refresh_token",
    externalRef: "ga4_property_id",
    env: GOOGLE_ENV,
    unlocks: unlocksFor("ga4"),
    authorizeUrl: googleAuthorize,
    tokenEndpoint: () => GOOGLE_TOKEN,
    tokenAuth: "body",
    refreshEndpoint: GOOGLE_TOKEN,
  },
  google_ads: {
    id: "google_ads",
    // The only Google Ads scope is read-write at the OAuth level; read-only is enforced app-side
    // (no mutate methods are ever called — see the prep pack §2a).
    flow: "oauth",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    pkce: true,
    refresh: "refresh_token",
    externalRef: "google_ads_customer_id",
    env: GOOGLE_ENV,
    unlocks: unlocksFor("google_ads"),
    authorizeUrl: googleAuthorize,
    tokenEndpoint: () => GOOGLE_TOKEN,
    tokenAuth: "body",
    refreshEndpoint: GOOGLE_TOKEN,
  },
  instagram: none("instagram"),
  tiktok: none("tiktok"),
  linkedin: none("linkedin"),
  youtube: none("youtube"),
  search_console: none("search_console"),
  hubspot: none("hubspot"),
  gmail: none("gmail"),
  gorgias: none("gorgias"),
  xero: none("xero"),
  quickbooks: none("quickbooks"),
  slack: none("slack"),
  // research sources — no connector card
  web: none("web"),
  llm_search: none("llm_search"),
  calendar: none("calendar"),
};

/** The 16 cards, in CONNECTOR_DEFS order, joined to their flow. */
export const CONNECTOR_REGISTRY: ConnectorEntry[] = CONNECTOR_DEFS.map((d) => {
  const id = CONNECTOR_PLATFORMS[d.name] as Platform | undefined;
  if (!id || !FLOWS[id]) throw new Error(`connector card "${d.name}" has no platform slug`);
  return { ...FLOWS[id], name: d.name, category: d.cat, reads: d.note };
});

export const CONNECTOR_BY_ID: Record<string, ConnectorEntry> = Object.fromEntries(CONNECTOR_REGISTRY.map((e) => [e.id, e]));

/** Platforms with a real connect flow at launch. */
export const LAUNCH_PLATFORMS: Platform[] = CONNECTOR_REGISTRY.filter((e) => e.flow !== "none").map((e) => e.id);

export function connectorEntry(platform: string): ConnectorEntry | null {
  return CONNECTOR_BY_ID[platform] ?? null;
}

/** App credentials for a platform, or null when either env var is absent. Values never leave the server. */
export function platformCredentials(platform: string, env: Record<string, string | undefined> = process.env): { clientId: string; clientSecret: string } | null {
  const entry = connectorEntry(platform);
  if (!entry || !entry.env) return null;
  const clientId = (env[entry.env.clientId] || "").trim();
  const clientSecret = (env[entry.env.clientSecret] || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** True iff the platform has a connect flow AND its client id + secret are present. */
export function isPlatformConfigured(platform: string, env: Record<string, string | undefined> = process.env): boolean {
  const entry = connectorEntry(platform);
  return !!entry && entry.flow !== "none" && platformCredentials(platform, env) !== null;
}

/** Validate + normalise a Shopify shop domain from user input ("Acme.myshopify.com", with or
    without scheme). null when it isn't a myshopify.com domain — never build a URL from raw input. */
export function normaliseShopDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]?\.myshopify\.com$/.test(s)) return null;
  return s;
}
