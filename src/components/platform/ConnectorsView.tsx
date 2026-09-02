"use client";

import { useEffect, useState } from "react";
import { clearConnectReturn, CONNECT_COPY, peekConnectReturn } from "@/lib/connectors/returnParams";
import { isDbConfigured } from "@/lib/db/client";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import type { PlatformVals } from "@/lib/platform/derive";

/* Connect / Reconnect: in demo mode (no Supabase configured) the button does exactly what the
   prototype did — flips the card to Connected client-side. With accounts on, it asks
   /api/connectors/<platform>/start and either follows the returned authorize URL or shows one
   line in Unc's voice when the platform isn't switched on yet. */

type StartResponse = { url?: string; fallback?: boolean; reason?: string; error?: string };
type DisconnectResponse = { ok?: boolean; fallback?: boolean; error?: string };

export default function ConnectorsView({ V }: { V: PlatformVals }) {
  // Seeded from the OAuth return (if any) on first render; cleared once shown so it doesn't replay.
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const r = peekConnectReturn();
    return r ? { [r.name]: r.kind === "connected" ? CONNECT_COPY.connected : CONNECT_COPY.failed } : {};
  });
  const [shopFor, setShopFor] = useState<string | null>(null);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => clearConnectReturn(), []);

  const note = (name: string, text: string) => setNotes((n) => ({ ...n, [name]: text }));
  // Accounts mode only: the demo cards have no token to forget.
  const canDisconnect = isDbConfigured();

  async function disconnect(name: string, demoDisconnect: () => void) {
    const platform = CONNECTOR_PLATFORMS[name];
    if (!platform) return;
    setBusy(name);
    try {
      const res = await fetch(`/api/connectors/${platform}/disconnect`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as DisconnectResponse;
      if (res.status === 401) note(name, CONNECT_COPY.signIn);
      else if (res.ok && data.ok) {
        demoDisconnect();
        note(name, CONNECT_COPY.disconnected);
      } else if (res.ok && data.fallback) note(name, CONNECT_COPY.notSwitchedOn);
      else note(name, data.error ? `${CONNECT_COPY.disconnectFailed} (${data.error})` : CONNECT_COPY.disconnectFailed);
    } catch {
      note(name, CONNECT_COPY.disconnectFailed);
    } finally {
      setBusy(null);
    }
  }

  async function start(name: string, demoConnect: () => void, shopDomain?: string) {
    if (!isDbConfigured()) {
      demoConnect();
      return;
    }
    const platform = CONNECTOR_PLATFORMS[name];
    if (!platform) {
      note(name, CONNECT_COPY.notSwitchedOn);
      return;
    }
    if (platform === "shopify" && !shopDomain) {
      setShopFor(name);
      return;
    }
    setBusy(name);
    try {
      const res = await fetch(`/api/connectors/${platform}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shopDomain ? { shop: shopDomain } : {}) });
      const data = (await res.json().catch(() => ({}))) as StartResponse;
      if (res.status === 401) note(name, CONNECT_COPY.signIn);
      else if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      } else if (res.ok && data.fallback) note(name, CONNECT_COPY.notSwitchedOn);
      else note(name, data.error ? `${CONNECT_COPY.failed} (${data.error})` : CONNECT_COPY.failed);
    } catch {
      note(name, CONNECT_COPY.failed);
    } finally {
      setBusy(null);
      setShopFor(null);
    }
  }

  return (
    <div
      data-buddy="Least privilege, always — I list every scope before you approve it. Each connection unlocks more of the library."
      style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Connectors</h1>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{V.connSummary}</div>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
        Exact, least-privilege connections to the systems that hold your source truth. Junction reads what each workflow needs — nothing more — and every credential lives in the secret store.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 26 }}>
        {V.connectors.map((cn) => (
          <div key={cn.name} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 19px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{cn.name}</span>
                <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{cn.cat}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {cn.note} · unlocks {cn.unlocks} routines
              </div>
              {shopFor === cn.name && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void start(cn.name, cn.connect, shop.trim());
                  }}
                  style={{ display: "flex", gap: 6, marginTop: 8 }}
                >
                  <input
                    autoFocus
                    value={shop}
                    onChange={(e) => setShop(e.target.value)}
                    placeholder={CONNECT_COPY.shopPrompt}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "5px 9px", border: "1px solid var(--card-border)", borderRadius: 8 }}
                  />
                  <button type="submit" className="btn-navy" disabled={busy === cn.name} style={{ flex: "none", padding: "5px 12px", fontSize: 12, fontWeight: 600 }}>
                    Go
                  </button>
                </form>
              )}
              {notes[cn.name] && (
                <div style={{ fontSize: 12, color: "var(--amber-text)", marginTop: 6, lineHeight: 1.45 }}>{notes[cn.name]}</div>
              )}
            </div>
            {cn.ok && (
              <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--cyan-text)", fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)" }}></span>Connected
                {canDisconnect && (
                  <button
                    onClick={() => void disconnect(cn.name, cn.disconnect)}
                    disabled={busy === cn.name}
                    className="hov-underline"
                    style={{ marginLeft: 8, border: "none", background: "transparent", color: "var(--muted)", fontSize: 11.5, fontWeight: 500, cursor: "pointer", padding: 0 }}
                  >
                    Disconnect
                  </button>
                )}
              </span>
            )}
            {cn.expired && (
              <button
                onClick={() => void start(cn.name, cn.connect)}
                disabled={busy === cn.name}
                style={{ flex: "none", border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "7px 15px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Reconnect
              </button>
            )}
            {cn.off && (
              <button onClick={() => void start(cn.name, cn.connect)} disabled={busy === cn.name} className="btn-navy" style={{ flex: "none", padding: "7px 16px", fontSize: 12, fontWeight: 600 }}>
                Connect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
