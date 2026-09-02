"use client";

import { useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/db/client";

type Phase = "idle" | "sending" | "sent" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setPhase("error");
      setMessage("That doesn’t look like an email — check it and try again.");
      return;
    }
    setPhase("sending");
    try {
      const { error } = await getBrowserSupabase().auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app` },
      });
      if (error) throw error;
      setPhase("sent");
      setMessage(`Link’s on its way to ${addr}. Open it on this device and I’ll take it from there.`);
    } catch {
      setPhase("error");
      setMessage("I couldn’t send that just now. Give it a moment and try again.");
    }
  };

  if (phase === "sent") {
    return (
      <div style={{ background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 12, padding: "14px 16px", fontSize: 14, lineHeight: 1.55 }}>
        {message}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            className="hov-underline"
            style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, cursor: "pointer", padding: 0 }}
          >
            Wrong address? Send it somewhere else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="login-email" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
        Your email
      </label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourbusiness.com"
        disabled={phase === "sending"}
        style={{
          width: "100%",
          padding: "12px 14px",
          fontSize: 15,
          border: "1px solid var(--input-border)",
          borderRadius: 10,
          background: "white",
          color: "var(--ink)",
          outline: "none",
        }}
      />
      {phase === "error" && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--amber-text)" }}>{message}</div>}
      <button type="submit" className="btn-navy" disabled={phase === "sending"} style={{ marginTop: 14, width: "100%", padding: "12px 20px", fontSize: 14, opacity: phase === "sending" ? 0.7 : 1 }}>
        {phase === "sending" ? "Sending…" : "Send me the link"}
      </button>
      <p style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, margin: "14px 0 0" }}>
        First time here? The same link creates your account. Nothing outward ever happens without your okay.
      </p>
    </form>
  );
}
