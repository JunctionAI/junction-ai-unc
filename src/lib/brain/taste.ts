/* Taste patterns — what this founder approves, holds, and how fast — and how those
   patterns shape the next proposal.

   tastePatterns(store, accountId, { now })
     from the approvals ledger (approved / held, with decidedAt) + taste_events (why_opened,
     edited, hold context) + each decided run's draft receipts (the proposed spend):
       approval rate by routine category and by spend bucket (per-day, account currency),
       typical hold reasons, median decision latency. Pure over the Store; no LLM.
   renderTasteForDecision(patterns, node, currency)   2–4 plain lines for the DECIDE prompt
   suggestedSpendCeiling(patterns)                    per-day ceiling from the evidence, or null
   applySpendCeiling(decision, ceiling, currency)     shrinks a proposal to the ceiling — never
                                                      expands — and says so in the reasoning
   readAccountProfile / writeDecisionStyle            account_profiles: tone + decision_style +
                                                      cadence read; decision_style key merged
                                                      (the other keys are another writer's)

   Relative imports only (worker build). No brain/* imports: this file reads its own tables. */

import { unwrap, type DbClient } from "../db/types";
import { ALL_SYSTEMS, type CategoryName } from "../platform/catalog";
import type { Store } from "../runtime/store/interface";
import type { ApprovalRecord, DecideNode, Decision, SpendAmount, TasteEvent } from "../runtime/types";

// ---------- shapes ----------

export type SpendBucket = "none" | "≤20/day" | "20–50/day" | "50–100/day" | "100+/day";
export const SPEND_BUCKETS: SpendBucket[] = ["none", "≤20/day", "20–50/day", "50–100/day", "100+/day"];

export interface RateCell {
  approved: number;
  held: number;
  /** approved / (approved + held) as a percentage; null when nothing was decided. */
  ratePct: number | null;
}

export interface TastePatterns {
  accountId: string;
  currency: string;
  windowDays: number;
  decided: number;
  approved: number;
  held: number;
  approvalRatePct: number | null;
  byCategory: Partial<Record<CategoryName, RateCell>>;
  bySpend: Record<SpendBucket, RateCell>;
  /** Most common hold reasons, most frequent first. */
  holdReasons: { reason: string; count: number }[];
  medianDecisionHours: number | null;
  whyOpened: number;
  edited: number;
  /** Highest per-day spend the founder approved; null when no approved proposal carried spend. */
  maxApprovedPerDay: number | null;
  /** Lowest per-day spend the founder held that sits above every approved amount; null when none. */
  minHeldAbovePerDay: number | null;
  /** How many held proposals carried spend above the approved maximum. */
  heldAboveApprovedMax: number;
  /** How many proposals with spend above the approved maximum were decided at all (approved counts 0 by construction, so this equals held above + 0). */
  decidedAboveApprovedMax: number;
}

export interface DecisionStyle {
  approval_rate: number | null;
  median_decision_hours: number | null;
  holds_by_kind: Record<string, number>;
  risk_appetite: "cautious" | "measured" | "open" | "unknown";
  spend_ceiling_per_day: number | null;
  currency: string;
  decided: number;
  derived_at: string;
  window_days: number;
}

export interface AccountProfileView {
  tone: Record<string, unknown>;
  decisionStyle: Record<string, unknown>;
  cadence: { timezone?: string; brief_time_local?: string; quiet_days?: string[] } & Record<string, unknown>;
  channels: Record<string, unknown>;
  founderNotes: string | null;
}

const DAY_MS = 86_400_000;
export const TASTE_WINDOW_DAYS = 90;

const CATEGORY_BY_ID = new Map<string, CategoryName>(ALL_SYSTEMS.map((s) => [s.id, s.cat]));

export function categoryOf(routineId: string | undefined): CategoryName | null {
  return (routineId && CATEGORY_BY_ID.get(routineId)) || null;
}

/** A proposal's spend as an amount per day in the account currency (month ÷ 30; once as-is). */
export function perDay(spend: SpendAmount | null | undefined): number | null {
  if (!spend || !Number.isFinite(spend.amount) || spend.amount <= 0) return null;
  return spend.period === "month" ? Math.round((spend.amount / 30) * 100) / 100 : spend.amount;
}

