"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./ops.module.css";

/** Persist only the request ID, never the business brief. After submission the
 * operator follows the original saved run, including after a lost response. */
export default function OpsDraftPreview({ accountId, generation }: { accountId: string; generation: number }) {
  const storageKey = `unc:ops-preview:${accountId}:${generation}:D05-W08`;
  const [ready, setReady] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [settled, setSettled] = useState(false);
  const [mode, setMode] = useState("visual_drop");
  const [business, setBusiness] = useState("");
  const [brief, setBrief] = useState("");
  const [source, setSource] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && !/^[0-9a-f-]{36}$/i.test(saved)) throw new Error("Invalid saved request");
      // Browser-only recovery hydration must finish before submission is enabled.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRequestId(saved); setReady(true);
    } catch { setMessage("Request recovery is unavailable in this browser. Preview is disabled."); }
  }, [storageKey]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || requestId || submitting.current) return;
    submitting.current = true;
    const id = crypto.randomUUID();
    try { sessionStorage.setItem(storageKey, id); }
    catch { setMessage("Couldn't save the recovery reference. No request was sent."); submitting.current = false; return; }
    setRequestId(id); setMessage("Preparing your draft. You can inspect this same run below.");
    try {
      const response = await fetch("/api/ops/draft-preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, contextGeneration: generation, requestId: id, routineId: "D05-W08",
          inputs: { newsletter_mode: mode, about_the_business: business.trim(), newsletter_brief: brief.trim(), newsletter_source_ref: source.trim() } }),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400, 401, 403, 409, 413, 415].includes(response.status)) setSettled(true);
        setMessage(response.status === 403 ? "This client needs an active operator draft-preview grant. No provider write was authorized."
          : response.status === 401 ? "Sign in with your operator account, then inspect the original request."
          : "Preview could not be completed. Inspect the original request before starting any new work.");
        return;
      }
      if (result.runId !== id || result.routineId !== "D05-W08" || result.mode !== "dry_run") throw new Error("Unexpected response");
      setSettled(["done", "failed", "cancelled"].includes(result.status));
      setMessage(`Saved run status: ${String(result.status).replaceAll("_", " ")}. Open the saved output to review the result.`);
    } catch { setMessage("The response could not be verified. Inspect the original run; it may still be processing."); }
  }
  return <section className={styles.card} aria-label="Newsletter draft preview">
    <h2>Preview a newsletter draft</h2>
    <p>Prepare copy and a build brief for this client. This saves work in Junction; it does not create a campaign or send an email. Separate operator preview access is required.</p>
    {requestId ? <p><a href={`#run/${accountId}/${requestId}`}>Open original draft run →</a><br /><code>{requestId}</code></p> :
      <form onSubmit={submit} className={styles.previewForm}>
        <label>Newsletter format<select value={mode} onChange={e => setMode(e.target.value)}><option value="visual_drop">Product / visual drop</option><option value="founder_letter">Founder letter</option></select></label>
        <label>Business context<textarea required maxLength={4000} rows={2} value={business} onChange={e => setBusiness(e.target.value)} /></label>
        <label>Approved brief<textarea required maxLength={4000} rows={7} value={brief} onChange={e => setBrief(e.target.value)} placeholder="Purpose, approved copy, product, links, assets and any unresolved decisions" /></label>
        <label>Brief reference<input required maxLength={1000} value={source} onChange={e => setSource(e.target.value)} placeholder="Source document or Slack thread reference" /></label>
        <button disabled={!ready || !brief.trim() || !business.trim() || !source.trim()} type="submit">Prepare draft for review</button>
      </form>}
    {message && <p role="status">{message}</p>}
    {settled && <button type="button" onClick={() => {
      try { sessionStorage.removeItem(storageKey); }
      catch { setMessage("Couldn't clear the previous reference. Open the saved run to continue."); return; }
      submitting.current = false; setRequestId(null); setSettled(false); setMessage("");
    }}>Start a separate draft request</button>}
  </section>;
}
