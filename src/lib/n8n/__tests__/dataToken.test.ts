/* The run-scoped data token: issue / verify / expiry / tamper / scopes / rate limit, and the
   scopes a routine's spec grants. */

import { describe, expect, it } from "vitest";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";
import { bearerToken, dataBaseUrl, DATA_TOKEN_TTL_MS, hasScope, issueDataToken, RateLimiter, scopesAreSubset, scopesForRoutine, scopesForSpec, tokenKey, verifyDataToken } from "../dataToken";

const NOW = new Date("2026-09-03T07:00:00.000Z");
const SECRET = "s3cret";
const input = { accountId: "acct-1", runId: "run-1", routineId: "D01-W01", scopes: ["shopify:products", "gorgias:*"] };

describe("issue / verify", () => {
  it("round-trips the claims, sorts and dedups scopes, expires after 15 minutes", () => {
    const { token, claims } = issueDataToken(SECRET, { ...input, scopes: ["gorgias:*", "shopify:products", "gorgias:*"] }, { now: () => NOW });
    expect(token.startsWith("unc_dt.")).toBe(true);
    expect(claims).toMatchObject({ v: 1, accountId: "acct-1", runId: "run-1", routineId: "D01-W01", scopes: ["gorgias:*", "shopify:products"], iat: NOW.getTime(), exp: NOW.getTime() + DATA_TOKEN_TTL_MS });
    const v = verifyDataToken(SECRET, token, { now: () => new Date(NOW.getTime() + 14 * 60_000) });
    expect(v).toMatchObject({ ok: true, claims: { runId: "run-1", scopes: ["gorgias:*", "shopify:products"] } });
    expect(verifyDataToken(SECRET, token, { now: () => new Date(NOW.getTime() + DATA_TOKEN_TTL_MS + 1) })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a missing secret, a missing / malformed token, a tampered payload and a wrong secret", () => {
    const { token } = issueDataToken(SECRET, input, { now: () => NOW });
    expect(verifyDataToken("", token, { now: () => NOW })).toEqual({ ok: false, reason: "no_secret" });
    expect(verifyDataToken(SECRET, null, { now: () => NOW })).toEqual({ ok: false, reason: "missing" });
    expect(verifyDataToken(SECRET, "nope", { now: () => NOW })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyDataToken(SECRET, token.replace("unc_dt.", "unc_xx."), { now: () => NOW })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyDataToken("other", token, { now: () => NOW })).toEqual({ ok: false, reason: "mismatch" });
    const overlong = issueDataToken(SECRET, input, { now: () => NOW, ttlMs: DATA_TOKEN_TTL_MS * 10 }).token;
    expect(verifyDataToken(SECRET, overlong, { now: () => NOW })).toEqual({ ok: false, reason: "malformed" });
    const future = issueDataToken(SECRET, input, { now: () => new Date(NOW.getTime() + 60_000) }).token;
    expect(verifyDataToken(SECRET, future, { now: () => NOW })).toEqual({ ok: false, reason: "malformed" });
    // tamper: swap the claims for another account's, keep the MAC
    const [p, , mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()), accountId: "acct-2" })).toString("base64url");
    expect(verifyDataToken(SECRET, `${p}.${forged}.${mac}`, { now: () => NOW })).toEqual({ ok: false, reason: "mismatch" });
    expect(() => issueDataToken("", input)).toThrow(/N8N_SIGNING_SECRET/);
  });

  it("bearer parsing, scope matching and base URL", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer   x ")).toBe("x");
    expect(bearerToken("Basic x")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    const c = { scopes: ["shopify:products", "gorgias:*"] };
    expect(hasScope(c, "shopify", "products")).toBe(true);
    expect(hasScope(c, "shopify", "orders")).toBe(false);
    expect(hasScope(c, "gorgias", "tickets")).toBe(true);
    expect(hasScope({ scopes: ["*"] }, "meta_ads", "insights")).toBe(true);
    expect(dataBaseUrl({ APP_URL: "https://unc.getjunction.ai/" })).toBe("https://unc.getjunction.ai");
    expect(dataBaseUrl({ N8N_DATA_BASE_URL: "https://x.test", APP_URL: "https://y.test" })).toBe("https://x.test");
    expect(dataBaseUrl({})).toBeNull();
  });
});

describe("scopes from the spec", () => {
  it("grants only the exact platform:resource pairs declared by read nodes", () => {
    const scopes = scopesForRoutine("D01-W01");
    expect(scopes).toEqual(["gorgias:tickets", "linkedin:posts", "shopify:products"]);
    expect(scopes.every((scope) => !scope.endsWith(":*") && scope !== "*")).toBe(true);
    expect(scopesForSpec(CATALOG_SPEC_BY_ID["D02-W01"])).toEqual(["ga4:report", "meta_ads:adsets", "meta_ads:insights", "shopify:orders"]);
    expect(scopesForRoutine("nope")).toEqual([]);
    expect(scopesAreSubset(["shopify:products"], ["shopify:*"])).toBe(true);
    expect(scopesAreSubset(["shopify:*"], ["shopify:products"])).toBe(false);
    expect(scopesAreSubset(["*"], ["shopify:*"])).toBe(false);
    expect(scopesAreSubset(["shopify:products", "meta_ads:insights"], ["shopify:*"])).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows `limit` calls per window per key, then refuses until the window slides", () => {
    let t = NOW.getTime();
    const rl = new RateLimiter(3, 60_000, () => new Date(t));
    const k = tokenKey("tok");
    expect(k).toHaveLength(32);
    expect(k).not.toContain("tok");
    expect([rl.take(k), rl.take(k), rl.take(k), rl.take(k)]).toEqual([true, true, true, false]);
    expect(rl.take(tokenKey("other"))).toBe(true);
    t += 61_000;
    expect(rl.take(k)).toBe(true);
  });
});
