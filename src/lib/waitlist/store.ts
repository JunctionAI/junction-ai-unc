/* Waitlist — pure pieces (no Next, no env, no I/O): validation, the in-memory IP limiter and
   the sink cascade. The route (src/app/api/waitlist/route.ts) wires real sinks from ./sinks.ts;
   the tests hand in fakes.

   Sink cascade — "nothing is ever lost":
     1. db      service-role insert into `waitlist` (0007_waitlist.sql)   when configured
     2. email   a notification to Tom via Resend                            when RESEND_API_KEY
     3. file    append to .data/waitlist.jsonl (gitignored)                 always available
   Each step is tried only if the one before was unavailable or failed; a failure is logged
   (never surfaced to the browser) and the next sink takes over. */

export interface WaitlistEntry {
  email: string;
  country: string | null;
  source: string | null;
  referrer: string | null;
  createdAt: string;
}

export type SinkName = "db" | "email" | "file";

/** A sink resolves once the entry is safely recorded; `"duplicate"` means it was already
    there (db unique violation) — treated as recorded. Throw to fall through to the next sink. */
export type Sink = (entry: WaitlistEntry) => Promise<void | "duplicate">;

export interface WaitlistSinks {
  /** null = not configured (no service role) */
  db: Sink | null;
  /** null = not configured (no RESEND_API_KEY) */
  email: Sink | null;
  file: Sink;
}

export interface RecordResult {
  stored: SinkName | null;
  duplicate: boolean;
  /** sinks that were tried and failed, in order */
  failed: SinkName[];
}

/* Deliberately simple: one @, something either side, a dot in the domain, no whitespace.
   Deliverability is Resend's / the mailbox's problem — we only need to reject obvious junk. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const EMAIL_MAX = 254;

/** Trim + lower-case; null when it isn't an email we'd accept. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > EMAIL_MAX) return null;
  return EMAIL_RE.test(s) ? s : null;
}

/** Only plain short tokens survive (hero, closer, pricing, nav…); anything else → null. */
export function normalizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, 64);
  return /^[a-z0-9_-]+$/i.test(s) ? s : null;
}

export function normalizeCountryHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** Fixed-window in-memory limiter keyed by IP: `limit` hits per `windowMs`. Per server
    instance (fine for a waitlist — the DB unique key is the real backstop). */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  constructor(
    readonly limit = 10,
    readonly windowMs = 60_000,
  ) {}

  /** true = allowed (and counted); false = over the limit for this window. */
  hit(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || now - cur.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      this.sweep(now);
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count++;
    return true;
  }

  /** Drop stale windows so the map can't grow without bound. */
  private sweep(now: number) {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) if (now - v.windowStart >= this.windowMs) this.hits.delete(k);
  }

  reset() {
    this.hits.clear();
  }
}

/** Run the cascade. Never throws: the last-resort file sink failing is logged and reported
    as `stored: null` (the route still answers ok — the visitor did nothing wrong). */
export async function recordWaitlist(entry: WaitlistEntry, sinks: WaitlistSinks, log: (msg: string) => void = (m) => console.error(m)): Promise<RecordResult> {
  const failed: SinkName[] = [];
  const order: [SinkName, Sink | null][] = [
    ["db", sinks.db],
    ["email", sinks.email],
    ["file", sinks.file],
  ];
  for (const [name, sink] of order) {
    if (!sink) continue;
    try {
      const r = await sink(entry);
      return { stored: name, duplicate: r === "duplicate", failed };
    } catch (e) {
      failed.push(name);
      log(`[waitlist] ${name} sink failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { stored: null, duplicate: false, failed };
}
