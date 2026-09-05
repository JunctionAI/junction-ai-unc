"use client";

import { useEffect, useState } from "react";
import { MANUAL_COPY, MANUAL_FORMS, type ManualPlatform } from "@/lib/connectors/manualFields";
import { PICKER_PLATFORMS, type AccountOption } from "@/lib/connectors/options";
import { clearConnectReturn, CONNECT_COPY, GOOGLE_UMBRELLA_NAME, peekConnectReturn } from "@/lib/connectors/returnParams";
import { isDbConfigured } from "@/lib/db/client";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import type { PlatformVals } from "@/lib/platform/derive";
import { knownPlatformSlugs, SUGGESTION_COPY } from "@/lib/setup/channels";
import { connectorHasRealSync } from "@/lib/connectors/sync";
import { connectorEvidence, connectorRecoveryMessage } from "@/lib/connectors/readiness";
import { useConnectorsState, type ConnectorsStateListing, type ConnectorStateView } from "./useConnectorsState";
import connectionStyles from "./connections.module.css";
import type { ConnectionDataState } from "@/lib/data/connectionState";

const DATA_STATUS = {
  ready: "Fresh at last check", stale: "Needs fresh data", missing: "Not synced yet",
  unverified: "Source not verified", identity_mismatch: "Account binding needs review",
  connection_unverified: "Connection or selected asset needs review", normalization_outdated: "Data format needs updating",
};

export function ConnectionDataPanel({ state }: { state?: ConnectionDataState }) {
  return <section className={connectionStyles.readiness} aria-label="Stored Meta data readiness">
    <h2>Data for your routines</h2>
    <p>{!state || state.status === "unavailable" ? "Data readiness could not be verified. Refresh status to check again." :
      state.status === "no_demand" ? "No enabled routines currently require stored Meta data." :
      state.status === "ready" ? "Required Meta datasets were fresh at the last check." : "Some required Meta datasets need attention before stored-data routines can use them."}</p>
    {state?.accountPaused === true && <p className={connectionStyles.paused}>Account automation is paused. Fresh data does not resume it.</p>}
    {!!state?.queries.length && <ul>{state.queries.map(q => <li key={q.key}>
      <strong>{q.resource} · {q.routineIds.join(", ")}</strong>
      <span>{DATA_STATUS[q.availability]} · maximum age {q.maxAgeMs / 60_000} min</span>
      <span>{q.sourceFetchedAt ? `Source read: ${q.sourceFetchedAt}` : "No verified source read available."}</span>
    </li>)}</ul>}
    <p className={connectionStyles.readinessNote}>Checks required Meta reads only; other platforms and optional reads are not covered. This does not verify scheduled refreshes or successful routine runs. Refresh status checks stored records—it does not fetch new provider data.</p>
    {state && <p className={connectionStyles.readinessNote}>Checked: {state.checkedAt}</p>}
  </section>;
}

/* Connect / Reconnect: in demo mode (no Supabase configured) the button does exactly what the
   prototype did — flips the card to Connected client-side. With accounts on, it asks
   /api/connectors/<platform>/start and either follows the returned authorize URL or shows one
   line in Unc's voice when the platform isn't switched on yet.

   Post-connect picker (accounts mode only): a Connected GA4 / Google Ads / Meta Ads card whose
   connector has no external_ref yet asks GET …/options and shows "Which one should I read?"
   with a small select; choosing posts …/select. Until then the status pill reads
   "Choose account" (cyan wash — a step, not a decision, so no amber). Demo mode never
   fetches, so the prototype's cards are untouched.

   Accounts mode also reads GET /api/connectors/state (the real rows): each card shows its
   first-read state — "Reading…" → "Read ✓ · N metrics" / the honest failure + Reconnect — and
   the OWNER gets "Connect with a token" (a quiet link under Connect when the OAuth app is
   configured; the only action when it isn't): an inline form with the platform's fields, a
   masked key input and "Test & connect" → POST …/manual, which tests the key with one read
   before sealing it and starts the 90-day read. */

