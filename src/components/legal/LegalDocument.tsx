import Link from "next/link";
import type { LegalBlock, LegalDoc } from "@/content/legal";
import SiteFooter from "@/components/site/SiteFooter";

/* Renders a legal document from its typed section array (src/content/legal/*). Cream ground,
   Space Grotesk, 68ch measure, h2 sections, a small "Effective" line. Inline markup inside
   strings is limited to **bold** and [text](href) — see src/content/legal/types.ts. */

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          const external = /^https?:/.test(href);
          if (href.startsWith("/")) return <Link key={i} href={href}>{label}</Link>;
          return (
            <a key={i} href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {label}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const body: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: "var(--ink-soft)", margin: "0 0 14px" };

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "p")
    return (
      <p style={body}>
        <Inline text={block.text} />
      </p>
    );
  if (block.type === "list")
    return (
      <ul style={{ ...body, paddingLeft: 22 }}>
        {block.items.map((it, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <Inline text={it} />
          </li>
        ))}
      </ul>
    );
  return (
    <div style={{ overflowX: "auto", margin: "0 0 16px", border: "1px solid var(--card-border)", borderRadius: 12, background: "white" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5, lineHeight: 1.5 }}>
        <thead>
          <tr>
            {block.head.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600, borderBottom: "1px solid var(--card-border)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "10px 14px", verticalAlign: "top", color: j === 0 ? "var(--ink)" : "var(--ink-soft)", fontWeight: j === 0 ? 600 : 400, borderBottom: i < block.rows.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", color: "var(--ink)", fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif" }}>
      <nav style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 40px", display: "flex", alignItems: "center", gap: 28 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 34, height: 36, objectFit: "contain" }} />
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Junction</span>
        </Link>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 18, fontSize: 13, fontWeight: 500 }}>
          <Link href="/privacy" className="hov-fg-ink" style={{ color: doc.slug === "privacy" ? "var(--ink)" : "var(--muted)" }}>
            Privacy
          </Link>
          <Link href="/terms" className="hov-fg-ink" style={{ color: doc.slug === "terms" ? "var(--ink)" : "var(--muted)" }}>
            Terms
          </Link>
        </div>
      </nav>

      <main style={{ maxWidth: "68ch", margin: "0 auto", padding: "36px 24px 72px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>Junction · legal</div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, margin: "12px 0 0" }}>{doc.title}</h1>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Effective {doc.effective}</div>
        <div style={{ marginTop: 26, paddingTop: 22, borderTop: "1px solid var(--card-border)" }}>
          {doc.intro.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} style={{ marginTop: 34 }}>
            <h2 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 12px", scrollMarginTop: 24 }}>{s.heading}</h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
