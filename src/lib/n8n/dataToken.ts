/* Run-scoped data token — how an n8n workflow reads the founder's data WITHOUT ever holding a
   credential (docs/N8N-ROUTINES.md "Seamless auth").

   The founder authenticates once, in Junction (the connectors). When the engine hands a
   produce step to a workflow it mints a token bound to THAT run:

     unc_dt.<base64url claims>.<base64url HMAC-SHA256(N8N_SIGNING_SECRET, claims)>
     claims = { v: 1, accountId, runId, routineId, scopes: ["shopify:orders", "klaviyo:*", …],
                iat, exp }            exp = iat + 15 min

   The workflow sends it as `Authorization: Bearer <token>` to /api/n8n/reads, /context and
   /actions; those routes resolve the sealed credential server-side and run the SAME reader
   the worker uses. Replay safety: a token names one run, and the proxy only answers while
   that run is still open (or for a test run — runId "test:…" — until the token expires).
   Scopes come from the routine's spec (its read nodes + the skill minimum's platforms), so a
   founder-content workflow cannot read Meta insights.

   Node's crypto only; relative imports only (the worker's standalone build carries this). */

import { createHmac, timingSafeEqual } from "node:crypto";
import { CATALOG_SPEC_BY_ID } from "../runtime/catalog-specs";
import type { Platform, RoutineSpec } from "../runtime/types";

export const DATA_TOKEN_PREFIX = "unc_dt";
export const DATA_TOKEN_TTL_MS = 15 * 60_000;
export const TEST_RUN_PREFIX = "test:";

export interface DataTokenClaims {
  v: 1;
  accountId: string;
  runId: string;
  routineId: string;
  /** "platform:resource" or "platform:*" or "*". */
  scopes: string[];
  /** ms since epoch. */
  iat: number;
  exp: number;
}

export interface IssueInput {
  accountId: string;
  runId: string;
  routineId: string;
  scopes: string[];
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (secret: string, claimsB64: string) => createHmac("sha256", secret).update(claimsB64).digest("base64url");

export function issueDataToken(secret: string, input: IssueInput, opts: { now?: () => Date; ttlMs?: number } = {}): { token: string; claims: DataTokenClaims } {
  if (!secret) throw new Error("N8N_SIGNING_SECRET is not set — refusing to mint an unsigned data token");
  const iat = (opts.now ?? (() => new Date()))().getTime();
  const claims: DataTokenClaims = { v: 1, accountId: input.accountId, runId: input.runId, routineId: input.routineId, scopes: [...new Set(input.scopes)].sort(), iat, exp: iat + (opts.ttlMs ?? DATA_TOKEN_TTL_MS) };
  const claimsB64 = b64url(JSON.stringify(claims));
  return { token: `${DATA_TOKEN_PREFIX}.${claimsB64}.${mac(secret, claimsB64)}`, claims };
}

export type VerifyDataTokenResult = { ok: true; claims: DataTokenClaims } | { ok: false; reason: "no_secret" | "missing" | "malformed" | "mismatch" | "expired" };

export function verifyDataToken(secret: string | null | undefined, token: string | null | undefined, opts: { now?: () => Date } = {}): VerifyDataTokenResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const t = (token ?? "").trim();
  if (!t) return { ok: false, reason: "missing" };
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== DATA_TOKEN_PREFIX || !parts[1] || !parts[2]) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(mac(secret, parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "mismatch" };
  let claims: DataTokenClaims;
  try {
    claims = JSON.parse(fromB64url(parts[1])) as DataTokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || claims.v !== 1 || typeof claims.accountId !== "string" || typeof claims.runId !== "string" || typeof claims.routineId !== "string" || !Array.isArray(claims.scopes) || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  const now = (opts.now ?? (() => new Date()))().getTime();
  if (now > claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/** Bearer header → token string (null when absent or not a Bearer). */
export function bearerToken(header: string | null | undefined): string | null {
  const m = (header ?? "").match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

export function hasScope(claims: Pick<DataTokenClaims, "scopes">, platform: string, resource: string): boolean {
  return claims.scopes.some((s) => s === "*" || s === `${platform}:*` || s === `${platform}:${resource}`);
}

export const isTestRun = (runId: string) => runId.startsWith(TEST_RUN_PREFIX);

/** The scopes a routine's workflow may use: every read node's platform:resource, plus
    platform:* for the skill minimum's required + helpful platforms. */
export function scopesForSpec(spec: RoutineSpec): string[] {
  const out = new Set<string>();
  for (const n of spec.nodes) if (n.kind === "read") out.add(`${n.source}:${n.query.resource}`);
  for (const p of [...(spec.minimum?.platforms ?? []), ...(spec.minimum?.helpful ?? [])] as Platform[]) out.add(`${p}:*`);
  return [...out].sort();
}

export function scopesForRoutine(routineId: string): string[] {
  const spec = CATALOG_SPEC_BY_ID[routineId];
  return spec ? scopesForSpec(spec) : [];
}

/** Where a workflow calls back for data: N8N_DATA_BASE_URL, else the app URL. null = not
    configured (the workflow must know the URL itself). */
export function dataBaseUrl(env: Record<string, string | undefined>): string | null {
  const raw = (env.N8N_DATA_BASE_URL ?? env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "").trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export const DATA_ENDPOINTS = { reads: "/api/n8n/reads", context: "/api/n8n/context", actions: "/api/n8n/actions" } as const;

// ---------- per-token rate limit (in-process; the proxy runs on one region) ----------

export const RATE_LIMIT_PER_MINUTE = 60;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit = RATE_LIMIT_PER_MINUTE,
    private readonly windowMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** true = allowed (and counted); false = over the limit for this key in the window. */
  take(key: string): boolean {
    const t = this.now().getTime();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

/** A stable, non-reversible key for the limiter (the token itself never sits in a map). */
export function tokenKey(token: string): string {
  return createHmac("sha256", "unc-rate-limit").update(token).digest("hex").slice(0, 32);
}
