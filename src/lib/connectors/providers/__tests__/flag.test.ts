import { describe, expect, it } from "vitest";
import { authProviderFlag, authProviderMode, isPlatformConfigured } from "../../registry";
import { authProviderFor, isPlatformConnectable, makeAuthProvider } from "../index";
import { providerRefOf, providerRefPatch, withoutProviderRef } from "../interface";
import { FAKE_ENV, stubFetch } from "../../__tests__/helpers";

const f = () => stubFetch().fetch;

describe("CONNECTOR_AUTH_PROVIDER flag (registry)", () => {
  it("unset → own for every platform; the deployment is byte-identical", () => {
    for (const p of ["shopify", "klaviyo", "meta_ads", "ga4", "google_ads", "hubspot", "google", "slack"]) expect(authProviderMode(p, {})).toBe("own");
    expect(authProviderFlag("meta_ads", {})).toBeNull();
  });

  it("own app wins whenever our client id + secret are present, whatever the flag says", () => {
    const env = { ...FAKE_ENV, CONNECTOR_AUTH_PROVIDER: "composio", CONNECTOR_AUTH_PROVIDER_META_ADS: "nango" };
    expect(authProviderMode("meta_ads", env)).toBe("own");
    expect(authProviderMode("shopify", env)).toBe("own");
    expect(authProviderFlag("meta_ads", env)).toBe("nango"); // the flag is still readable for diagnostics
  });

  it("without our app: the global flag applies, a per-platform override wins, unknown values read as own", () => {
    const env = { CONNECTOR_AUTH_PROVIDER: "composio", CONNECTOR_AUTH_PROVIDER_HUBSPOT: "nango", CONNECTOR_AUTH_PROVIDER_KLAVIYO: "paragon" };
    expect(authProviderMode("meta_ads", env)).toBe("composio");
    expect(authProviderMode("hubspot", env)).toBe("nango");
    expect(authProviderMode("klaviyo", env)).toBe("composio"); // bad override → falls to the global
    expect(authProviderMode("klaviyo", { CONNECTOR_AUTH_PROVIDER_KLAVIYO: "paragon" })).toBe("own");
    expect(authProviderMode("META_ADS".toLowerCase(), { CONNECTOR_AUTH_PROVIDER: " Composio " })).toBe("composio");
  });

  it("the Google umbrella and catalogued-only platforms never take a provider path", () => {
    const env = { CONNECTOR_AUTH_PROVIDER: "nango", NANGO_SECRET_KEY: "k", NANGO_INTEGRATION_DEFAULTS: "1" };
    expect(authProviderMode("google", env)).toBe("own");
    expect(authProviderMode("slack", env)).toBe("own");
    expect(authProviderMode("instagram", env)).toBe("own");
    expect(authProviderMode("ga4", env)).toBe("nango"); // the children may
  });
});

describe("authProviderFor / isPlatformConnectable (factory)", () => {
  it("flagged but no provider key → provider_not_configured; key but no integration for the platform → no_integration", () => {
    const fetch = f();
    expect(authProviderFor("meta_ads", { env: { CONNECTOR_AUTH_PROVIDER: "composio" }, fetch })).toEqual({ mode: "composio", provider: null, reason: "provider_not_configured" });
    expect(authProviderFor("meta_ads", { env: { CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck" }, fetch })).toEqual({ mode: "composio", provider: null, reason: "no_integration" });
    const ok = authProviderFor("meta_ads", { env: { CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck", COMPOSIO_AUTH_CONFIG_META_ADS: "ac_meta" }, fetch });
    expect(ok.mode).toBe("composio");
    expect(ok.mode !== "own" && ok.provider?.id).toBe("composio");
  });

  it("nango: an explicit NANGO_INTEGRATION_<PLATFORM> supports the platform; the default slugs only with NANGO_INTEGRATION_DEFAULTS=1", () => {
    const fetch = f();
    const base = { CONNECTOR_AUTH_PROVIDER: "nango", NANGO_SECRET_KEY: "nk" };
    expect(authProviderFor("hubspot", { env: base, fetch })).toMatchObject({ mode: "nango", provider: null, reason: "no_integration" });
    expect(authProviderFor("hubspot", { env: { ...base, NANGO_INTEGRATION_HUBSPOT: "hubspot-prod" }, fetch })).toMatchObject({ mode: "nango" });
    expect(authProviderFor("hubspot", { env: { ...base, NANGO_INTEGRATION_DEFAULTS: "1" }, fetch })).toMatchObject({ mode: "nango" });
    expect(authProviderFor("gorgias", { env: { ...base, NANGO_INTEGRATION_DEFAULTS: "1" }, fetch })).toEqual({ mode: "own" });
  });

  it("isPlatformConnectable: own app configured, or a usable provider — never a half-configured one", () => {
    const fetch = f();
    expect(isPlatformConnectable("meta_ads", { env: FAKE_ENV, fetch })).toBe(true);
    expect(isPlatformConfigured("meta_ads", {})).toBe(false);
    expect(isPlatformConnectable("meta_ads", { env: {}, fetch })).toBe(false);
    expect(isPlatformConnectable("meta_ads", { env: { CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck" }, fetch })).toBe(false);
    expect(isPlatformConnectable("meta_ads", { env: { CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck", COMPOSIO_AUTH_CONFIG_META_ADS: "ac_meta" }, fetch })).toBe(true);
  });

  it("makeAuthProvider returns null without the provider's key", () => {
    const fetch = f();
    expect(makeAuthProvider("composio", { env: {}, fetch })).toBeNull();
    expect(makeAuthProvider("nango", { env: {}, fetch })).toBeNull();
    expect(makeAuthProvider("composio", { env: { COMPOSIO_API_KEY: "ck" }, fetch })?.id).toBe("composio");
    expect(makeAuthProvider("nango", { env: { NANGO_SECRET_KEY: "nk" }, fetch })?.id).toBe("nango");
  });
});

describe("provider pointer on connectors.sync_ref", () => {
  it("round-trips through the patch helpers and leaves Airbyte handles alone", () => {
    const ref = { provider: "composio" as const, connectionId: "ca_1", integration: "ac_meta" };
    const syncRef = { airbyte_source_id: "src_1", ...providerRefPatch(ref) };
    expect(providerRefOf({ sync_ref: syncRef })).toEqual(ref);
    expect(withoutProviderRef(syncRef)).toEqual({ airbyte_source_id: "src_1" });
    expect(providerRefOf({ sync_ref: { airbyte_source_id: "src_1" } })).toBeNull();
    expect(providerRefOf({ sync_ref: null })).toBeNull();
    expect(providerRefOf({ sync_ref: { auth_provider: "paragon", provider_connection_id: "x" } })).toBeNull();
    expect(providerRefOf({ sync_ref: { auth_provider: "nango" } })).toEqual({ provider: "nango", connectionId: null, integration: "" });
  });
});
