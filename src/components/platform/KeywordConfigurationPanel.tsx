"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentContext } from "@/lib/agents/client";
import { keywordConfigurationRequest, type KeywordConfigurationView, type KeywordMarket } from "@/lib/n8n/keywordConfigurationClient";
const names = { US: "United States", NZ: "New Zealand", AU: "Australia" };
export default function KeywordConfigurationPanel({ context, onSaved }: { context: AgentContext; onSaved: () => void }) {
  return <KeywordConfiguration key={`${context.accountId}:${context.contextGeneration}:${context.actorId}`} context={context} onSaved={onSaved} />;
}
function KeywordConfiguration({ context, onSaved }: { context: AgentContext; onSaved: () => void }) {
  const { accountId, contextGeneration, actorId } = context;
  const [data, setData] = useState<KeywordConfigurationView | null>(null);
  const [market, setMarket] = useState<KeywordMarket | "">("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const current = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); current.current = controller; locked.current = false;
    keywordConfigurationRequest({ accountId, contextGeneration, actorId }, undefined, fetch, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setMarket(result.market ?? ""); } })
      .catch(() => { if (!controller.signal.aborted) setMessage("Couldn’t verify keyword settings. Refresh to check the saved configuration."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [accountId, contextGeneration, actorId, refresh]);
  async function save() {
    if (locked.current || busy || !data || !market || data.enabled || data.hasDraft) return;
    const controller = current.current;
    if (!controller || controller.signal.aborted) return;
    locked.current = true; setBusy(true); setMessage("");
    try {
      const result = await keywordConfigurationRequest({ accountId, contextGeneration, actorId },
        { market, version: data.version, stateUpdatedAt: data.stateUpdatedAt }, fetch, controller.signal);
      if (!controller.signal.aborted) { setData(result); setMarket(result.market ?? ""); setMessage("Market saved. The routine is still off; no provider request was made."); onSaved(); }
    } catch {
      if (!controller.signal.aborted) { setData(null); setMessage("Save not confirmed. Refresh to check what is saved before making another change."); }
    } finally { if (!controller.signal.aborted) { locked.current = false; setBusy(false); } }
  }
  return <section aria-label="Keyword market setup" style={{ marginTop: 12, padding: 20, background: "white", border: "1px solid var(--card-border)", borderRadius: 14 }}>
    <h3 style={{ marginTop: 0 }}>Keyword market</h3>
    {data && <>
      <p>AVGAR · golf travel bag · English. Choose one search market per request. This setup does not publish or change your website.</p>
      <p>Saved market: {data.market ? names[data.market] : "Not configured"}. {data.released ? "This configuration is released for requests." : "Customer requests are not released for this configuration yet."}</p>
      <label>Search market <select aria-label="Search market" value={market} disabled={busy || data.enabled || data.hasDraft} onChange={e => setMarket(e.target.value as KeywordMarket | "")}>
        <option value="">Choose a market</option>
        {data.markets.map(m => <option key={m} value={m}>{names[m]}</option>)}
      </select></label>
      <button className="btn-navy" style={{ marginLeft: 12 }} disabled={busy || !market || data.enabled || data.hasDraft || data.market === market} onClick={save}>Save market</button>
      {(data.enabled || data.hasDraft) && <p>Turn this routine off and resolve any draft before changing the market.</p>}
      {!data.markets.length && <p>No verified market configuration is available yet.</p>}
    </>}
    <button disabled={busy} onClick={() => { setBusy(true); setData(null); setMessage(""); setRefresh(r => r + 1); }} style={{ marginLeft: 12 }}>Refresh settings</button>
    <p role="status">{busy ? "Checking saved settings…" : message}</p>
  </section>;
}
