/* Structured JSON logging for the worker. One object per line on stdout.

   Redaction is unconditional: any field whose key looks like a secret, or
   whose value looks like a platform token, is replaced before it is
   serialised. The worker never has real credentials today (fixture provider
   only) — this is the belt to that brace. */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  [field: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEY_RE = /token|secret|password|passwd|api[-_]?key|authorization|credential|cookie|bearer/i;
// Prefixes of well-known token formats (Anthropic, Shopify, Klaviyo private keys, Google OAuth, Meta long-lived tokens).
const SECRET_VALUE_RE = /^(sk-ant-|shpat_|shpca_|shpss_|pk_|ya29\.|EAA[A-Za-z0-9]{20,}|Bearer\s)/;

export const REDACTED = "[redacted]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return SECRET_VALUE_RE.test(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}

export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(JSON.stringify(entry) + "\n");
};

export function createLogger(sink: LogSink = stdoutSink, base: Record<string, unknown> = {}, now: () => Date = () => new Date()): Logger {
  const log = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    const entry = { ts: now().toISOString(), level, event, ...(redact({ ...base, ...fields }) as Record<string, unknown>) } as LogEntry;
    try {
      sink(entry);
    } catch {
      // a logging failure must never take the loop down
    }
  };
  return {
    log,
    debug: (e, f) => log("debug", e, f),
    info: (e, f) => log("info", e, f),
    warn: (e, f) => log("warn", e, f),
    error: (e, f) => log("error", e, f),
  };
}

/** A sink that collects entries (tests). */
export function memorySink(): { sink: LogSink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { sink: (e) => entries.push(e), entries };
}
