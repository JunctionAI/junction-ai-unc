/* Shared HTTP + window helpers for the readers. Credentials go in headers
   only; failure reasons carry status codes and host/path, never query strings
   or header values. */

import type { ReaderOptions } from "./types";
import { DEFAULT_TIMEOUT_MS } from "./types";

export type JsonResult = { ok: true; json: unknown; status: number } | { ok: false; reason: string; status?: number };

/** GET/POST JSON with a hard timeout. Never throws for expected failures. */
export async function fetchJson(url: string, init: RequestInit, opts: ReaderOptions = {}): Promise<JsonResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") return { ok: false, reason: "fetch is not available in this runtime" };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const where = safeUrl(url);
  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} from ${where}`, status: res.status };
    try {
      return { ok: true, json: await res.json(), status: res.status };
    } catch {
      return { ok: false, reason: `non-JSON body from ${where}`, status: res.status };
    }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, reason: `timeout after ${timeoutMs}ms calling ${where}` };
    return { ok: false, reason: `network error calling ${where}: ${err instanceof Error ? err.name : "unknown"}` };
  } finally {
    clearTimeout(timer);
  }
}

/** host + path only — no query string, so nothing sensitive leaks into a reason. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

/** Parse a lookback window ("24h", "7d", "28d") into milliseconds. */
export function windowMs(window: string | undefined): number | null {
  if (!window) return null;
  const m = /^(\d+)([hd])$/.exec(window.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "h" ? n * 3_600_000 : n * 86_400_000;
}

/** ISO start of the window relative to `now`, or null when the query has none. */
export function windowStartIso(window: string | undefined, now: Date): string | null {
  const ms = windowMs(window);
  return ms === null ? null : new Date(now.getTime() - ms).toISOString();
}

/** Window in whole days (hours round up to 1 day) for day-granular APIs. */
export function windowDays(window: string | undefined, fallback = 7): number {
  const ms = windowMs(window);
  if (ms === null) return fallback;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function sum(rows: Record<string, unknown>[], key: string): number {
  return round2(rows.reduce((acc, r) => acc + num(r[key]), 0));
}

export function clampLimit(limit: number | undefined, max: number, fallback: number): number {
  if (!limit || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}
