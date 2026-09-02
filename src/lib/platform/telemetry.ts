/* Home ← telemetry (DB mode only). Pure and client-safe: maps GET /api/telemetry/home onto
   the exact shapes HomeView already renders — the three "The bar" cards and the automation
   strip's hours — so demo mode never touches this and stays byte-identical.

   Honesty rules encoded here:
   - a card shows a Junction benchmark ONLY when a published row exists (n ≥ 5 accounts);
   - otherwise it shows the industry reference number the demo uses, labelled as such
     ("industry reference — not yet from Junction accounts"), and NEVER the demo's
     "you're at N" — the account's own value is shown only when it was actually measured;
   - with no measured own value the card says "Not measured yet" and offers no fix button
     (nothing to fix until there is a number). */

import { BAR_METRICS, type BarMetricKey } from "@/lib/telemetry/benchmarks";
import type { HomeBarView, HomeTelemetry } from "@/lib/telemetry/home";

export type { HomeTelemetry, HomeReviewView, HomeBarView } from "@/lib/telemetry/home";

/** The demo's reference numbers, as numbers (the demo strings are "5 posts / week",
    "22% of customers", "< 4 h to leads"). Industry references, not Junction data. */
export const REFERENCE_BAR: Record<BarMetricKey, { value: number; label: string }> = {
  content_drafts_per_week: { value: 5, label: "5 drafts / week" },
  repeat_purchase_pct: { value: 22, label: "22% of customers" },
  lead_response_hours: { value: 4, label: "< 4 h to leads" },
};

export const INDUSTRY_REFERENCE_NOTE = "Industry reference — not yet from Junction accounts.";

export interface BarCardView {
  what: string;
  bar: string;
  proof: string;
  status: string;
  okColor: string;
  behind: boolean;
  fixLabel?: string;
  /** Which routines category the fix button opens. */
  fixCategory: "Content" | "Email & SMS" | "Sales";
  /** Where the bar came from. */
  source: "junction" | "reference";
}

const BEHIND = "oklch(0.5 0.12 75)";
const OK = "oklch(0.55 0.15 150)";
const NEUTRAL = "oklch(0.52 0.03 260)";

const FIX_LABELS: Record<BarMetricKey, string> = {
  content_drafts_per_week: "Queue more drafts / week",
  repeat_purchase_pct: "Switch on the flows",
  lead_response_hours: "Tighten the follow-up cadence",
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function barLabel(metricKey: BarMetricKey, value: number): string {
  switch (metricKey) {
    case "content_drafts_per_week":
      return `${fmt(value)} drafts / week`;
    case "repeat_purchase_pct":
      return `${fmt(value)}% of customers`;
    case "lead_response_hours":
      return `< ${fmt(value)} h to leads`;
  }
}

function ownLabel(metricKey: BarMetricKey, value: number): string {
  switch (metricKey) {
    case "content_drafts_per_week":
      return `${fmt(value)} drafts / week`;
    case "repeat_purchase_pct":
      return `${fmt(value)}%`;
    case "lead_response_hours":
      return `${fmt(value)} h`;
  }
}

const meets = (op: "gte" | "lte", bar: number, own: number) => (op === "gte" ? own >= bar : own <= bar);

export function barCard(view: HomeBarView): BarCardView {
  const def = BAR_METRICS.find((m) => m.metricKey === view.metricKey)!;
  const ref = REFERENCE_BAR[view.metricKey];
  const junction = view.benchmark && view.benchmark.n >= 5 ? view.benchmark : null;
  const barValue = junction ? junction.p75 : ref.value;
  const own = view.own;
  const measured = own !== null && Number.isFinite(own);
  const behind = measured && !meets(def.op, barValue, own!);
  const ownLine = measured ? `You’re at ${ownLabel(view.metricKey, own!)}.` : "I haven’t measured yours yet.";
  const proof = junction
    ? `What the top quarter of ${junction.n} Junction accounts${junction.segment !== "all" ? ` like yours (${junction.segment.replace("revenue_band:", "")})` : ""} do — the median is ${ownLabel(view.metricKey, junction.p50)}. ${ownLine}`
    : `${INDUSTRY_REFERENCE_NOTE} ${ownLine}`;
  return {
    what: def.what,
    bar: barLabel(view.metricKey, barValue),
    proof,
    status: !measured ? "Not measured yet" : behind ? "Below the bar" : "At the bar ✓",
    okColor: !measured ? NEUTRAL : behind ? BEHIND : OK,
    behind,
    fixLabel: behind ? FIX_LABELS[view.metricKey] : undefined,
    fixCategory: def.fixCategory,
    source: junction ? "junction" : "reference",
  };
}

export function barCards(t: HomeTelemetry): BarCardView[] {
  // Always the three cards in Home order, even if the payload is short.
  return BAR_METRICS.map((m) => barCard(t.bar.find((b) => b.metricKey === m.metricKey) ?? { metricKey: m.metricKey, benchmark: null, own: null }));
}

/** The automation strip's "saving you ~N h/week" in DB mode: measured hours over the last 7
    days (Σ hoursSavedPerRun × completed runs), shown to one decimal only when it is not whole. */
export function hoursSavedLabel(t: HomeTelemetry): string {
  const h = t.automation.hoursSavedWk;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** "Week of 1 Sep" for the review bubble. */
export function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return `Week of ${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}
