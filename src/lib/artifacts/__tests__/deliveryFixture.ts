/** Application fixture, NOT transaction/security proof; see the real SQL canary. */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { Row } from "../../db/types";
const fail = (message: string, code = "40001"): never => { throw Object.assign(new Error(message), { code }); };

export function installArtifactFixture(db: FakeSupabase) {
  const authority = (args: Row, allowPaused = false) => {
    const a = db.rows("accounts").find(a => a.id === args.acct);
    if (!a || a.context_generation !== args.generation) fail("Context changed");
    if (a!.automation_paused && !allowPaused) fail("Automation paused", "55000");
    if (!db.rows("account_members").some(m => m.account_id === args.acct && m.user_id === args.actor && m.role === "owner")) fail("Owner required", "42501");
  };
  const source = (args: Row) => {
    const f = db.rows("artifacts").find(f => f.id === args.artifact_id && f.account_id === args.acct &&
      db.rows("routine_runs").some(r => r.id === f.run_id && r.account_id === f.account_id && r.context_generation === args.generation));
    if (!f) fail("Missing current artifact", "P0002");
    if (f!.revision !== args.expected_revision) fail("Artifact changed");
    return f!;
  };
  db.rpcs.decide_context_artifact = args => {
    authority(args);
    const f = source(args); const from = f.status;
    const status = ({ approve: "approved", hold: "held", edit: "edited", use: "used", why: f.status } as Row)[String(args.decision)];
    if (!status) fail("Invalid decision", "22023");
    if (args.decision !== "why") db.updateRows("artifacts", [f], { status, ...(args.decision === "edit" ? { edited_body: args.edited_body } : {}) });
    if (args.decision !== "use") db.insertRow("taste_events", { account_id: args.acct, routine_id: f.routine_id,
      action: args.decision === "why" ? "why_opened" : status, context: { artifactId: f.id, runId: f.run_id, contextGeneration: args.generation } });
    const receipt = db.insertRow("receipts", { account_id: args.acct, run_id: f.run_id, kind: "notification", description: "Artifact decision fixture",
      payload: { artifactDecision: true, artifactId: f.id, action: args.decision, fromStatus: from, toStatus: f.status } });
    return { artifact: { ...f }, receipt };
  };
  let lock = Promise.resolve();
  db.rpcs.prepare_artifact_delivery = args => {
    const work = lock.then(async () => {
      authority(args, true);
      let saved = db.rows("artifact_deliveries").find(d => d.account_id === args.acct && d.context_generation === args.generation &&
        d.user_id === args.actor && d.artifact_id === args.artifact_id && d.artifact_revision === args.expected_revision && d.channel === args.requested_channel);
      if (!saved) {
        authority(args); const f = source(args);
        if (f.status === "held") fail("Artifact held");
        const links = db.rows("channel_links").filter(l => l.account_id === args.acct && l.user_id === args.actor && l.channel === args.requested_channel && l.verified_at && l.external_id);
        if (!links.length) fail("No owner channel", "P0002");
        const id = randomUUID(); const ids: string[] = [];
        for (const l of links) {
          const binding = { version: 1, kind: "linked", accountId: args.acct, contextGeneration: args.generation, userId: args.actor,
            linkId: l.id, bindingVersion: l.binding_version, channel: l.channel, externalId: l.external_id,
            ...(l.channel === "slack" ? { scopeId: (l.meta as Row).team_id } : {}) };
          const o = await db.rpcs.enqueue_channel_outbound({ operation: { binding, kind: "draft_landed", ref: "artifact:" + id,
            payload: { text: args.message_text }, appendThread: true, allowPaused: false, allowTemplate: false, replyContext: null } }) as Row;
          ids.push(String(o.id));
        }
        saved = db.insertRow("artifact_deliveries", { id, account_id: args.acct, context_generation: args.generation, user_id: args.actor,
          artifact_id: args.artifact_id, artifact_revision: args.expected_revision, channel: args.requested_channel,
          payload: { text: args.message_text }, outbound_ids: ids });
      }
      return { id: saved.id, operations: db.rows("outbound_messages").filter(o => (saved!.outbound_ids as string[]).includes(String(o.id))).map(o => ({ ...o })) };
    });
    lock = work.then(() => undefined, () => undefined);
    return work;
  };
  const claim = db.rpcs.claim_channel_outbound;
  if (claim) db.rpcs.claim_channel_outbound = async args => {
    const result = await claim(args) as { claimed: boolean; row: Row };
    const o = db.rows("outbound_messages").find(o => o.id === args.outbound_id)!;
    if (!result.claimed || !String(o.ref).startsWith("artifact:")) return result;
    const d = db.rows("artifact_deliveries").find(d => "artifact:" + d.id === o.ref && (d.outbound_ids as string[]).includes(String(o.id)));
    const f = d && db.rows("artifacts").find(f => f.id === d.artifact_id && f.revision === d.artifact_revision && f.status !== "held");
    if (d && f && isDeepStrictEqual(d.payload, o.payload) && db.rows("account_members").some(m => m.account_id === d.account_id && m.user_id === d.user_id && m.role === "owner")) return result;
    Object.assign(o, { status: "cancelled", attempt_id: null, send_started_at: null, error: "artifact_source_unavailable" });
    return { ...result, claimed: false, row: { ...o } };
  };
}