type StartResponse = { url?: string; fallback?: boolean; reason?: string; error?: string };
type DisconnectResponse = { ok?: boolean; fallback?: boolean; error?: string };
type OptionsResponse = { externalRef?: string | null; options?: AccountOption[]; listed?: boolean; fallback?: boolean; error?: string };
type SelectResponse = { ok?: boolean; externalRef?: string; fallback?: boolean; error?: string };
type ManualResponse = { ok?: boolean; externalRef?: string | null; label?: string; reading?: boolean; error?: string; code?: string };
type Picker = { externalRef: string | null; options: AccountOption[]; note?: string };

/** The one line under a connected card, from the real row. */
export function readLine(c: ConnectorStateView): { text: string; tone: "cyan" | "muted" | "amber"; reconnect: boolean } | null {
  if (c.status !== "connected") return null;
  const recovery = connectorRecoveryMessage(c);
  if (recovery) return { text: recovery, tone: "amber", reconnect: false };
  if (c.lastSyncResult === null) return { text: "no completed data read yet.", tone: "muted", reconnect: false };
  if (c.lastSyncResult === "ok") return { text: c.lastReadMetrics === null ? "Read ✓" : c.lastReadMetrics === 0 ? "Read ✓ · answered" : MANUAL_COPY.readOk(c.lastReadMetrics), tone: "cyan", reconnect: false };
  if (c.lastSyncResult === "empty") return { text: MANUAL_COPY.readEmpty, tone: "muted", reconnect: false };
  if (c.lastSyncResult === "error:no_reader") return { text: MANUAL_COPY.sealedNoReader, tone: "muted", reconnect: false };
  if (c.lastSyncResult && c.lastSyncResult.startsWith("error:")) return { text: MANUAL_COPY.readFailed(c.lastSyncResult.slice("error:".length).replace(/_/g, " ")), tone: "amber", reconnect: false };
  return null;
}

