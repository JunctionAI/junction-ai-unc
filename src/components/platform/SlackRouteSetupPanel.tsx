"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentContext } from "@/lib/agents/client";
import { slackRoomId, slackRouteSetupRequest, slackRouteTransition, type SlackRouteTransitionRequest, type SlackRouteSetupView } from "@/lib/channels/slackRouteSetupClient";

export default function SlackRouteSetupPanel({ context }: { context: AgentContext }) {
  return <SlackRouteSetup key={`${context.accountId}:${context.contextGeneration}:${context.actorId}`} context={context} />;
}
function SlackRouteSetup({ context }: { context: AgentContext }) {
  const { accountId, contextGeneration, actorId } = context;
  const [view, setView] = useState<SlackRouteSetupView | null>(null);
  const [identityId, setIdentityId] = useState(""), [room, setRoom] = useState("");
  const [retire, setRetire] = useState<string | null>(null);
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(""), [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController | null>(null), locked = useRef(false);
  useEffect(() => {
    const c = new AbortController(); controller.current = c;
    const timer = setTimeout(() => c.abort(), 30000);
    slackRouteSetupRequest({ accountId, contextGeneration, actorId }, undefined, fetch, c.signal)
      .then(v => { if (controller.current === c && !c.signal.aborted) setView(v); })
      .catch(err => { if (controller.current === c) setMessage(err instanceof Error ? err.message : "Couldn’t verify Slack setup. Refresh to try again."); })
      .finally(() => { clearTimeout(timer); if (controller.current === c) setBusy(false); });
    return () => { controller.current = null; c.abort(); clearTimeout(timer); };
  }, [accountId, contextGeneration, actorId, refresh]);
  const selected = view?.identities.find(i => i.identityLinkId === identityId);
  async function stage() {
    const c = controller.current;
    if (busy || locked.current || !view || !selected?.credentialStored || !c || c.signal.aborted || !slackRoomId.safeParse(room).success) return;
    locked.current = true; setBusy(true); setMessage("");
    const timer = setTimeout(() => c.abort(), 30000);
    try {
      const next = await slackRouteSetupRequest({ accountId, contextGeneration, actorId: view.actorId }, {
        identityLinkId: selected.identityLinkId, identityLinkVersion: selected.identityLinkVersion,
        workspaceId: selected.workspaceId, conversationId: room,
      }, fetch, c.signal);
      if (controller.current === c && !c.signal.aborted) {
        setView(next); setRoom("");
        setMessage("Channel mapping saved as staged. No messages sent, no routines enabled, and no Hyperagent listener changed.");
      }
    } catch (err) {
      if (controller.current === c) { setView(null); setMessage(`${err instanceof Error ? err.message : "Save not confirmed."} Refresh to check the saved mapping before retrying.`); }
    } finally { clearTimeout(timer); if (controller.current === c) { locked.current = false; setBusy(false); } }
  }
  async function transition(change: SlackRouteTransitionRequest) {
    const c = controller.current;
    if (busy || locked.current || !view || !c || c.signal.aborted) return;
    locked.current = true; setBusy(true); setMessage("");
    const timer = setTimeout(() => c.abort(), 30000);
    try {
      const next = await slackRouteTransition({ accountId, contextGeneration, actorId: view.actorId }, change, fetch, c.signal);
      if (controller.current === c && !c.signal.aborted) {
        setView(next); setRetire(null);
        setMessage(change.action === "revoke" ? "Mapping retired; its history is preserved. A replacement needs fresh verification and cutover approval."
          : "Mapping paused. New requests cannot use it; already-sent messages cannot be recalled. No Hyperagent listener changed.");
      }
    } catch (err) {
      if (controller.current === c) { setView(null); setRetire(null); setMessage(`${err instanceof Error ? err.message : "Change not confirmed."} Refresh to check the saved state.`); }
    } finally { clearTimeout(timer); if (controller.current === c) { locked.current = false; setBusy(false); } }
  }
  return <section aria-label="Client Slack channel setup" style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: 18, padding: 20, maxWidth: 760 }}>
    <h3 style={{ marginTop: 0 }}>Client Slack channel</h3>
    <p>Reuse your existing Junction Slack connection for this client. Each channel has its own client mapping; your OAuth login stays where it is.</p>
    <p>Setup only: a staged mapping cannot run routines or send replies. A reviewed channel cutover and delivery test are still required.</p>
    {view && <>
      {view.paused && <p>This account’s automation is paused. You can prepare its mapping without unpausing it.</p>}
      {view.identities.length === 0 ? <p>No verified Junction Slack identity is available to this owner. An existing Hyperagent installation does not grant Junction access. Ask Junction to verify the installation and account membership first.</p> : <>
        <label style={{ display: "block", marginBottom: 12 }}>Existing Slack connection
          <select aria-label="Existing Slack connection" value={identityId} onChange={e => setIdentityId(e.target.value)} disabled={busy} style={{ display: "block", maxWidth: "100%", padding: 8 }}>
            <option value="">Choose a connection</option>
            {view.identities.map(i => <option key={i.identityLinkId} value={i.identityLinkId} disabled={!i.credentialStored}>{i.workspaceName} ({i.workspaceId}){i.credentialStored ? "" : " — credential unavailable"}</option>)}
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>Client Slack channel ID
          <input aria-label="Client Slack channel ID" value={room} onChange={e => setRoom(e.target.value.trim())} disabled={busy} placeholder="C… or G…" maxLength={64} style={{ display: "block", maxWidth: "100%", padding: 8, boxSizing: "border-box" }} />
        </label>
        <p>The Junction bot must already be in this non-shared channel. Saving checks the workspace, bot and channel with Slack; it does not join a channel.</p>
        <button className="btn-navy" disabled={busy || !selected?.credentialStored || !slackRoomId.safeParse(room).success} onClick={stage}>Verify and stage channel</button>
      </>}
      {view.routes.length > 0 && <div aria-label="Saved client channel mappings">
        <h4>Saved mappings</h4>
        {view.routes.map(r => <div key={r.routeId} style={{ overflowWrap: "anywhere", marginBottom: 12 }}>
          <p>
          {r.workspaceId} / {r.conversationId} — {r.state} · revision {r.revision}. {r.bindingCurrent ? "Account binding current." : "Account or connection changed; reconciliation required."}
          {" "}Resource last checked: {r.verifiedAt}. This is not a delivery receipt.
          </p>
          {r.state === "active" && <button disabled={busy} onClick={() => transition({ routeId: r.routeId, revision: r.revision, action: "pause" })}>Pause {r.conversationId}</button>}
          {r.state !== "revoked" && (retire === r.routeId ? <div>
            <p>Retire this mapping? It cannot be reactivated. History stays saved; a new mapping needs fresh verification. This does not remove any Slack bot.</p>
            <button disabled={busy} onClick={() => transition({ routeId: r.routeId, revision: r.revision, action: "revoke" })}>Confirm retire {r.conversationId}</button>
            <button disabled={busy} onClick={() => setRetire(null)}>Cancel retirement</button>
          </div> : <button disabled={busy} onClick={() => setRetire(r.routeId)}>Retire {r.conversationId}</button>)}
        </div>)}
        <p>Activation is handled by Junction after the exact channel cutover is approved and the previous responder is stopped. Pausing or retiring here does not change other apps in Slack.</p>
      </div>}
    </>}
    <button style={{ marginTop: 12, marginLeft: 8 }} disabled={busy} onClick={() => { setView(null); setIdentityId(""); setBusy(true); setMessage(""); setRefresh(n => n + 1); }}>Refresh Slack setup</button>
    <p role="status">{busy ? "Checking Slack setup…" : message}</p>
  </section>;
}
