"use client";
/* Inline waitlist capture — the landing page's one action while founders are onboarded in
   small groups. Single email input + pill button; posts to /api/waitlist. Copy in Unc's voice. */

import { useState } from "react";

export const WAITLIST_COPY = {
  button: "Join the waitlist →",
  helper: "I’m onboarding founders in small groups — leave your email and I’ll bring you in.",
  success: "You’re on the list. I’ll email you when it’s your turn.",
  invalid: "That doesn’t look like an email — try again?",
  failed: "Something went wrong my end — try again in a moment.",
  placeholder: "you@yourbusiness.com",
} as const;

/** Scroll a form into view and put the cursor in its input (every other CTA on the page). */
export function goToWaitlist(id: string) {
  const root = document.getElementById(id);
  if (!root) return;
  root.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = root.querySelector<HTMLInputElement>("input[type=email]");
  if (input) window.setTimeout(() => input.focus({ preventScroll: true }), 350);
}

export default function WaitlistForm({ id, source, tone = "cream", helper, align = "left" }: { id: string; source: string; tone?: "cream" | "navy"; helper?: string; align?: "left" | "center" }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const navy = tone === "navy";
  const helperText = helper ?? WAITLIST_COPY.helper;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, source }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) {
        setState("done");
        return;
      }
      setState("error");
      setMessage(body.error === "invalid_email" ? WAITLIST_COPY.invalid : WAITLIST_COPY.failed);
    } catch {
      setState("error");
      setMessage(WAITLIST_COPY.failed);
    }
  };

  if (state === "done") {
    return (
      <div id={id} role="status" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: align === "center" ? "center" : "flex-start", fontSize: 15, fontWeight: 600, color: navy ? "var(--on-navy)" : "var(--ink)" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--cyan)", boxShadow: "0 0 12px oklch(0.78 0.13 220 / 0.6)", flex: "none" }} />
        {WAITLIST_COPY.success}
      </div>
    );
  }

  return (
    <form id={id} onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: align === "center" ? "center" : "flex-start" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start" }}>
        <input
          type="email"
          name="email"
          aria-label="Your email"
          autoComplete="email"
          required
          placeholder={WAITLIST_COPY.placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === "busy"}
          style={{
            width: 280,
            maxWidth: "100%",
            padding: "13px 18px",
            fontSize: 15,
            borderRadius: 999,
            border: navy ? "1.5px solid oklch(0.78 0.13 220 / 0.35)" : "1.5px solid var(--input-border)",
            background: navy ? "var(--navy-raised)" : "white",
            color: navy ? "var(--on-navy)" : "var(--ink)",
            outline: "none",
          }}
        />
        <button
          type="submit"
          className={navy ? "btn-cyan" : "btn-navy"}
          disabled={state === "busy"}
          style={{ padding: "14px 28px", fontSize: 15, opacity: state === "busy" ? 0.7 : 1, boxShadow: navy ? "0 0 40px oklch(0.78 0.13 220 / 0.4)" : "0 8px 28px oklch(0.27 0.055 262 / 0.22)" }}
        >
          {state === "busy" ? "One sec…" : WAITLIST_COPY.button}
        </button>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: message ? "var(--amber-text)" : navy ? "var(--on-navy-dim)" : "var(--muted)", maxWidth: 440, textAlign: align === "center" ? "center" : "left" }}>{message ?? helperText}</div>
    </form>
  );
}