export default function ConnectorsView({ V, initialLive = null, modern = false }: { V: PlatformVals; initialLive?: ConnectorsStateListing | null; modern?: boolean }) {
  // Seeded from the OAuth return (if any) on first render; cleared once shown so it doesn't replay.
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const r = peekConnectReturn();
    return r ? { [r.name]: r.kind === "connected" ? CONNECT_COPY.connected : CONNECT_COPY.failed } : {};
  });
  const [shopFor, setShopFor] = useState<string | null>(null);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pickers, setPickers] = useState<Record<string, Picker>>({});
  // In accounts mode the server's membership role is authoritative. Demo controls stay
  // interactive, while a member can inspect status but cannot connect, select or disconnect.
  const dbConfigured = isDbConfigured();
  const accountsMode = modern || dbConfigured || initialLive !== null;
  const live = useConnectorsState(modern || dbConfigured, initialLive);
  const liveBy: Record<string, ConnectorStateView> = Object.fromEntries((live.data?.connectors ?? []).map((c) => [c.name, c]));
  const owner = live.data?.role === "owner";
  const canManage = !accountsMode || owner;
  const canDisconnect = accountsMode && owner;
  // "Connect Google": one consent for GA4 + Ads + Search Console; the three cards then show status only.
  const googleOn = !!live.data?.google.configured;
  const googleChildren = new Set(live.data?.google.children ?? []);
  const googleCards = V.connectors.filter((c) => googleChildren.has(CONNECTOR_PLATFORMS[c.name] ?? ""));
  const cardSynced = (name: string, fallbackOk: boolean): boolean => {
    if (!live.active) return accountsMode ? false : fallbackOk;
    const row = liveBy[name];
    if (!row) return false;
    if (modern && (!row.externalRef || !row.lastSyncAt || connectorRecoveryMessage(row))) return false;
    return connectorHasRealSync(row.status, row.lastSyncResult);
  };
  const googleAllOk = googleCards.length > 0 && googleCards.every((c) => cardSynced(c.name, c.ok));
  const googleAnyExpired = googleCards.some((c) => modern ? liveBy[c.name]?.status === "needs_reconnect" : c.expired);

  // Accounts mode: the founder's own platforms (known_platforms) and what the scan spotted carry a quiet chip — the rest are just the library.
  const pickedSlugs = new Set(accountsMode ? knownPlatformSlugs(V.obNarrativeRequest.resources.platforms) : []);
  const spottedBy: Record<string, string> = accountsMode ? Object.fromEntries((V.obScan.profile?.platformsSpotted ?? []).map((s) => [s.platform, s.evidence])) : {};

  // token path (owner): which card's form is open + its field values
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [tokenVals, setTokenVals] = useState<Record<string, string>>({});
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  useEffect(() => clearConnectReturn(), []);
  // After an OAuth return the first read is already running server-side: watch it land.
  useEffect(() => {
    const r = peekConnectReturn();
    const platform = r && r.kind === "connected" ? (r.platform === "google" ? "ga4" : CONNECTOR_PLATFORMS[r.name]) : null;
    if (platform && accountsMode) live.watch(platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startGoogle() {
    setBusy(GOOGLE_UMBRELLA_NAME);
    try {
      const res = await fetch("/api/connectors/google/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = (await res.json().catch(() => ({}))) as StartResponse;
      if (res.status === 401) note(GOOGLE_UMBRELLA_NAME, CONNECT_COPY.signIn);
      else if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      } else if (res.ok && data.fallback) note(GOOGLE_UMBRELLA_NAME, CONNECT_COPY.notSwitchedOn);
      else note(GOOGLE_UMBRELLA_NAME, data.error ? `${CONNECT_COPY.failed} (${data.error})` : CONNECT_COPY.failed);
    } catch {
      note(GOOGLE_UMBRELLA_NAME, CONNECT_COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  const note = (name: string, text: string) => setNotes((n) => ({ ...n, [name]: text }));

  // Which Connected cards may still need an account chosen (accounts mode only).
  const pickerKey = accountsMode && owner
    ? V.connectors
        .filter((c) => (modern ? liveBy[c.name]?.status === "connected" && !liveBy[c.name]?.externalRef : c.ok) && (PICKER_PLATFORMS as string[]).includes(CONNECTOR_PLATFORMS[c.name] ?? ""))
        .map((c) => c.name)
        .join("|")
    : "";

  useEffect(() => {
    if (!pickerKey) return;
    let cancelled = false;
    for (const name of pickerKey.split("|")) {
      const platform = CONNECTOR_PLATFORMS[name];
      void (async () => {
        try {
          const res = await fetch(`/api/connectors/${platform}/options`);
          const data = (await res.json().catch(() => ({}))) as OptionsResponse;
          if (cancelled) return;
          if (res.ok && !data.fallback && data.externalRef !== undefined) {
            const options = data.options ?? [];
            setPickers((p) => ({ ...p, [name]: { externalRef: data.externalRef ?? null, options, note: data.externalRef || options.length ? undefined : CONNECT_COPY.chooseNone } }));
          } else if (res.status === 409) setPickers((p) => ({ ...p, [name]: { externalRef: null, options: [], note: CONNECT_COPY.chooseReconnect } }));
          else if (res.status === 502) setPickers((p) => ({ ...p, [name]: { externalRef: null, options: [], note: CONNECT_COPY.chooseFailed } }));
          // fallback / 401 / 403 / 404: nothing to pick — the card stays as it is
        } catch {
          /* network blip: the card stays Connected; the next visit asks again */
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [pickerKey]);

  async function select(name: string, externalRef: string) {
    const platform = CONNECTOR_PLATFORMS[name];
    if (!platform || !externalRef) return;
    setBusy(name);
    try {
      const res = await fetch(`/api/connectors/${platform}/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ externalRef }) });
      const data = (await res.json().catch(() => ({}))) as SelectResponse;
      if (res.status === 401) note(name, CONNECT_COPY.signIn);
      else if (res.ok && data.ok && data.externalRef) {
        setPickers((p) => ({ ...p, [name]: { externalRef: data.externalRef!, options: p[name]?.options ?? [] } }));
        note(name, CONNECT_COPY.chosen);
        live.watch(platform);
      } else if (res.ok && data.fallback) note(name, CONNECT_COPY.notSwitchedOn);
      else note(name, data.error ? `${CONNECT_COPY.chooseFailed} (${data.error})` : CONNECT_COPY.chooseFailed);
    } catch {
      note(name, CONNECT_COPY.chooseFailed);
    } finally {
      setBusy(null);
    }
  }

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
        live.refresh();
      } else if (res.ok && data.fallback) note(name, CONNECT_COPY.notSwitchedOn);
      else note(name, data.error ? `${CONNECT_COPY.disconnectFailed} (${data.error})` : CONNECT_COPY.disconnectFailed);
    } catch {
      note(name, CONNECT_COPY.disconnectFailed);
    } finally {
      setBusy(null);
    }
  }

  async function start(name: string, demoConnect: () => void, shopDomain?: string) {
    if (!accountsMode) {
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

  function openToken(name: string) {
    setTokenFor(name);
    setTokenVals({});
    setTokenErr(null);
    setShopFor(null);
  }

  async function connectWithToken(name: string, demoConnect: () => void) {
    const platform = CONNECTOR_PLATFORMS[name] as ManualPlatform | undefined;
    if (!platform || !MANUAL_FORMS[platform]) return;
    const body: Record<string, unknown> = { token: tokenVals.token ?? "" };
    if (tokenVals.external_ref) body.external_ref = tokenVals.external_ref;
    if (tokenVals.shop) body.extra = { shop: tokenVals.shop };
    setBusy(name);
    setTokenErr(null);
    note(name, MANUAL_COPY.testing);
    try {
      const res = await fetch(`/api/connectors/${platform}/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as ManualResponse;
      if (res.ok && data.ok) {
        demoConnect(); // immediate card feedback; the server API already owns persistence
        setTokenFor(null);
        setTokenVals({});
        note(name, MANUAL_COPY.connected);
        live.watch(platform);
      } else {
        setTokenErr(data.error ? `${data.error} ${MANUAL_COPY.notStored}` : `${CONNECT_COPY.failed}`);
        note(name, "");
      }
    } catch {
      setTokenErr(`${CONNECT_COPY.failed}`);
      note(name, "");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-buddy="Least privilege, always — I list every scope before you approve it. Each connection unlocks more of the library."
      className={modern ? connectionStyles.data : undefined}
      style={modern ? undefined : { maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}
    >
      {modern ? <div className={connectionStyles.summary}><span>{live.data ? `${live.data.connectors.filter(c => c.status === "connected" && !!c.externalRef && !!c.lastSyncAt && !connectorRecoveryMessage(c) && connectorHasRealSync(c.status,c.lastSyncResult)).length} platforms with a selected asset and dated read` : "Connection status not verified"} · not a freshness guarantee</span><button onClick={live.refresh}>Refresh status</button></div> : <><div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Connectors</h1>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{V.connSummary}</div>
      </div></>}
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
        {modern ? "Review each platform’s selected business asset, dated read and recovery state below. OAuth scopes and data coverage vary by provider; routine availability is checked separately." : "Exact, least-privilege connections to the systems that hold your source truth. Junction reads what each workflow needs — nothing more — and every credential lives in the secret store."}
      </div>
      {live.error && (
        <div data-testid="connectors-live-error" style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10, lineHeight: 1.5 }}>
          Couldn’t verify connector status ({live.error}). <button onClick={live.refresh} className="hov-underline" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}>try again</button>
        </div>
      )}
      {accountsMode && <ConnectionDataPanel state={live.data?.dataReadiness} />}
      <div className={modern ? connectionStyles.grid : undefined} style={modern ? undefined : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 26 }}>
        {googleOn && (
          <div data-testid="connector-google" style={{ gridColumn: "1 / -1", background: "white", border: `1px solid ${googleAllOk ? "var(--card-border)" : "oklch(0.78 0.13 220 / 0.6)"}`, borderRadius: 13, padding: "16px 19px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Google</span>
                <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>one sign-in</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{googleCards.map((c) => c.name).join(" · ")} — read-only, one consent screen; each keeps its own status below.</div>
              {notes[GOOGLE_UMBRELLA_NAME] && <div style={{ fontSize: 12, color: "var(--amber-text)", marginTop: 6, lineHeight: 1.45 }}>{notes[GOOGLE_UMBRELLA_NAME]}</div>}
            </div>
            {googleAllOk ? (
              <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--cyan-text)", fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)" }}></span>Connected
              </span>
            ) : !canManage ? (
              <span data-testid="connector-owner-only" style={{ flex: "none", fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                Owner managed
              </span>
            ) : googleAnyExpired ? (
              <button data-testid="google-reconnect" onClick={() => void startGoogle()} disabled={busy === GOOGLE_UMBRELLA_NAME} style={{ flex: "none", border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "7px 15px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Reconnect Google
              </button>
            ) : (
              <button data-testid="google-connect" onClick={() => void startGoogle()} disabled={busy === GOOGLE_UMBRELLA_NAME} className="btn-navy" style={{ flex: "none", padding: "7px 16px", fontSize: 12, fontWeight: 600 }}>
                Connect Google
              </button>
            )}
          </div>
        )}
        {V.connectors.map((original) => {
          const current = liveBy[original.name];
          const cn = modern ? { ...original, ok:current?.status === "connected", expired:current?.status === "needs_reconnect", off:current?.status === "disconnected" || current?.status === "error" } : original;
          const lc = liveBy[cn.name];
          const platform = CONNECTOR_PLATFORMS[cn.name] as ManualPlatform | undefined;
          const tokenPath = !!(live.active && owner && lc?.tokenPath && platform && MANUAL_FORMS[platform]);
          const oauthOn = !!lc?.oauthConfigured;
          const viaGoogle = googleOn && googleChildren.has(platform ?? "");
          const rl = live.active && lc ? readLine(lc) : null;
          const evidence = lc ? connectorEvidence(lc) : null;
          const form = tokenFor === cn.name && platform ? MANUAL_FORMS[platform] : null;
          return (
            <div key={cn.name} className={modern ? connectionStyles.card : undefined} data-testid={`connector-${platform ?? cn.name}`} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 19px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{cn.name}</span>
                  <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{cn.cat}</span>
                  {platform && pickedSlugs.has(platform) && (
                    <span data-testid="connector-picked" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "2px 7px" }}>
                      {SUGGESTION_COPY.picked}
                    </span>
                  )}
                  {platform && !pickedSlugs.has(platform) && spottedBy[platform] && (
                    <span data-testid="connector-spotted" title={spottedBy[platform]} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "2px 7px" }}>
                      {SUGGESTION_COPY.spotted}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {cn.note}{!accountsMode && <> · unlocks {cn.unlocks} routines</>}
                </div>
                {evidence && <div data-testid="connector-evidence" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, overflowWrap: "anywhere" }}>{evidence.identity}<br />{evidence.read}</div>}
                {accountsMode && !lc && <div role="status" style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>connection status is unverified.</div>}
                {modern && lc?.status === "connected" && !cardSynced(cn.name, cn.ok) && <p style={{fontSize:12,color:"var(--muted)"}}>Authorization saved · {lc.externalRef ? "data read not verified" : "choose the business asset before reading"}. Not shown as ready.</p>}
                {rl && (
                  <div data-testid="read-line" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 6, color: rl.tone === "cyan" ? "var(--cyan-text)" : rl.tone === "amber" ? "var(--amber-text)" : "var(--muted)", fontWeight: 500 }}>
                    <span>{rl.text}</span>
                    {rl.reconnect && canManage && (
                      <button onClick={() => (tokenPath && !oauthOn ? openToken(cn.name) : void start(cn.name, cn.connect))} disabled={busy === cn.name} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--amber-text)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        — {MANUAL_COPY.reconnect}
                      </button>
                    )}
                  </div>
                )}
                {canManage && shopFor === cn.name && (
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
                {owner && form && platform && (
                  <form
                    data-testid="token-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void connectWithToken(cn.name, cn.connect);
                    }}
                    style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}
                  >
                    <div style={{ fontSize: 12, color: "var(--cyan-text)", fontWeight: 500, lineHeight: 1.45 }}>{MANUAL_COPY.helper}</div>
                    {form.fields.map((f) => (
                      <label key={f.key} style={{ display: "block" }}>
                        <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>{f.label}</span>
                        <input
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          spellCheck={false}
                          value={tokenVals[f.key] ?? ""}
                          onChange={(e) => setTokenVals((v) => ({ ...v, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          aria-label={`${cn.name} — ${f.label}`}
                          style={{ display: "block", width: "100%", marginTop: 4, fontSize: 12, padding: "6px 9px", border: "1px solid var(--card-border-2)", borderRadius: 8, background: "oklch(0.985 0.003 90)", color: "var(--ink)", outline: "none" }}
                        />
                      </label>
                    ))}
                    <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}>{form.where}</div>
                    {tokenErr && (
                      <div data-testid="token-error" style={{ fontSize: 12, color: "var(--amber-text)", lineHeight: 1.45 }}>
                        {tokenErr}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                      <button type="submit" className="btn-navy" disabled={busy === cn.name || !(tokenVals.token ?? "").trim()} style={{ flex: "none", padding: "6px 14px", fontSize: 12, fontWeight: 600 }}>
                        {busy === cn.name ? MANUAL_COPY.testing : MANUAL_COPY.cta}
                      </button>
                      <button type="button" onClick={() => setTokenFor(null)} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>
                        {MANUAL_COPY.cancel}
                      </button>
                    </div>
                  </form>
                )}
                {owner && cn.ok && pickers[cn.name] && pickers[cn.name].externalRef === null && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan-text)", fontWeight: 500 }}>
                      <span>{CONNECT_COPY.choosePrompt}</span>
                      {pickers[cn.name].options.length > 0 && (
                        <select
                          defaultValue=""
                          disabled={busy === cn.name}
                          onChange={(e) => void select(cn.name, e.target.value)}
                          aria-label={`${cn.name} — ${CONNECT_COPY.choosePrompt}`}
                          style={{ flex: 1, minWidth: 0, maxWidth: 260, fontSize: 12, padding: "4px 8px", border: "1px solid var(--card-border)", borderRadius: 8, background: "white", color: "var(--ink)" }}
                        >
                          <option value="" disabled>
                            {CONNECT_COPY.choosePlaceholder}
                          </option>
                          {pickers[cn.name].options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    {pickers[cn.name].note && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>{pickers[cn.name].note}</div>}
                  </div>
                )}
                {notes[cn.name] && (
                  <div style={{ fontSize: 12, color: "var(--amber-text)", marginTop: 6, lineHeight: 1.45 }}>{notes[cn.name]}</div>
                )}
                {tokenPath && !cn.ok && tokenFor !== cn.name && oauthOn && (
                  <button data-testid="token-link" onClick={() => openToken(cn.name)} className="hov-underline" style={{ marginTop: 6, border: "none", background: "transparent", color: "var(--muted)", fontSize: 11.5, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                    {MANUAL_COPY.link}
                  </button>
                )}
              </div>
              {cardSynced(cn.name, cn.ok) && (
                <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--cyan-text)", fontWeight: 600 }}>
                  {pickers[cn.name] && pickers[cn.name].externalRef === null ? (
                    <span style={{ background: "var(--cyan-wash)", borderRadius: 999, padding: "4px 11px" }}>{CONNECT_COPY.chooseLabel}</span>
                  ) : (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)" }}></span>Connected
                    </>
                  )}
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
              {cn.expired && canManage && (
                <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                  <button
                    onClick={() => (viaGoogle ? void startGoogle() : tokenPath && !oauthOn ? openToken(cn.name) : void start(cn.name, cn.connect))}
                    disabled={busy === cn.name}
                    style={{ flex: "none", border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "7px 15px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Reconnect
                  </button>
                  {tokenPath && oauthOn && tokenFor !== cn.name && (
                    <button data-testid="token-link" onClick={() => openToken(cn.name)} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 11.5, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                      {MANUAL_COPY.link}
                    </button>
                  )}
                </span>
              )}
              {cn.expired && !canManage && (
                <span data-testid="connector-owner-only" style={{ flex: "none", fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                  Owner managed
                </span>
              )}
              {cn.off && viaGoogle && (
                <span data-testid="via-google" style={{ flex: "none", fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                  {canManage ? "via Connect Google ↑" : "Managed through Google"}
                </span>
              )}
              {cn.off &&
                !viaGoogle &&
                canManage &&
                lc?.status !== "connected" &&
                (tokenPath && !oauthOn ? (
                  <button data-testid="token-primary" onClick={() => openToken(cn.name)} disabled={busy === cn.name} className="hov-border-cyanlink" style={{ flex: "none", border: "1px solid var(--card-border-2)", background: "white", color: "var(--ink)", borderRadius: 999, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {MANUAL_COPY.link}
                  </button>
                ) : (
                  <button onClick={() => void start(cn.name, cn.connect)} disabled={busy === cn.name} className="btn-navy" style={{ flex: "none", padding: "7px 16px", fontSize: 12, fontWeight: 600 }}>
                    Connect
                  </button>
                ))}
              {cn.off && !viaGoogle && !canManage && (
                <span data-testid="connector-owner-only" style={{ flex: "none", fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
                  Owner managed
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
