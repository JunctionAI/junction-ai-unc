/* Reader contract shared by the platform readers.

   A reader turns a runtime ReadQuery into rows + pre-aggregated metrics. It
   answers `{ok:false, reason}` when it COULD NOT ASK (no reader for the
   resource, bad credentials, HTTP failure, timeout) so the engine can record
   an incident, as opposed to `{ok:true, count:0}` which means the platform
   answered and nothing happened. Readers never log, never throw for expected
   failures, and never place a credential anywhere but a request header. */

import type { Platform, ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";

export type Row = Record<string, unknown>;
export type Metrics = Record<string, number | string | boolean | null>;

export interface ReaderProvenance {
  platform: Platform;
  fetchedAt: string;
  source: "live" | "fixture";
  /** Free text for the receipt: endpoint shape, dropped fields, caveats. */
  note?: string;
}

export type ReaderResult = { ok: true; rows: Row[]; count: number; metrics: Metrics; provenance: ReaderProvenance } | { ok: false; reason: string };

export interface ReaderOptions {
  /** Defaults to globalThis.fetch, resolved at call time (tests stub it). */
  fetch?: typeof fetch;
  now?: () => Date;
  /** Per-request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Whole-query cancellation shared across pages; does not replace each request timeout. */
  signal?: AbortSignal;
}

export type Reader = (query: ReadQuery, creds: PlatformCredential, opts?: ReaderOptions) => Promise<ReaderResult>;

export const DEFAULT_TIMEOUT_MS = 10_000;

export function ok(platform: Platform, rows: Row[], metrics: Metrics, fetchedAt: string, source: "live" | "fixture", note?: string): ReaderResult {
  return { ok: true, rows, count: rows.length, metrics, provenance: { platform, fetchedAt, source, ...(note ? { note } : {}) } };
}

export function fail(reason: string): ReaderResult {
  return { ok: false, reason };
}
