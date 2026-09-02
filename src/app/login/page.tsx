import Link from "next/link";
import { isDbConfigured } from "@/lib/db/client";
import LoginForm from "./LoginForm";

export const metadata = { title: "Junction — Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link didn’t work — it may have expired or been used already. Ask me for a fresh one.",
  auth: "I couldn’t sign you in just now. Try again in a moment.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = isDbConfigured();
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "white",
          border: "1px solid var(--card-border)",
          borderRadius: 18,
          padding: "34px 34px 30px",
          boxShadow: "0 2px 14px oklch(0.27 0.055 262 / 0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 44, height: 47, objectFit: "contain" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>Junction</div>
            <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Growth agent</div>
          </div>
        </div>

        {configured ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Sign in</h1>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)", margin: "0 0 20px" }}>
              Tell me your email and I’ll send a link — no password to remember.
            </p>
            {error && ERRORS[error] && (
              <div style={{ background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                {ERRORS[error]}
              </div>
            )}
            <LoginForm />
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Accounts aren’t switched on yet</h1>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)", margin: "0 0 22px" }}>
              Nothing to sign in to for now — you can still explore everything with demo data. Your goal, plan and routines live in this browser
              tab until accounts arrive.
            </p>
            <Link href="/app">
              <button className="btn-navy" style={{ padding: "12px 22px", fontSize: 14 }}>
                Explore with demo data →
              </button>
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
