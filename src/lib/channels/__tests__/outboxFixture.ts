/** Application fixture only; real RPC transactions/locks/roles use rollback SQL canaries. */
import type { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { Row } from "../../db/types";
import { rowToLink } from "../links";
import { inQuietHours, prefAllows, whatsappWindowOpen } from "../outbound";
import { appendOutbound } from "../thread";
import type { OutboundKind } from "../types";
import { isDeepStrictEqual } from "node:util";

export function installOutboxFixture(db: FakeSupabase) {
  const verify = (binding: Row, allowPaused: boolean) => db.rpcs.verify_channel_inbound_binding({ expected: binding,
    inbound_event: { channel: binding.channel, externalId: binding.externalId, scopeId: binding.scopeId }, allow_paused: allowPaused }) as Row;
  db.rpcs.enqueue_channel_outbound = args => {
    const op = args.operation as Row; const b = op.binding as Row;
    verify(b, op.allowPaused === true);
    const old = db.rows("outbound_messages").find(r => r.account_id === b.accountId && r.context_generation === b.contextGeneration &&
      r.captured_link_id === b.linkId && r.binding_version === b.bindingVersion && r.kind === op.kind && r.ref === op.ref);
    if (old) {
      if (!isDeepStrictEqual(old.binding, b) || !isDeepStrictEqual(old.payload, op.payload)
        || !isDeepStrictEqual(old.reply_context, op.replyContext ?? null)
        || old.append_thread !== op.appendThread || old.allow_template !== op.allowTemplate || old.allow_paused !== op.allowPaused) throw new Error("Operation content changed");
      return { ...old };
    }
    return { ...db.insertRow("outbound_messages", { account_id: b.accountId, context_generation: b.contextGeneration,
      captured_link_id: b.linkId, link_id: b.linkId, binding_version: b.bindingVersion, binding: b, kind: op.kind, ref: op.ref,
      channel: b.channel, body: (op.payload as Row).text, payload: op.payload, reply_context: op.replyContext ?? null, status: "queued", append_thread: op.appendThread,
      allow_template: op.allowTemplate, allow_paused: op.allowPaused, created_at: db.now() }) };
  };
  db.rpcs.claim_channel_outbound = args => {
    const row = db.rows("outbound_messages").find(r => r.id === args.outbound_id);
    if (!row?.binding) throw new Error("Captured outbound missing");
    let raw: Row;
    try { raw = verify(row.binding as Row, row.allow_paused === true); }
    catch {
      if (row.status === "queued") Object.assign(row, { status: "cancelled", error: "original_binding_unavailable", completed_at: db.now() });
      return { claimed: false, row: { ...row } };
    }
    const now = new Date(db.now());
    if (row.status === "sending" && new Date(String(row.send_started_at)).getTime() < now.getTime() - 120000)
      Object.assign(row, { status: "uncertain", error: "attempt_interrupted" });
    if (row.status !== "queued") return { claimed: false, row: { ...row } };
    if (new Date(String(row.created_at)).getTime() < now.getTime() - 48 * 3600000) {
      Object.assign(row, { status: "cancelled", error: "delivery_expired", completed_at: db.now() });
      return { claimed: false, row: { ...row } };
    }
    const link = rowToLink(raw);
    if (!prefAllows(link, row.kind as OutboundKind) || link.channel === "apple" && link.meta.human_support_requested && row.kind !== "system") {
      Object.assign(row, { status: "cancelled", error: "delivery_preference_disabled", completed_at: db.now() });
      return { claimed: false, row: { ...row } };
    }
    const profile = db.rows("account_profiles").find(p => p.account_id === row.account_id);
    if (!["reply", "link", "system"].includes(String(row.kind)) && inQuietHours(link.prefs.quiet_hours, now, (profile?.cadence as Row)?.timezone as string ?? "UTC"))
      return { claimed: false, row: { ...row } };
    const template = !whatsappWindowOpen(link, now);
    if (template && !row.allow_template) return { claimed: false, row: { ...row } };
    Object.assign(row, { status: "sending", attempt_id: args.send_attempt, send_started_at: db.now() });
    return { claimed: true, row: { ...row }, link: raw, template };
  };
  db.rpcs.finish_channel_outbound = args => {
    const row = db.rows("outbound_messages").find(r => r.id === args.outbound_id);
    if (!row || !args.send_attempt || row.attempt_id !== args.send_attempt) throw new Error("Original attempt required");
    if (row.status === "sent") {
      if (args.delivery_status !== "sent" || row.external_msg_id !== args.provider_id) throw new Error("Conflicting delivery evidence");
      return { ...row };
    }
    if (!["sending", "uncertain"].includes(String(row.status))) throw new Error("Cannot finalize");
    Object.assign(row, { status: args.delivery_status, external_msg_id: args.provider_id,
      error: args.delivery_status === "uncertain" ? "provider_outcome_unknown" : null, completed_at: args.delivery_status === "sent" ? db.now() : null });
    return { ...row };
  };
  db.rpcs.project_channel_outbound = async args => {
    const row = db.rows("outbound_messages").find(r => r.id === args.outbound_id);
    if (!row?.binding || row.status !== "sent" || !row.append_thread) return null;
    try { verify(row.binding as Row, row.allow_paused === true); } catch { row.projection_checked_at = db.now(); return null; }
    const ref = `${row.kind}:${row.ref}`;
    const old = db.rows("chat_messages").find(r => r.account_id === row.account_id && r.context_generation === row.context_generation && r.external_scope === "outbound" && r.external_msg_id === ref);
    if (old) { row.projected_at = db.now(); row.projection_checked_at = db.now(); return old.id; }
    const result = await appendOutbound(db, { accountId: String(row.account_id), contextGeneration: Number(row.context_generation),
      channel: row.channel as "sms", text: String(row.body), externalScope: "outbound", externalMsgId: ref,
      delivery: { status: "sent", outbound_id: row.id, provider_message_id: row.external_msg_id, ref: row.ref, kind: row.kind,
        ...(row.reply_context ? { live: (row.reply_context as Row).live, in_reply_to: (row.reply_context as Row).inReplyTo } : {}) }, now: new Date(db.now()) });
    row.projected_at = db.now(); row.projection_checked_at = db.now();
    return result.id;
  };
  db.rpcs.maintain_channel_outbound = async args => {
    const n = Number(args.batch_limit);
    const stamp = new Date(db.now()).getTime();
    let uncertain = 0, expired = 0, projected = 0;
    for (const r of db.rows("outbound_messages").filter(r => r.context_generation != null && r.status === "sending" && new Date(String(r.send_started_at)).getTime() < stamp - 120000).slice(0, n)) {
      Object.assign(r, { status: "uncertain", error: "attempt_interrupted" }); uncertain++;
    }
    for (const r of db.rows("outbound_messages").filter(r => r.context_generation != null && r.status === "queued" && new Date(String(r.created_at)).getTime() < stamp - 48 * 3600000).slice(0, n)) {
      Object.assign(r, { status: "cancelled", error: "delivery_expired", completed_at: db.now() }); expired++;
    }
    const candidates = db.rows("outbound_messages").filter(r => r.context_generation != null && r.status === "sent" && r.append_thread && !r.projected_at)
      .sort((a, b) => String(a.projection_checked_at ?? a.created_at).localeCompare(String(b.projection_checked_at ?? b.created_at))).slice(0, n);
    for (const r of candidates) if (await db.rpcs.project_channel_outbound({ outbound_id: r.id })) projected++;
    return { uncertain, expired, projected };
  };
}
