/* Goal math — ported verbatim from design-reference/platform-v2-logic.js renderVals().
   pace = (current − baseline) / days elapsed; needed = gap / days left;
   lands-at = current + pace × days left. Divide-by-zero guards are the prototype's own
   (elapsed and daysLeft floored at 1; target floored at cur + 1 so target − baseline > 0). */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NZD: "NZ$",
  AUD: "A$",
  USD: "US$",
  GBP: "£",
  EUR: "€",
};

export const currencySymbol = (code: string): string => CURRENCY_SYMBOLS[code] || "NZ$";

export const fmtMoney = (sym: string, n: number): string => sym + Math.round(n).toLocaleString("en-NZ");

/* Fixed demo-clock dates from the prototype (client-side demo data — Phase 1 parity). */
export const DEMO_TODAY = "2026-08-31T00:00:00";
export const DEMO_START = "2026-08-12T00:00:00";
export const DEMO_DEFAULT_CURRENT = 31650;
export const DEMO_DEFAULT_BASELINE = 28400;

/** What Unc says on Home (accounts mode) when the baseline is NULL — instead of fake progress off the demo 28,400. */
export const BASELINE_NOT_SET_COPY = "Baseline not set yet — tell me where you started and I’ll work the pace out from there.";

export interface GoalMathInput {
  goalTitle: string;
  /** null = not set; goalMath still falls back to the demo baseline for the maths, and the caller decides whether to show it. */
  baselineNum: number | null;
  deadline: string; // yyyy-mm-dd
  currency: string;
  currentMRR?: number;
  /** Accounts mode: the real clock (demo mode runs on the prototype's fixed DEMO_TODAY). */
  today?: Date;
  /** Accounts mode: when the goal was set (plans.agreed_at) — pace is measured from here. Defaults to `today`. */
  start?: Date;
  /** Target when the goal line carries no number. Demo falls back to the prototype's 40,000; accounts pass their typed target (0 = not set). */
  targetFallback?: number;
}

export interface GoalMath {
  baseline: number;
  cur: number;
  curSym: string;
  target: number;
  elapsed: number;
  pace: number;
  daysLeftN: number;
  needed: number;
  proj: number;
  gap: number;
  onTrack: boolean;
  goalPct: string;
  fmt: (n: number) => string;
}


/** First number in a goal string, honouring thousands separators, decimals and k/M suffixes:
 *  "NZ$40,000 MRR" → 40000 · "$1.2M revenue" → 1200000 · "25k followers" → 25000 · "63% margin" → 63. */
export function parseGoalTarget(title: string): number | null {
  const m = title.match(/(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?(?![\w.])/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1;
  return Math.round(n * mult);
}

export function goalMath(input: GoalMathInput): GoalMath {
  const baseline = input.baselineNum || DEMO_DEFAULT_BASELINE;
  const cur = input.currentMRR ?? (baseline !== DEMO_DEFAULT_BASELINE ? baseline : DEMO_DEFAULT_CURRENT);
  const curSym = currencySymbol(input.currency);
  const target = Math.max(parseGoalTarget(input.goalTitle) || input.targetFallback || 40000, cur + 1);
  const today = input.today ?? new Date(DEMO_TODAY);
  const start = input.start ?? (input.today ? input.today : new Date(DEMO_START));
  const dl = new Date(input.deadline + "T00:00:00");
  const elapsed = Math.max(1, Math.round((today.getTime() - start.getTime()) / 864e5));
  const pace = (cur - baseline) / elapsed;
  const dlMs = Number.isFinite(dl.getTime()) ? dl.getTime() : today.getTime() + 30 * 864e5; // unparseable deadline → 30 days, never NaN
  const daysLeftN = Math.max(1, Math.round((dlMs - today.getTime()) / 864e5));
  const needed = Math.max(0, (target - cur) / daysLeftN);
  const proj = Math.round(cur + pace * daysLeftN);
  const gap = target - proj;
  const onTrack = gap <= 0;
  const fmt = (n: number) => fmtMoney(curSym, n);
  const goalPct = `${Math.max(0, Math.min(100, Math.round(((cur - baseline) / (target - baseline)) * 100)))}%`;
  return { baseline, cur, curSym, target, elapsed, pace, daysLeftN, needed, proj, gap, onTrack, goalPct, fmt };
}
