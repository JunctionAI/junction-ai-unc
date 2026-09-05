"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { AgentContext } from "@/lib/agents/client";
import { calendarPreferencesRequest, calendarTimezone, type CalendarPreferencesView } from "@/lib/n8n/calendarPreferencesClient";

export default function CalendarPreferencesPanel({ context }: { context: AgentContext }) {
  return <CalendarPreferences key={`${context.accountId}:${context.contextGeneration}:${context.actorId}`} context={context} />;
}
function CalendarPreferences({ context }: { context: AgentContext }) {
  const { accountId, contextGeneration, actorId } = context;
  const [saved, setSaved] = useState<CalendarPreferencesView | null>(null);
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(true), [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController | null>(null), locked = useRef(false);
  const listId = useId();
  useEffect(() => {
    const c = new AbortController(); controller.current = c; locked.current = false;
    const timer = setTimeout(() => c.abort(), 20000);
    calendarPreferencesRequest({ accountId, contextGeneration, actorId }, undefined, fetch, c.signal)
      .then(v => { if (!c.signal.aborted) { setSaved(v); setTimezone(v.timezone ?? ""); } })
      .catch(() => { if (controller.current === c) setMessage("Couldn’t verify calendar settings. Refresh to try again."); })
      .finally(() => { clearTimeout(timer); if (controller.current === c) setBusy(false); });
    return () => { controller.current = null; c.abort(); clearTimeout(timer); };
  }, [accountId, contextGeneration, actorId, refresh]);
  async function save() {
    const c = controller.current;
    if (locked.current || busy || !saved?.canEdit || !c || c.signal.aborted || !calendarTimezone.safeParse(timezone).success) return;
    locked.current = true; setBusy(true); setMessage("");
    const timer = setTimeout(() => c.abort(), 20000);
    try {
      const v = await calendarPreferencesRequest({ accountId, contextGeneration, actorId }, { timezone, expectedUpdatedAt: saved.updatedAt }, fetch, c.signal);
      if (controller.current === c && !c.signal.aborted) { setSaved(v); setTimezone(v.timezone ?? ""); setMessage("Calendar timezone saved. No routine was enabled and nothing was scheduled or sent."); }
    } catch { if (controller.current === c) { setSaved(null); setMessage("Save not confirmed. Refresh to read the saved choice before making another change."); } }
    finally { clearTimeout(timer); if (controller.current === c) { locked.current = false; setBusy(false); } }
  }
  return <section aria-label="Calendar timezone setup" style={{ marginTop: 12, padding: 20, background: "white", border: "1px solid var(--card-border)", borderRadius: 14 }}>
    <h3 style={{ marginTop: 0 }}>Calendar timezone</h3>
    <p>Choose which timezone defines the weeks in your draft calendar. This does not change Klaviyo’s reporting timezone or schedule any messages.</p>
    {saved && <>
      <p>Saved timezone: {saved.timezone ?? "Not chosen"}. {saved.bound ? "A reviewed calendar workflow uses this choice." : "Calendar workflow binding is not complete yet."}</p>
      <label>Timezone <input aria-label="Calendar timezone" list={listId} value={timezone} disabled={busy || !saved.canEdit} onChange={e => setTimezone(e.target.value)} placeholder="Pacific/Auckland" /></label>
      <datalist id={listId}>{["Pacific/Auckland", "Australia/Sydney", "America/New_York", "UTC"].map(t => <option key={t} value={t} />)}</datalist>
      <button className="btn-navy" style={{ marginLeft: 12 }} onClick={save} disabled={busy || !saved.canEdit || timezone === saved.timezone || !calendarTimezone.safeParse(timezone).success}>Save timezone</button>
      {!saved.canEdit && <p>Settings are locked while a reviewed binding or outstanding calendar work exists. Ask Junction to reconcile that setup before changing the timezone.</p>}
    </>}
    <button disabled={busy} style={{ marginLeft: 12 }} onClick={() => { setSaved(null); setBusy(true); setMessage(""); setRefresh(n => n + 1); }}>Refresh settings</button>
    <p role="status">{busy ? "Checking calendar settings…" : message}</p>
  </section>;
}
