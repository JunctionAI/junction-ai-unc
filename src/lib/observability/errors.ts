/* Error capture for the beta — every caught server error lands in ONE place.

     captureError(scope, err, ctx?, opts?)   console (JSON line, redacted) + an app_errors row
                                              (migration 0014; service role; best effort — a
                                              failed write never throws)
     withErrorCapture(scope, handler)         wraps a route handler: an uncaught throw is captured
                                              and the client gets a plain 500 { error } with no
                                              stack, no message, no key — ever.

   Redaction is unconditional (src/worker/log.ts redact): key-shaped field names and
   token-shaped values are replaced before anything is written or printed. Relative imports
   only (the worker's standalone build carries this file). */

import { asDb } from "../db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../db/server";
import type { DbClient } from "../db/types";
import { redact } from "../../worker/log";

export const STACK_MAX_CHARS = 4000;
export const MESSAGE_MAX_CHARS = 1000;
export const CLIENT_ERROR_LINE = "Something went wrong on my side — it’s logged and Tom will see it.";

export interface CaptureContext {
  accountId?: string | null;
  [field: string]: unknown;
}

export interface CaptureOptions {
  /** undefined = the service role when configured; null = never write a row. */
  db?: DbClient | null;
  /** Console sink; default console.error. */
  log?: (line: string) => void;
  now?: () => Date;
}

export interface CapturedError {
  scope: string;
  message: string;
  stack: string | null;
  accountId: string | null;
  context: Record<string, unknown>;
  createdAt: string;
}

let dbResolver: () => DbClient | null = () => {
  try {
    return isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  } catch {
    return null;
  }
};
/** Tests only: where captureError writes (undefined = restore the env-gated default). */
export function setErrorDbForTests(f: (() => DbClient | null) | undefined): void {
  dbResolver = f ?? (() => (isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null));
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));

/** Token-shaped substrings INSIDE free text (an error message quoting a header, a URL with a
    key): the worker's redact() replaces whole values; this scrubs the middle of a sentence. */
const TOKEN_IN_TEXT_RE = /(sk-ant-[A-Za-z0-9_-]{6,}|shp(?:at|ca|ss)_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9_]{8,}|ya29\.[A-Za-z0-9_.-]{6,}|EAA[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{6,}|(?:api[_-]?key|token|secret|password)=[^\s&"']+)/gi;
export function scrubText(text: string): string {
  return text.replace(TOKEN_IN_TEXT_RE, (m) => (/^(api[_-]?key|token|secret|password)=/i.test(m) ? `${m.split("=")[0]}=[redacted]` : "[redacted]"));
}

function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubDeep(v)]));
  return value;
}

/** The error as a row: redacted message, truncated redacted stack, redacted context. Pure. */
export function describeError(scope: string, err: unknown, ctx: CaptureContext = {}, now: Date = new Date()): CapturedError {
  const e = err instanceof Error ? err : null;
  const rawMessage = e ? e.message : str(err) || "unknown error";
  const message = scrubText(str(redact(rawMessage))).slice(0, MESSAGE_MAX_CHARS) || "unknown error";
  const stack = e?.stack ? scrubText(str(redact(e.stack))).slice(0, STACK_MAX_CHARS) : null;
  const { accountId, ...rest } = ctx;
  return { scope: scope.slice(0, 120), message, stack, accountId: typeof accountId === "string" && accountId ? accountId : null, context: scrubDeep(redact(rest)) as Record<string, unknown>, createdAt: now.toISOString() };
}

export async function captureError(scope: string, err: unknown, ctx: CaptureContext = {}, opts: CaptureOptions = {}): Promise<CapturedError> {
  const now = opts.now ?? (() => new Date());
  const row = describeError(scope, err, ctx, now());
  const log = opts.log ?? ((line: string) => console.error(line));
  try {
    log(JSON.stringify({ event: "error.captured", ...row, stack: row.stack ? row.stack.split("\n").slice(0, 4).join(" | ") : null }));
  } catch {
    /* logging never takes the caller down */
  }
  const db = opts.db === undefined ? dbResolver() : opts.db;
  if (db) {
    try {
      const { error } = await db.from("app_errors").insert({ scope: row.scope, message: row.message, stack: row.stack, account_id: row.accountId, context: row.context, created_at: row.createdAt });
      if (error) log(JSON.stringify({ event: "error.write_failed", scope: row.scope, error: error.message }));
    } catch (e) {
      try {
        log(JSON.stringify({ event: "error.write_failed", scope: row.scope, error: e instanceof Error ? e.message : String(e) }));
      } catch {
        /* nothing */
      }
    }
  }
  return row;
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response> | Response;

/** Wrap a Next route handler. The request's method + pathname (never the query string or
    body) ride along as context; the client sees a plain 500 with one honest line. */
export function withErrorCapture<A extends unknown[]>(scope: string, handler: Handler<A>, opts: CaptureOptions = {}): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      const req = args[0] instanceof Request ? args[0] : null;
      let path: string | null = null;
      try {
        path = req ? new URL(req.url).pathname : null;
      } catch {
        path = null;
      }
      await captureError(scope, err, { method: req?.method ?? null, path }, opts);
      return Response.json({ error: CLIENT_ERROR_LINE }, { status: 500 });
    }
  };
}