export function spendBucket(perDayAmount: number | null): SpendBucket {
  if (perDayAmount === null || perDayAmount <= 0) return "none";
  if (perDayAmount <= 20) return "≤20/day";
  if (perDayAmount <= 50) return "20–50/day";
  if (perDayAmount <= 100) return "50–100/day";
  return "100+/day";
}

const cell = (): RateCell => ({ approved: 0, held: 0, ratePct: null });
const rate = (c: RateCell) => (c.approved + c.held ? Math.round((c.approved / (c.approved + c.held)) * 100) : null);

const HOLD_KEYWORDS: [RegExp, string][] = [
  [/budget|spend|cost|\$|money|cap|expensive/i, "spend too high"],
  [/copy|tone|voice|word|caption|wording|sounds/i, "copy or tone"],
  [/audience|segment|targeting|who/i, "audience or targeting"],
  [/timing|today|week|later|not yet|wait|busy|launch/i, "timing"],
  [/creative|image|video|design|visual/i, "creative"],
];

/** The founder's own words when the approvals UI recorded them; a keyword bucket from the
    proposal's title/reasoning otherwise. Never invents a reason where neither exists. */
export function holdReasonFor(approval: ApprovalRecord | null, event: TasteEvent | null): string | null {
  const ctx = (event?.context ?? {}) as Record<string, unknown>;
  for (const k of ["reason", "why", "note", "comment"]) {
    const v = ctx[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  const text = `${approval?.title ?? ""} ${approval?.detail ?? ""} ${approval?.reasoning ?? ""}`;
  for (const [re, label] of HOLD_KEYWORDS) if (re.test(text)) return label;
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

export interface TasteOptions {
  now?: () => Date;
  windowDays?: number;
  currency?: string;
}

export async function tastePatterns(store: Store, accountId: string, opts: TasteOptions = {}): Promise<TastePatterns> {
  const now = (opts.now ?? (() => new Date()))();
  const windowDays = opts.windowDays ?? TASTE_WINDOW_DAYS;
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const [approvedAll, heldAll, events] = await Promise.all([store.listApprovals(accountId, "approved"), store.listApprovals(accountId, "held"), store.listTasteEvents(accountId, { since })]);
  const inWindow = (a: ApprovalRecord) => (a.decidedAt ?? a.createdAt) >= since;
  const approved = approvedAll.filter(inWindow);
  const held = heldAll.filter(inWindow);
  const decided = [...approved, ...held];

  // proposed spend per approval: the run's draft receipts carry decision.spend
  const spendByApproval = new Map<string, number | null>();
  for (const a of decided) {
    const receipts = await store.listReceipts(accountId, { runId: a.runId });
    let per: number | null = null;
    for (const r of receipts) {
      if (r.kind !== "draft") continue;
      const s = (r.payload as { spend?: SpendAmount | null }).spend;
      const p = perDay(s ?? null);
      if (p !== null) per = Math.max(per ?? 0, p);
    }
    spendByApproval.set(a.id, per);
  }

  const byCategory: Partial<Record<CategoryName, RateCell>> = {};
  const bySpend = Object.fromEntries(SPEND_BUCKETS.map((b) => [b, cell()])) as Record<SpendBucket, RateCell>;
  const latencies: number[] = [];
  const approvedAmounts: number[] = [];
  const heldAmounts: number[] = [];
  const heldEventByApproval = new Map<string, TasteEvent>();
  for (const e of events) if (e.action === "held" && e.approvalId) heldEventByApproval.set(e.approvalId, e);

  for (const a of decided) {
    const ok = a.status === "approved";
    const cat = categoryOf(a.routineId);
    if (cat) (byCategory[cat] ??= cell())[ok ? "approved" : "held"]++;
    const per = spendByApproval.get(a.id) ?? null;
    bySpend[spendBucket(per)][ok ? "approved" : "held"]++;
    if (per !== null) (ok ? approvedAmounts : heldAmounts).push(per);
    if (a.decidedAt) {
      const h = (new Date(a.decidedAt).getTime() - new Date(a.createdAt).getTime()) / 3_600_000;
      if (Number.isFinite(h) && h >= 0) latencies.push(h);
    }
  }
  for (const c of Object.values(byCategory)) c.ratePct = rate(c);
  for (const c of Object.values(bySpend)) c.ratePct = rate(c);

  const reasons = new Map<string, number>();
  for (const a of held) {
    const r = holdReasonFor(a, heldEventByApproval.get(a.id) ?? null);
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const holdReasons = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((x, y) => y.count - x.count || x.reason.localeCompare(y.reason))
    .slice(0, 4);

  const maxApproved = approvedAmounts.length ? Math.max(...approvedAmounts) : null;
  const heldAbove = heldAmounts.filter((h) => maxApproved === null || h > maxApproved);
  return {
    accountId,
    currency: opts.currency ?? "NZD",
    windowDays,
    decided: decided.length,
    approved: approved.length,
    held: held.length,
    approvalRatePct: decided.length ? Math.round((approved.length / decided.length) * 100) : null,
    byCategory,
    bySpend,
    holdReasons,
    medianDecisionHours: median(latencies),
    whyOpened: events.filter((e) => e.action === "why_opened").length,
    edited: events.filter((e) => e.action === "edited").length,
    maxApprovedPerDay: maxApproved,
    minHeldAbovePerDay: heldAbove.length ? Math.min(...heldAbove) : null,
    heldAboveApprovedMax: heldAbove.length,
    decidedAboveApprovedMax: heldAbove.length,
  };
}

// ---------- what the decision prompt sees ----------

const fmt = (currency: string, n: number) => `${currency}$${Number.isInteger(n) ? n : n.toFixed(2)}`.replace(/^NZD\$/, "NZ$").replace(/^AUD\$/, "A$").replace(/^USD\$/, "US$");

/** A per-day ceiling only when the evidence supports one: the founder approved spend up to
    X and held at least two proposals above X. Null means "no pattern yet" — the caller
    changes nothing. Never higher than the largest approved amount, so it can only shrink. */
export function suggestedSpendCeiling(p: TastePatterns): number | null {
  if (p.maxApprovedPerDay === null) return null;
  return p.heldAboveApprovedMax >= 2 ? p.maxApprovedPerDay : null;
}

/** 2–4 lines, numbers only from the patterns. Empty array when nothing was decided yet. */
export function renderTasteForDecision(p: TastePatterns, node?: Pick<DecideNode, "options"> | null, currency = p.currency): string[] {
  if (!p.decided) return [];
  const lines: string[] = [];
  lines.push(`This founder has decided ${p.decided} proposal${p.decided === 1 ? "" : "s"} in the last ${p.windowDays} days: approved ${p.approved}, held ${p.held}${p.medianDecisionHours !== null ? `, typically within ${p.medianDecisionHours} h` : ""}.`);
  const ceiling = suggestedSpendCeiling(p);
  if (ceiling !== null) {
    lines.push(`They have held ${p.heldAboveApprovedMax} of ${p.decidedAboveApprovedMax} budget shifts above ${fmt(currency, ceiling)}/day — propose within that ceiling or explain why not.`);
  } else if (p.maxApprovedPerDay !== null) {
    lines.push(`The largest spend they have approved is ${fmt(currency, p.maxApprovedPerDay)}/day.`);
  }
  const optionsSpend = node?.options.some((o) => o.spend);
  const cats = Object.entries(p.byCategory).filter(([, c]) => c && c.approved + c.held >= 2 && c.ratePct !== null) as [CategoryName, RateCell][];
  if (cats.length) {
    const best = cats.sort((a, b) => b[1].ratePct! - a[1].ratePct!);
    lines.push(`Approval rate by area: ${best.map(([k, c]) => `${k} ${c.ratePct}% (${c.approved + c.held})`).join(", ")}.`);
  }
  if (p.holdReasons.length && lines.length < 4) lines.push(`Typical hold reasons: ${p.holdReasons.map((r) => `${r.reason} (${r.count})`).join(", ")}.`);
  if (!optionsSpend && lines.length > 3) lines.length = 3;
  return lines.slice(0, 4);
}

/** Shrink a proposal to the ceiling. Never expands; never touches a proposal without spend. */
export function applySpendCeiling(decision: Decision, ceiling: number | null, currency: string): Decision {
  if (ceiling === null || !decision.spend) return decision;
  const per = perDay(decision.spend);
  if (per === null || per <= ceiling) return decision;
  if (decision.spend.currency !== currency) return decision;
  const amount = decision.spend.period === "month" ? Math.round(ceiling * 30 * 100) / 100 : ceiling;
  const note = `Kept under your usual ${fmt(currency, ceiling)}/day (you have held the larger shifts).`;
  return { ...decision, spend: { ...decision.spend, amount }, reasoning: `${decision.reasoning.replace(/\s+$/, "")} ${note}`.trim() };
}

// ---------- account_profiles ----------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function readAccountProfile(db: DbClient, accountId: string): Promise<AccountProfileView | null> {
  const row = await unwrap<{ tone: unknown; decision_style: unknown; cadence: unknown; channels: unknown; founder_notes: string | null } | null>(
    "account_profiles.select",
    db.from("account_profiles").select("tone, decision_style, cadence, channels, founder_notes").eq("account_id", accountId).maybeSingle(),
  );
  if (!row) return null;
  return { tone: obj(row.tone), decisionStyle: obj(row.decision_style), cadence: obj(row.cadence) as AccountProfileView["cadence"], channels: obj(row.channels), founderNotes: typeof row.founder_notes === "string" && row.founder_notes.trim() ? row.founder_notes : null };
}

export function deriveDecisionStyle(p: TastePatterns, now: Date): DecisionStyle {
  const holds: Record<string, number> = {};
  for (const [k, c] of Object.entries(p.byCategory)) if (c && c.held) holds[k] = c.held;
  const r = p.approvalRatePct;
  const risk: DecisionStyle["risk_appetite"] = p.decided < 3 || r === null ? "unknown" : r >= 75 ? "open" : r >= 45 ? "measured" : "cautious";
  return {
    approval_rate: r,
    median_decision_hours: p.medianDecisionHours,
    holds_by_kind: holds,
    risk_appetite: risk,
    spend_ceiling_per_day: suggestedSpendCeiling(p),
    currency: p.currency,
    decided: p.decided,
    derived_at: now.toISOString(),
    window_days: p.windowDays,
  };
}

/** Merge the derived keys into account_profiles.decision_style (other keys in that jsonb —
    founder-set ones, say — survive; tone / cadence / channels are not touched). */
export async function writeDecisionStyle(db: DbClient, accountId: string, style: DecisionStyle, now: Date): Promise<void> {
  const existing = await readAccountProfile(db, accountId);
  const merged = { ...(existing?.decisionStyle ?? {}), ...style };
  await unwrap("account_profiles.upsert", db.from("account_profiles").upsert({ account_id: accountId, decision_style: merged, updated_at: now.toISOString() }, { onConflict: "account_id" }));
}

/** The founder block for the DECIDE prompt (tone + decision style + notes), empty when unknown. */
export function renderProfileForDecision(profile: AccountProfileView | null): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  const tone = Object.entries(profile.tone).filter(([, v]) => typeof v === "string" || typeof v === "number");
  if (tone.length) lines.push(`Tone: ${tone.map(([k, v]) => `${k} ${String(v)}`).join(", ")}.`);
  const ds = profile.decisionStyle;
  const bits: string[] = [];
  if (typeof ds.risk_appetite === "string" && ds.risk_appetite !== "unknown") bits.push(`risk appetite ${ds.risk_appetite}`);
  if (typeof ds.approval_rate === "number") bits.push(`approves ${ds.approval_rate}% of proposals`);
  if (typeof ds.median_decision_hours === "number") bits.push(`decides within ~${ds.median_decision_hours} h`);
  if (bits.length) lines.push(`Decision style: ${bits.join(", ")}.`);
  if (profile.founderNotes) lines.push(`Founder's note on working with them: ${profile.founderNotes.replace(/\s+/g, " ").slice(0, 240)}`);
  return lines;
}
