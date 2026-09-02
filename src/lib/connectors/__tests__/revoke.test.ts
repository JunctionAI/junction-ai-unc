/* Platform-side revoke request shaping per platform, against a stubbed fetch. Tokens ride
   only where the platform demands them (header, form body, or — HubSpot — the path, which
   the result label redacts); results are codes + host/path, never bodies. */

import { describe, expect, it } from "vitest";
import type { TokenBundle } from "../oauth";
import { CONNECTOR_BY_ID } from "../registry";
import { revokeToken, SHOPIFY_REVOKE_API_VERSION } from "../revoke";
import { assertNoLeak, stubFetch } from "./helpers";

const bundle = (over: Partial<TokenBundle> = {}): TokenBundle => ({ accessToken: "ACCESS-FIXTURE", refreshToken: "REFRESH-FIXTURE", obtainedAt: "2026-09-02T09:00:00.000Z", ...over });
const okRoute = (status = 200) => () => new Response(status === 204 ? null : "", { status });

describe("revokeToken", () => {
  it("Shopify: DELETE api_permissions/current.json on the shop with the access token in the header; needs the shop", async () => {
    const f = stubFetch([okRoute()]);
    const r = await revokeToken(f.fetch, CONNECTOR_BY_ID.shopify, { bundle: bundle({ refreshToken: undefined }), externalRef: "acme.myshopify.com" });
    expect(r).toEqual({ ok: true, endpoint: `acme.myshopify.com/admin/api/${SHOPIFY_REVOKE_API_VERSION}/api_permissions/current.json` });
    expect(f.calls[0]).toMatchObject({ method: "DELETE", url: `https://acme.myshopify.com/admin/api/${SHOPIFY_REVOKE_API_VERSION}/api_permissions/current.json` });
    expect(f.calls[0].headers["x-shopify-access-token"]).toBe("ACCESS-FIXTURE");
    expect(await revokeToken(f.fetch, CONNECTOR_BY_ID.shopify, { bundle: bundle(), externalRef: null })).toEqual({ ok: false, code: "no_shop", endpoint: null });
  });

  it("Klaviyo: POST oauth/revoke with Basic client auth and the refresh token (hint) in the form body", async () => {
    const f = stubFetch([okRoute()]);
    const r = await revokeToken(f.fetch, CONNECTOR_BY_ID.klaviyo, { bundle: bundle(), externalRef: "acct", clientId: "cid", clientSecret: "csecret" });
    expect(r).toEqual({ ok: true, endpoint: "a.klaviyo.com/oauth/revoke" });
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const form = new URLSearchParams(f.calls[0].body!);
    expect(form.get("token")).toBe("REFRESH-FIXTURE");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    // without a refresh token the access token goes, with its own hint
    await revokeToken(f.fetch, CONNECTOR_BY_ID.klaviyo, { bundle: bundle({ refreshToken: undefined }), externalRef: null, clientId: "cid", clientSecret: "csecret" });
    expect(new URLSearchParams(f.calls[1].body!).get("token_type_hint")).toBe("access_token");
    expect(await revokeToken(f.fetch, CONNECTOR_BY_ID.klaviyo, { bundle: bundle(), externalRef: null })).toEqual({ ok: false, code: "not_configured", endpoint: null });
  });

  it("Meta: DELETE /me/permissions with a bearer", async () => {
    const f = stubFetch([okRoute()]);
    expect(await revokeToken(f.fetch, CONNECTOR_BY_ID.meta_ads, { bundle: bundle({ refreshToken: undefined }), externalRef: "act_1" })).toEqual({ ok: true, endpoint: "graph.facebook.com/v23.0/me/permissions" });
    expect(f.calls[0]).toMatchObject({ method: "DELETE" });
    expect(f.calls[0].headers.authorization).toBe("Bearer ACCESS-FIXTURE");
    expect(f.calls[0].url).not.toContain("ACCESS-FIXTURE");
  });

  it("Google (GA4 + Ads): POST oauth2/revoke with the refresh token in the form body; an already-revoked grant (400) counts as done", async () => {
    const f = stubFetch([okRoute()]);
    expect(await revokeToken(f.fetch, CONNECTOR_BY_ID.ga4, { bundle: bundle(), externalRef: "123" })).toEqual({ ok: true, endpoint: "oauth2.googleapis.com/revoke" });
    expect(f.calls[0]).toMatchObject({ method: "POST", url: "https://oauth2.googleapis.com/revoke" });
    expect(f.calls[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(f.calls[0].body!).get("token")).toBe("REFRESH-FIXTURE");
    const g = stubFetch([okRoute(400)]);
    expect(await revokeToken(g.fetch, CONNECTOR_BY_ID.google_ads, { bundle: bundle(), externalRef: "1234567890" })).toEqual({ ok: true, endpoint: "oauth2.googleapis.com/revoke" });
  });

  it("HubSpot: DELETE oauth/v1/refresh-tokens/<refresh> — the label redacts the path segment", async () => {
    const f = stubFetch([okRoute(204)]);
    const r = await revokeToken(f.fetch, CONNECTOR_BY_ID.hubspot, { bundle: bundle(), externalRef: "777" });
    expect(r).toEqual({ ok: true, endpoint: "api.hubapi.com/oauth/v1/refresh-tokens/<redacted>" });
    expect(f.calls[0]).toMatchObject({ method: "DELETE", url: "https://api.hubapi.com/oauth/v1/refresh-tokens/REFRESH-FIXTURE" });
    expect(await revokeToken(f.fetch, CONNECTOR_BY_ID.hubspot, { bundle: bundle({ refreshToken: undefined }), externalRef: null })).toEqual({ ok: false, code: "no_token", endpoint: null });
  });

  it("no endpoint for catalogued-only platforms; HTTP / network / timeout are codes; 404 = already gone", async () => {
    expect(await revokeToken(stubFetch().fetch, CONNECTOR_BY_ID.slack, { bundle: bundle(), externalRef: null })).toEqual({ ok: false, code: "no_revoke_endpoint", endpoint: null });
    expect(await revokeToken(stubFetch([okRoute(401)]).fetch, CONNECTOR_BY_ID.meta_ads, { bundle: bundle(), externalRef: null })).toEqual({ ok: false, code: "http_401", endpoint: "graph.facebook.com/v23.0/me/permissions" });
    expect(await revokeToken(stubFetch([okRoute(404)]).fetch, CONNECTOR_BY_ID.meta_ads, { bundle: bundle(), externalRef: null })).toMatchObject({ ok: true });
    const boom = stubFetch([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    expect(await revokeToken(boom.fetch, CONNECTOR_BY_ID.ga4, { bundle: bundle(), externalRef: null })).toMatchObject({ ok: false, code: "network" });
    const slow: Parameters<typeof revokeToken>[0] = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    expect(await revokeToken(slow, CONNECTOR_BY_ID.ga4, { bundle: bundle(), externalRef: null, timeoutMs: 5 })).toMatchObject({ ok: false, code: "timeout" });
    // nothing token-shaped in any result
    const results = [await revokeToken(stubFetch([okRoute(500)]).fetch, CONNECTOR_BY_ID.hubspot, { bundle: bundle(), externalRef: null })];
    assertNoLeak(
      results.map((r) => JSON.stringify(r)),
      ["ACCESS-FIXTURE", "REFRESH-FIXTURE"],
    );
  });
});
