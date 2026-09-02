import Link from "next/link";

/* Quiet legal footer — Privacy · Terms · support@. Cream by default; `tone="navy"` for a
   navy surface. Shared by the landing page, /login and the legal pages. */
export default function SiteFooter({ tone = "cream" }: { tone?: "cream" | "navy" }) {
  const navy = tone === "navy";
  const color = navy ? "var(--faint-on-navy)" : "var(--muted)";
  const linkStyle: React.CSSProperties = { color, fontWeight: 500 };
  return (
    <footer
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "26px 40px 30px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontSize: 12,
        color,
        letterSpacing: "0.01em",
        flexWrap: "wrap",
      }}
    >
      <span>© {new Date().getFullYear()} Junction</span>
      <span aria-hidden>·</span>
      <Link href="/privacy" className="hov-fg-ink" style={linkStyle}>
        Privacy
      </Link>
      <span aria-hidden>·</span>
      <Link href="/terms" className="hov-fg-ink" style={linkStyle}>
        Terms
      </Link>
      <span aria-hidden>·</span>
      <a href="mailto:support@getjunction.ai" className="hov-fg-ink" style={linkStyle}>
        support@getjunction.ai
      </a>
    </footer>
  );
}
