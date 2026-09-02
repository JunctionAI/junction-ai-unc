/* A small 5-field cron matcher (minute hour day-of-month month day-of-week), UTC.

   Supported per field: `*`, `*​/n`, single values, lists `a,b,c`, ranges `a-b`,
   stepped ranges `a-b/n`. Day-of-week accepts 0-7 (0 and 7 are both Sunday).
   Day-of-month and day-of-week follow the classic vixie rule: when BOTH are
   restricted, a minute matches if EITHER matches. Names (MON, JAN) are not
   supported — the catalog only uses numeric cadences (see CADENCE in
   src/lib/runtime/catalog-specs.ts). Pure; no I/O. */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when the field was `*` (unrestricted) — needed for the dom/dow rule. */
  domAny: boolean;
  dowAny: boolean;
}

const RANGES: Record<keyof Omit<CronFields, "domAny" | "dowAny">, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

function parseInt10(s: string, what: string): number {
  if (!/^\d+$/.test(s)) throw new Error(`cron: "${s}" is not a number in ${what}`);
  return Number(s);
}

function parseField(field: string, name: keyof typeof RANGES): Set<number> {
  const [lo, hi] = RANGES[name];
  const out = new Set<number>();
  for (const part of field.split(",")) {
    if (!part) throw new Error(`cron: empty list item in ${name}`);
    const [rangePart, stepPart] = part.split("/");
    if (part.includes("/") && (stepPart === undefined || stepPart === "")) throw new Error(`cron: missing step in ${name}`);
    const step = stepPart !== undefined ? parseInt10(stepPart, name) : 1;
    if (step < 1) throw new Error(`cron: step must be >= 1 in ${name}`);
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = lo;
      end = hi;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = parseInt10(a, name);
      end = parseInt10(b, name);
      if (start > end) throw new Error(`cron: range ${rangePart} is backwards in ${name}`);
    } else {
      start = parseInt10(rangePart, name);
      // `5/10` (value with step) means "from 5 to the end, every 10" in vixie cron
      end = stepPart !== undefined ? hi : start;
    }
    if (start < lo || end > hi) throw new Error(`cron: ${rangePart} out of range ${lo}-${hi} in ${name}`);
    for (let v = start; v <= end; v += step) out.add(v);
  }
  if (name === "dayOfWeek" && out.has(7)) out.add(0);
  return out;
}

/** Parse a 5-field cron expression. Throws on anything malformed. */
export function parseCron(expr: string): CronFields {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron: expected 5 fields, got ${fields.length} in "${expr}"`);
  const [m, h, dom, mon, dow] = fields;
  return {
    minute: parseField(m, "minute"),
    hour: parseField(h, "hour"),
    dayOfMonth: parseField(dom, "dayOfMonth"),
    month: parseField(mon, "month"),
    dayOfWeek: parseField(dow, "dayOfWeek"),
    domAny: dom === "*",
    dowAny: dow === "*",
  };
}

export function isCronExpression(cadence: string): boolean {
  try {
    parseCron(cadence);
    return true;
  } catch {
    return false;
  }
}

/** Does this UTC minute match the expression? Seconds are ignored. */
export function cronMatches(expr: string | CronFields, date: Date): boolean {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  if (!c.minute.has(date.getUTCMinutes())) return false;
  if (!c.hour.has(date.getUTCHours())) return false;
  if (!c.month.has(date.getUTCMonth() + 1)) return false;
  const domOk = c.dayOfMonth.has(date.getUTCDate());
  const dowOk = c.dayOfWeek.has(date.getUTCDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowOk;
  if (c.dowAny) return domOk;
  return domOk || dowOk;
}

/** Truncate to the start of the UTC minute. */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

/** The most recent minute in (from, to] that matches, or null. Scans minute by
    minute backwards, so keep the window small (the scheduler uses minutes to
    an hour, never days). */
export function latestSlotBetween(expr: string | CronFields, from: Date, to: Date): Date | null {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  for (let t = floorToMinute(to); t.getTime() > from.getTime(); t = new Date(t.getTime() - 60_000)) {
    if (cronMatches(c, t)) return t;
  }
  return null;
}
