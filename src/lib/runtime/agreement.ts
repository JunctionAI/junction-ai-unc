/* Shadow-mode agreement gate.

   Score every decided proposal for a routine against what the founder approved or held.
   Unlock `apply` (graduate this routine) at ≥ AGREEMENT_THRESHOLD over AGREEMENT_WINDOW_DAYS
   with at least AGREEMENT_MIN_DECIDED decisions. LIVE_MODE_ENABLED still has to be true
   before anything executes — this flag is the per-routine graduate, not a live switch.

   Computed from the approvals ledger (no extra table). A pending or expired row does not
   count. Window is decidedAt, not createdAt. */

import type { Store } from "./store/interface";

export const AGREEMENT_THRESHOLD = 0.8;
export const AGREEMENT_WINDOW_DAYS = 28;
export const AGREEMENT_MIN_DECIDED = 10;

export interface AgreementScore {
  routineId: string;
  windowDays: number;
  decided: number;
  approved: number;
  held: number;
  /** approved / decided; null when nothing was decided in the window. */
  rate: number | null;
  applyUnlocked: boolean;
  /** One line for the inspector, in Unc's voice. */
  line: string;
}

export interface AgreementOpts {
  now?: Date;
  windowDays?: number;
  minDecided?: number;
  threshold?: number;
}

function lineFor(s: Omit<AgreementScore, "line">): string {
  if (s.decided === 0) return "No decisions on this routine yet — I keep asking.";
  const pct = Math.round((s.rate ?? 0) * 100);
  if (s.applyUnlocked) return `We agree ${pct}% over ${s.decided} decisions in ${s.windowDays} days. This routine can graduate — live execute still waits on the founder switch.`;
  if (s.decided < (s.windowDays === AGREEMENT_WINDOW_DAYS ? AGREEMENT_MIN_DECIDED : AGREEMENT_MIN_DECIDED)) {
    return `We agree ${pct}% so far (${s.approved} of ${s.decided}). I need ${AGREEMENT_MIN_DECIDED} decisions in ${s.windowDays} days at ≥${Math.round(AGREEMENT_THRESHOLD * 100)}% before I graduate this.`;
  }
  return `We agree ${pct}% over ${s.decided} decisions — under ${Math.round(AGREEMENT_THRESHOLD * 100)}%, so I keep asking.`;
}

export async function scoreAgreement(store: Store, accountId: string, routineId: string, opts: AgreementOpts = {}): Promise<AgreementScore> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? AGREEMENT_WINDOW_DAYS;
  const minDecided = opts.minDecided ?? AGREEMENT_MIN_DECIDED;
  const threshold = opts.threshold ?? AGREEMENT_THRESHOLD;
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const rows = await store.listApprovals(accountId);
  let approved = 0;
  let held = 0;
  for (const a of rows) {
    if (a.routineId !== routineId) continue;
    if (a.status !== "approved" && a.status !== "held") continue;
    if (!a.decidedAt || a.decidedAt < since) continue;
    if (a.status === "approved") approved += 1;
    else held += 1;
  }
  const decided = approved + held;
  const rate = decided === 0 ? null : approved / decided;
  const applyUnlocked = decided >= minDecided && rate !== null && rate >= threshold;
  const score: Omit<AgreementScore, "line"> = { routineId, windowDays, decided, approved, held, rate, applyUnlocked };
  return { ...score, line: lineFor(score) };
}
