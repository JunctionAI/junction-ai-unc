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

export interface GoalMathInput {
  goalTitle: string;
  baselineNum: number;
  deadline: string; // yyyy-mm-dd
  currency: string;
  currentMRR?: number;
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

export function goalMath(input: GoalMathInput): GoalMath {
  const baseline = input.baselineNum || DEMO_DEFAULT_BASELINE;
  const cur = input.currentMRR ?? (baseline !== DEMO_DEFAULT_BASELINE ? baseline : DEMO_DEFAULT_CURRENT);
  const curSym = currencySymbol(input.currency);
  const digitsM = input.goalTitle.match(/\d[\d,]*/);
  const target = Math.max((digitsM ? parseInt(digitsM[0].replace(/,/g, ""), 10) : 40000) || 40000, cur + 1);
  const today = new Date(DEMO_TODAY);
  const start = new Date(DEMO_START);
  const dl = new Date(input.deadline + "T00:00:00");
  const elapsed = Math.max(1, Math.round((today.getTime() - start.getTime()) / 864e5));
  const pace = (cur - baseline) / elapsed;
  const daysLeftN = Math.max(1, Math.round((dl.getTime() - today.getTime()) / 864e5));
  const needed = Math.max(0, (target - cur) / daysLeftN);
  const proj = Math.round(cur + pace * daysLeftN);
  const gap = target - proj;
  const onTrack = gap <= 0;
  const fmt = (n: number) => fmtMoney(curSym, n);
  const goalPct = `${Math.max(0, Math.min(100, Math.round(((cur - baseline) / (target - baseline)) * 100)))}%`;
  return { baseline, cur, curSym, target, elapsed, pace, daysLeftN, needed, proj, gap, onTrack, goalPct, fmt };
}
