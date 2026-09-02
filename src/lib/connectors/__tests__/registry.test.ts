import { describe, expect, it } from "vitest";
import { CONNECTOR_DEFS } from "@/lib/platform/catalog";
import { CATALOG_SPECS } from "@/lib/runtime/catalog-specs";
import { CONNECTOR_BY_ID, CONNECTOR_REGISTRY, connectorEntry, isPlatformConfigured, LAUNCH_PLATFORMS, normaliseShopDomain, platformCredentials } from "../registry";
import { readConnectReturn } from "../returnParams";
import { FAKE_ENV } from "./helpers";

const LAUNCH = ["shopify", "klaviyo", "meta_ads", "ga4", "google_ads", "hubspot"] as const;

describe("connector registry", () => {
  it("has one entry per connector card, in card order, carrying the card's reads line", () => {
    expect(CONNECTOR_REGISTRY.map((e) => e.name)).toEqual(CONNECTOR_DEFS.map((d) => d.name));
    for (const e of CONNECTOR_REGISTRY) {
      const card = CONNECTOR_DEFS.find((d) => d.name === e.name)!;
      expect(e.reads).toBe(card.note);
      expect(e.category).toBe(card.cat);
    }
    expect(new Set(CONNECTOR_REGISTRY.map((e) => e.id)).size).toBe(CONNECTOR_REGISTRY.length);
  });

  it("the five launch platforms + HubSpot have read-only scopes, env var names and a flow", () => {
    expect(LAUNCH_PLATFORMS.sort()).toEqual([...LAUNCH].sort());
    for (const id of LAUNCH) {
      const e = CONNECTOR_BY_ID[id];
      expect(e.scopes.length, id).toBeGreaterThan(0);
      expect(e.env, id).toBeTruthy();
      expect(e.flow, id).not.toBe("none");
    }
    // least privilege: nothing that writes
    expect(CONNECTOR_BY_ID.shopify.scopes).toEqual(["read_orders", "read_products", "read_customers"]);
    expect(CONNECTOR_BY_ID.shopify.scopes.every((s) => s.startsWith("read_"))).toBe(true);
    expect(CONNECTOR_BY_ID.klaviyo.scopes.every((s) => s.endsWith(":read"))).toBe(true);
    expect(CONNECTOR_BY_ID.meta_ads.scopes).toEqual(["ads_read", "read_insights", "business_management"]);
    expect(CONNECTOR_BY_ID.ga4.scopes).toEqual(["https://www.googleapis.com/auth/analytics.readonly"]);
    expect(CONNECTOR_BY_ID.google_ads.scopes).toEqual(["https://www.googleapis.com/auth/adwords"]);
    expect(CONNECTOR_BY_ID.hubspot.scopes).toEqual(["crm.objects.deals.read", "crm.objects.contacts.read", "crm.objects.owners.read"]);
    expect(CONNECTOR_BY_ID.hubspot.scopes.every((s) => s.endsWith(".read"))).toBe(true);
    // env names, not values
    expect(CONNECTOR_BY_ID.shopify.env).toEqual({ clientId: "SHOPIFY_CLIENT_ID", clientSecret: "SHOPIFY_CLIENT_SECRET" });
    expect(CONNECTOR_BY_ID.klaviyo.env).toEqual({ clientId: "KLAVIYO_CLIENT_ID", clientSecret: "KLAVIYO_CLIENT_SECRET" });
    expect(CONNECTOR_BY_ID.meta_ads.env).toEqual({ clientId: "META_APP_ID", clientSecret: "META_APP_SECRET" });
    expect(CONNECTOR_BY_ID.ga4.env).toEqual({ clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" });
    expect(CONNECTOR_BY_ID.google_ads.env).toEqual(CONNECTOR_BY_ID.ga4.env);
    expect(CONNECTOR_BY_ID.hubspot.env).toEqual({ clientId: "HUBSPOT_CLIENT_ID", clientSecret: "HUBSPOT_CLIENT_SECRET" });
    expect(CONNECTOR_BY_ID.hubspot).toMatchObject({ pkce: false, refresh: "refresh_token", externalRef: "hubspot_portal_id", tokenAuth: "body", refreshEndpoint: "https://api.hubapi.com/oauth/v1/token" });
    // PKCE + refresh semantics
    expect(CONNECTOR_BY_ID.klaviyo.pkce).toBe(true);
    expect(CONNECTOR_BY_ID.ga4.pkce).toBe(true);
    expect(CONNECTOR_BY_ID.google_ads.pkce).toBe(true);
    expect(CONNECTOR_BY_ID.shopify.refresh).toBe("none");
    expect(CONNECTOR_BY_ID.meta_ads.refresh).toBe("reauth");
    expect(CONNECTOR_BY_ID.ga4.refresh).toBe("refresh_token");
  });

  it("computes `unlocks` from the routine catalog — non-empty for every launch platform, never hand-typed", () => {
    for (const id of LAUNCH) {
      const e = CONNECTOR_BY_ID[id];
      expect(e.unlocks.length, id).toBeGreaterThan(0);
      const expected = CATALOG_SPECS.filter((s) => s.nodes.some((n) => (n.kind === "read" && n.source === id) || (n.kind === "execute" && n.platform === id))).map((s) => s.id);
      expect(e.unlocks).toEqual(expected);
    }
  });

  it("builds authorize URLs with the exact scopes, state and redirect for each flow", () => {
    const p = { clientId: "cid", redirectUri: "https://unc.test/api/connectors/x/callback", state: "st4te", codeChallenge: "ch4llenge" };
    const shopify = new URL(CONNECTOR_BY_ID.shopify.authorizeUrl({ ...p, scopes: CONNECTOR_BY_ID.shopify.scopes, shop: "acme.myshopify.com" }));
    expect(shopify.origin + shopify.pathname).toBe("https://acme.myshopify.com/admin/oauth/authorize");
    expect(shopify.searchParams.get("scope")).toBe("read_orders,read_products,read_customers");
    expect(shopify.searchParams.get("state")).toBe("st4te");
    expect(shopify.searchParams.has("code_challenge")).toBe(false);

    const klaviyo = new URL(CONNECTOR_BY_ID.klaviyo.authorizeUrl({ ...p, scopes: CONNECTOR_BY_ID.klaviyo.scopes }));
    expect(klaviyo.origin + klaviyo.pathname).toBe("https://www.klaviyo.com/oauth/authorize");
    expect(klaviyo.searchParams.get("code_challenge_method")).toBe("S256");
    expect(klaviyo.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(klaviyo.searchParams.get("scope")).toBe(CONNECTOR_BY_ID.klaviyo.scopes.join(" "));

    const meta = new URL(CONNECTOR_BY_ID.meta_ads.authorizeUrl({ ...p, scopes: CONNECTOR_BY_ID.meta_ads.scopes }));
    expect(meta.hostname).toBe("www.facebook.com");
    expect(meta.searchParams.get("scope")).toBe("ads_read,read_insights,business_management");

    const ga4 = new URL(CONNECTOR_BY_ID.ga4.authorizeUrl({ ...p, scopes: CONNECTOR_BY_ID.ga4.scopes }));
    expect(ga4.origin + ga4.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(ga4.searchParams.get("access_type")).toBe("offline");
    expect(ga4.searchParams.get("prompt")).toBe("consent");
    expect(ga4.searchParams.get("code_challenge")).toBe("ch4llenge");

    const hubspot = new URL(CONNECTOR_BY_ID.hubspot.authorizeUrl({ ...p, scopes: CONNECTOR_BY_ID.hubspot.scopes }));
    expect(hubspot.origin + hubspot.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(hubspot.searchParams.get("scope")).toBe("crm.objects.deals.read crm.objects.contacts.read crm.objects.owners.read");
    expect(hubspot.searchParams.get("state")).toBe("st4te");
    expect(hubspot.searchParams.has("code_challenge")).toBe(false);
  });

  it("isPlatformConfigured keys off the env var pair; catalogued-only platforms are never configured", () => {
    expect(isPlatformConfigured("shopify", {})).toBe(false);
    expect(isPlatformConfigured("shopify", { SHOPIFY_CLIENT_ID: "x" })).toBe(false);
    expect(isPlatformConfigured("shopify", FAKE_ENV)).toBe(true);
    expect(platformCredentials("meta_ads", FAKE_ENV)).toEqual({ clientId: "meta-app-id", clientSecret: "meta-app-secret" });
    expect(isPlatformConfigured("slack", { SLACK_CLIENT_ID: "x", SLACK_CLIENT_SECRET: "y" })).toBe(false);
    expect(isPlatformConfigured("nope", FAKE_ENV)).toBe(false);
    expect(connectorEntry("nope")).toBeNull();
    expect(connectorEntry("instagram")!.flow).toBe("none");
  });

  it("only accepts a myshopify.com domain for the Shopify shop", () => {
    expect(normaliseShopDomain("Acme.myshopify.com")).toBe("acme.myshopify.com");
    expect(normaliseShopDomain("https://acme.myshopify.com/admin")).toBe("acme.myshopify.com");
    expect(normaliseShopDomain("acme")).toBeNull();
    expect(normaliseShopDomain("evil.com/acme.myshopify.com")).toBeNull();
    expect(normaliseShopDomain("acme.myshopify.com.evil.com")).toBeNull();
    expect(normaliseShopDomain("")).toBeNull();
    expect(normaliseShopDomain(42)).toBeNull();
  });
});

describe("return params", () => {
  it("maps ?connected / ?connect_error to the card name", () => {
    expect(readConnectReturn("?connected=shopify")).toEqual({ kind: "connected", platform: "shopify", name: "Shopify" });
    expect(readConnectReturn("?connect_error=meta_ads")).toEqual({ kind: "error", platform: "meta_ads", name: "Meta Ads" });
    expect(readConnectReturn("?connected=nope")).toBeNull();
    expect(readConnectReturn("")).toBeNull();
  });
});
