"use client";

/** Unc-is-typing indicator — three staggered dots reusing the jpulse keyframes from globals.css. */
export default function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "3px 0" }} aria-label="Unc is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan-link)", animation: `jpulse 1.2s ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}
