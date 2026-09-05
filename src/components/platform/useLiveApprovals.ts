"use client";
import { useAccountRequest } from "@/components/platform/AccountScope";
/* The account's live "needs you" list. Enabled only when the platform is in accounts mode
   (Supabase configured + session); a no-op otherwise, so demo mode never fetches.

   GET /api/approvals on mount → approvals + recent receipts + dry-run drafts.
   Approve / Hold → POST /api/approvals/<id> (the worker's resume path) → the card flips to
   the same confirmation + receipt bubbles the demo shows, from what the runtime actually
   returned. Why? toggles the approval's own `reasoning`. */

import { useCallback, useEffect, useState } from "react";
import { approvalCardFields, draftRow, outcomeCopy, receiptRow, type ApprovalView, type DecisionOutcome, type DraftRow, type DraftView, type ReceiptRow, type ReceiptView } from "@/lib/platform/approvals";

export interface LiveApprovalCard {
  key: string;
  sys: string;
  title: string;
  detail: string;
  before: string;
  after: string;
  expiry: string;
  pending: boolean;
  approved: boolean;
  held: boolean;
  showWhy: boolean;
  whyText: string;
  /** Unc's line after a decision (approved or held). */
  outcomeText: string;
  busy: boolean;
  approve: () => void;
  hold: () => void;
  why: () => void;
}

export interface LiveApprovals {
  /** true once the listing is in hand — the Home view renders the live list only then. */
  active: boolean;
  loading: boolean;
  error: string | null;
  approvals: LiveApprovalCard[];
  pendingCount: number;
  receipts: ReceiptRow[];
  drafts: DraftRow[];
  refresh: () => void;
}

interface Listing {
  approvals: ApprovalView[];
  receipts: ReceiptView[];
  drafts: DraftView[];
}

type DecideResponse = { approval?: { status?: string }; run?: { status?: string; error?: string | null }; receipts?: { id: string }[]; error?: string };

export function useLiveApprovals(enabled: boolean, now: () => Date = () => new Date()): LiveApprovals {
  const accountRequest = useAccountRequest();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, DecisionOutcome>>({});
  const [why, setWhy] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await accountRequest("/api/approvals", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Partial<Listing> & { fallback?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || data.fallback || !Array.isArray(data.approvals)) {
          setListing(null);
          setError(data.error ?? (data.fallback ? null : `couldn’t load approvals (${res.status})`));
        } else {
          setListing({ approvals: data.approvals, receipts: data.receipts ?? [], drafts: data.drafts ?? [] });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountRequest, enabled, tick]);

  const decide = useCallback(async (id: string, decision: "approved" | "held") => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await accountRequest(`/api/approvals/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = (await res.json().catch(() => ({}))) as DecideResponse;
      if (!res.ok) {
        setError(data.error ?? `decision failed (${res.status})`);
        return;
      }
      setOutcomes((o) => ({ ...o, [id]: { decision, runStatus: data.run?.status ?? "done", receiptId: data.receipts?.[0]?.id ?? null, error: data.run?.error ?? null } }));
      if (data.receipts?.length) {
        setListing((l) => (l ? { ...l, receipts: [...(data.receipts as ReceiptView[]).map((r) => r as ReceiptView).reverse(), ...l.receipts].slice(0, 10) } : l));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }, [accountRequest]);

  const t = now();
  const approvals: LiveApprovalCard[] = (listing?.approvals ?? []).map((a) => {
    const f = approvalCardFields(a, t);
    const o = outcomes[a.id];
    const pending = !o;
    return {
      key: a.id,
      sys: f.sys,
      title: f.title,
      detail: f.detail,
      before: f.before,
      after: f.after,
      expiry: f.expiry,
      pending,
      approved: o?.decision === "approved",
      held: o?.decision === "held",
      showWhy: pending && !!why[a.id],
      whyText: f.whyText,
      outcomeText: o ? outcomeCopy(o) : "",
      busy: !!busy[a.id],
      approve: () => void decide(a.id, "approved"),
      hold: () => void decide(a.id, "held"),
      why: () => setWhy((w) => ({ ...w, [a.id]: !w[a.id] })),
    };
  });

  return {
    active: enabled && listing !== null,
    loading: enabled && listing === null && error === null,
    error,
    approvals,
    pendingCount: approvals.filter((a) => a.pending).length,
    receipts: (listing?.receipts ?? []).map(receiptRow),
    drafts: (listing?.drafts ?? []).map(draftRow),
    refresh: () => setTick((n) => n + 1),
  };
}
