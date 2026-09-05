"use client";
/* Inline waitlist capture — the landing page's one action while founders are onboarded in
   small groups. Single email input + pill button; posts to /api/waitlist. Copy in Unc's voice. */

import { useRef, useState } from "react";
import { normalizeEmail } from "@/lib/waitlist/store";

export const WAITLIST_COPY = {
  button: "Join the waitlist →",
  helper: "I’m onboarding founders in small groups — leave your email and I’ll bring you in.",
  success: "You’re on the list. Your signup is recorded.",
  invalid: "That doesn’t look like an email — try again?",
  failed: "We couldn’t confirm your signup. Please try again in a moment.",
  rateLimited: "Too many attempts. Give it a minute, then try again.",
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
  const pending = useRef(false);
  const navy = tone === "navy";
  const helperText = helper ?? WAITLIST_COPY.helper;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
    const normalized = normalizeEmail(email);
    if (!normalized) { setState("error"); setMessage(WAITLIST_COPY.invalid); return; }
    pending.current = true;
    setState("busy");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: normalized, source }), signal: AbortSignal.timeout(20_000) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok === true) {
        setState("done");
        return;
      }
      setState("error");
      setMessage(body.error === "invalid_email" ? WAITLIST_COPY.invalid : res.status === 429 ? WAITLIST_COPY.rateLimited : WAITLIST_COPY.failed);
    } catch {
      setState("error");
      setMessage(WAITLIST_COPY.failed);
    } finally { pending.current = false; }
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
    <form id={id} onSubmit={submit} noValidate aria-busy={state === "busy"} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: align === "center" ? "center" : "flex-start" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start" }}>
        <input
          type="email"
          name="email"
          aria-label="Your email"
          autoComplete="email"
          required
          maxLength={254}
          aria-invalid={state === "error" && message === WAITLIST_COPY.invalid}
          aria-describedby={`${id}-feedback`}
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
      <div id={`${id}-feedback`} role={message ? "alert" : undefined} style={{ fontSize: 12.5, lineHeight: 1.5, color: message ? "var(--amber-text)" : navy ? "var(--on-navy-dim)" : "var(--muted)", maxWidth: 440, textAlign: align === "center" ? "center" : "left" }}>{message ?? helperText}</div>
    </form>
  );
}
