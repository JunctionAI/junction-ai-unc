/* Live approvals → the Home card view model.

   The demo cards (derive.ts AP_DATA) and the runtime's ApprovalRecords render through the
   same card component, so this module maps an API ApprovalView onto exactly the shape the
   card reads: routine tag = routine id, title, detail, before → after, "expires in Nh".
   Pure and client-safe (no React, no fetch). */

import type { ApprovalView, DraftView, ReceiptView } from "@/lib/approvals/handlers";

export type { ApprovalView, DraftView, ReceiptView };

/** What Unc says, in the demo's exact register, when nothing is waiting (accounts mode only). */
export const NOTHING_WAITING_COPY = "Nothing waiting on you right now — I’ll bring the next decision here.";

/** "expires in 18h" · "expires in 2d" · "expires in 40m" · "expired". Days from 48h up, so a
    default 48-hour gate reads "2d" the way the demo's second card does. */
export function expiryLabel(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `expires in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `expires in ${hours}h`;
  return `expires in ${Math.floor(hours / 24)}d`;
}

/** Receipt ids are uuids; the bubble shows a short handle the founder can find again. */
export function receiptHandle(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

/** What the runtime returned once the founder decided. */
export interface DecisionOutcome {
  decision: "approved" | "held";
  runStatus: string;
  /** First receipt the resume produced (the notification of the decision). */
  receiptId: string | null;
  error: string | null;
}

/** The card's static fields (everything but the handlers/state the UI owns). */
export interface ApprovalCardFields {
  id: string;
  sys: string;
  title: string;
  detail: string;
  before: string;
  after: string;
  expiry: string;
  whyText: string;
  expired: boolean;
}

export function approvalCardFields(a: ApprovalView, now: Date): ApprovalCardFields {
  const expiry = expiryLabel(a.expiresAt, now);
  return {
    id: a.id,
    sys: a.routineId,
    title: a.title,
    detail: a.detail,
    before: a.before,
    after: a.after,
    expiry,
    whyText: a.reasoning || `Proposed by ${a.routineName}. No further reasoning was recorded for this decision.`,
    expired: expiry === "expired",
  };
}

/** Unc's receipt bubble after a decision — the demo's lines when the outcome matches the
    demo's happy path, an honest line when the run could not carry the approval out. */
export function outcomeCopy(o: DecisionOutcome): string {
  if (o.decision === "held") return "Held. I’ll re-surface it tomorrow with fresh numbers — nothing moves meanwhile.";
  const handle = o.receiptId ? receiptHandle(o.receiptId) : "";
  if (o.runStatus === "failed") return `Approved — but I couldn’t carry it out: ${o.error ?? "the run failed"}. Nothing was changed${handle ? `; receipt ${handle} says so` : ""}.`;
  if (o.runStatus === "skipped") return `Approved, but the run had already lapsed — nothing was changed${handle ? ` (receipt ${handle})` : ""}.`;
  return `On it — executing only the approved scope, reading the result back, then receipt ${handle || "R-…"} lands here.`;
}

export interface DraftRow {
  runId: string;
  sys: string;
  routineName: string;
  title: string;
  line: string;
}

export function draftRow(d: DraftView): DraftRow {
  return { runId: d.runId, sys: d.routineId, routineName: d.routineName, title: d.title, line: d.detail || d.description };
}

export interface ReceiptRow {
  id: string;
  handle: string;
  kind: string;
  text: string;
}

export function receiptRow(r: ReceiptView): ReceiptRow {
  return { id: r.id, handle: receiptHandle(r.id), kind: r.kind, text: r.description };
}
