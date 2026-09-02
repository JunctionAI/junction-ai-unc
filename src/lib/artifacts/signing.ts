/* HMAC signing for the n8n bridge — both directions use the same shape.

     sign(secret, body, timestamp)            → "sha256=<hex>" over `${timestamp}.${body}`
     verify(secret, body, timestamp, header)  timing-safe; rejects a timestamp older than
                                              SIGNATURE_MAX_AGE_MS (replay window)

   Headers: x-unc-signature, x-unc-timestamp (ms since epoch, as a string). The engine POSTs
   to n8n with them; n8n (or anything else) POSTs back to /api/routines/artifacts with them.
   Node's crypto only — no dependency. */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-unc-signature";
export const TIMESTAMP_HEADER = "x-unc-timestamp";
export const SIGNATURE_MAX_AGE_MS = 5 * 60_000;

export function sign(secret: string, body: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" | "no_secret" };

export function verify(secret: string | undefined | null, body: string, timestamp: string | null | undefined, header: string | null | undefined, opts: { now?: () => Date; maxAgeMs?: number } = {}): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!timestamp || !header) return { ok: false, reason: "missing" };
  const ts = Number(timestamp);
  const now = (opts.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.maxAgeMs ?? SIGNATURE_MAX_AGE_MS)) return { ok: false, reason: "stale" };
  const expected = Buffer.from(sign(secret, body, timestamp));
  const given = Buffer.from(header.trim());
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
