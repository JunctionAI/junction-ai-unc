"use client";
import { useAccountRequest } from "./AccountScope";
/* Amber strip above the control centre while a payment is failing ('past_due'). */

import { useState } from "react";
import { openPortal } from "@/lib/billing/clientActions";

export default function BillingBanner() {
  const accountRequest = useAccountRequest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    const err = await openPortal(accountRequest);
    if (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <div style={{ background: "var(--amber-wash)", color: "var(--amber-text)", padding: "10px 32px", fontSize: 13, display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid oklch(0.88 0.06 80)" }}>
      <span style={{ flex: 1 }}>Your last payment didn’t go through. Update your card and I keep working — nothing is lost.</span>
      {error && <span style={{ fontSize: 12 }}>{error}</span>}
      <button onClick={go} disabled={busy} className="btn-navy" style={{ padding: "7px 16px", fontSize: 12.5, opacity: busy ? 0.7 : 1 }}>
        {busy ? "Opening…" : "Update card"}
      </button>
    </div>
  );
}
