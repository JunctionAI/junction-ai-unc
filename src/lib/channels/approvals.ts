/* Approvals on a channel — resolving "which one", and every line Unc says about a decision.
   Copy rules: first person, numbers over adjectives, no exclamation marks, no hype.
   Relative imports only (worker-buildable: the push copy is used by src/worker/channels.ts). */

import type { Store } from "../runtime/store/interface";
import type { ApprovalRecord } from "../runtime/types";
import { runtimeGeneration } from "../runtime/contextFence";
import { approvalButtons, shortId, type OutboundPayload } from "./types";

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

// ---------- resolve ----------

export type ResolveResult = { ok: true; approval: ApprovalRecord } | { ok: false; reason: "none" | "ambiguous" | "unknown" | "decided"; pending: ApprovalRecord[]; approval?: ApprovalRecord };

/** Live pending approvals a run created, newest first. */
export async function livePending(store: Store, accountId: string, now: Date, contextGeneration?: number): Promise<ApprovalRecord[]> {
  const nowIso = now.toISOString();
  return (await store.listApprovals(accountId, "pending", contextGeneration)).filter((a) => !!a.runId && a.expiresAt >= nowIso);
}

/** By full id, by short id (first 8 hex chars), or — with no id — the single pending one. */
export async function resolveApproval(store: Store, accountId: string, ref: { approvalId?: string | null; short?: string | null }, now: Date, contextGeneration?: number): Promise<ResolveResult> {
  const pending = await livePending(store, accountId, now, contextGeneration);
  if (ref.approvalId) {
    const a = await store.getApproval(ref.approvalId);
    if (!a || a.accountId !== accountId) return { ok: false, reason: "unknown", pending };
    if (contextGeneration !== undefined) {
      const run = a.runId ? await store.getRun(a.runId) : null;
      if (!run || run.accountId !== accountId || runtimeGeneration(run.contextGeneration) !== contextGeneration) return { ok: false, reason: "unknown", pending };
    }
    if (a.status !== "pending") return { ok: false, reason: "decided", pending, approval: a };
    return { ok: true, approval: a };
  }
  if (ref.short) {
    const s = ref.short.toLowerCase();
    const hits = pending.filter((a) => shortId(a.id).startsWith(s));
    if (hits.length === 1) return { ok: true, approval: hits[0] };
    if (hits.length > 1) return { ok: false, reason: "ambiguous", pending: hits };
    // maybe it was decided already
    const all = await store.listApprovals(accountId, undefined, contextGeneration);
    const decided = all.find((a) => shortId(a.id).startsWith(s));
    if (decided) return { ok: false, reason: "decided", pending, approval: decided };
    return { ok: false, reason: "unknown", pending };
  }
  if (pending.length === 1) return { ok: true, approval: pending[0] };
  return { ok: false, reason: pending.length ? "ambiguous" : "none", pending };
}

// ---------- copy ----------

export function receiptLine(decision: "approved" | "held", approval: Pick<ApprovalRecord, "title">, run: { status: string }): string {
  const title = clip(approval.title, 120);
  if (decision === "held") return `Held — ${title} stays as it was. I've noted it; it shapes what I propose next. The receipt is in the app.`;
  if (run.status === "failed") return `Approved — ${title}. Nothing changes yet: live mode is off, so this stays a draft with a receipt in the app.`;
  return `Approved — ${title}. I'm carrying on from here; the receipt is in the app.`;
}

export function whyLine(approval: Pick<ApprovalRecord, "title" | "reasoning" | "detail" | "beforeState" | "afterState">): string {
  const parts: string[] = [];
  if (approval.reasoning?.trim()) parts.push(clip(approval.reasoning, 900));
  else if (approval.detail?.trim()) parts.push(`I didn't write out the reasoning for this one. The detail: ${clip(approval.detail, 600)}`);
  else parts.push("I didn't write out the reasoning for this one — open it in the app and I'll walk you through it there.");
  if (approval.beforeState && approval.afterState) parts.push(`Before: ${clip(approval.beforeState, 120)}. After: ${clip(approval.afterState, 120)}.`);
  return parts.join(" ");
}

export function resolveFailureLine(r: Extract<ResolveResult, { ok: false }>): string {
  switch (r.reason) {
    case "none":
      return "Nothing is waiting on you right now — I'll bring the next decision here.";
    case "decided":
      return r.approval ? `That one's already ${r.approval.status}: ${clip(r.approval.title, 100)}.` : "That one's already decided.";
    case "unknown":
      return "I can't match that to a decision that's waiting. Open Junction → Home to see what's there, or reply with the id I sent.";
    case "ambiguous":
      return `Which one? ${r.pending
        .slice(0, 3)
        .map((a) => `${clip(a.title, 60)} (${shortId(a.id)})`)
        .join(" · ")}. Reply YES <id>, HOLD <id> or WHY <id>.`;
  }
}

export const unlinkedLine = (appName = "Junction") => `I don't know this number yet. Open ${appName} → Channels, pick this one and send me the code it shows you — then we're talking.`;
export const linkFailedLine = (reason: "unknown" | "expired" | "channel_mismatch") =>
  reason === "expired" ? "That code has expired — open Junction → Channels and get a fresh one; they last 10 minutes." : reason === "channel_mismatch" ? "That code was issued for a different channel. Open Junction → Channels and pick this one." : "That code didn't match anything. Open Junction → Channels and copy the code it shows you.";
export const NO_MODEL_LINE = "I've got your message — it's in our thread in the app. I can't answer live from here right now; open Junction and I'll pick it up there.";
export const SMS_NO_MODEL_LINE = "your message is saved in our app thread. i can't answer right now — please try again shortly.";

// ---------- proactive push copy ----------

export function approvalPayload(a: Pick<ApprovalRecord, "id" | "title" | "detail" | "expiresAt">, opts: { routineName?: string | null; now: Date; reminder?: boolean }): OutboundPayload {
  const hoursLeft = Math.max(0, Math.round((new Date(a.expiresAt).getTime() - opts.now.getTime()) / 3_600_000));
  const head = opts.reminder ? `Still waiting on you — about ${hoursLeft} h before this lapses.` : "One decision needs you.";
  const lines = [head, `${clip(a.title, 160)}${opts.routineName ? ` (${opts.routineName})` : ""}`];
  if (a.detail?.trim()) lines.push(clip(a.detail, 300));
  lines.push("Approve, hold, or ask me why — here or in the app.");
  return { text: lines.join("\n"), buttons: approvalButtons(a.id) };
}

export function draftPayload(d: { title: string; detail?: string | null; routineName?: string | null }): OutboundPayload {
  const lines = [`A draft just landed${d.routineName ? ` from ${d.routineName}` : ""}.`, clip(d.title, 200)];
  if (d.detail?.trim()) lines.push(clip(d.detail, 300));
  lines.push("Nothing goes out without you — read it in the app, or ask me about it here.");
  return { text: lines.join("\n") };
}

export function briefPayload(b: { body: string; items: { kind: string; text: string }[] }): OutboundPayload {
  const lines = ["Morning. Here's today:", clip(b.body, 700)];
  const tag: Record<string, string> = { happened: "Done", needs_you: "Needs you", noticed: "Noticed", reminder: "Reminder" };
  for (const it of b.items.slice(0, 5)) lines.push(`${tag[it.kind] ?? "·"}: ${clip(it.text, 200)}`);
  return { text: lines.join("\n") };
}
