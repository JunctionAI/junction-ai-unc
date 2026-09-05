/** Application fixtures only. Atomic source/identity/role checks have a real SQL canary. */
import { isDeepStrictEqual } from "node:util";
import type { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { Row } from "../../db/types";
export function installCommandDeliveryFixture(db: FakeSupabase) {
  db.rpcs.prepare_command_notification = async args => {
    const c = db.rows("routine_commands").find(c => c.id === args.command_id);
    if (!c?.channel_binding || c.notification_revision !== args.expected_revision ||
      !["waiting", "done", "blocked", "failed", "uncertain"].includes(String(c.status))) return null;
    const b = c.channel_binding as Row;
    const link = db.rpcs.verify_channel_inbound_binding({ expected: b,
      inbound_event: { channel: c.channel, externalId: b.externalId, scopeId: b.scopeId }, allow_paused: false });
    if (!db.rows("account_members").some(m => m.account_id === c.account_id && m.user_id === c.user_id && m.role === "owner")) return null;
    c.notification_checked_at = db.now();
    const operation = await db.rpcs.enqueue_channel_outbound({ operation: { binding: b, kind: "reply",
      ref: ["command", c.id, c.notification_revision].join(":"), payload: { text: String(c.reply) + " Request " + String(c.id).slice(0, 8) + "." },
      appendThread: true, allowTemplate: false, allowPaused: false, replyContext: null } });
    return { operation, link };
  };
  const claim = db.rpcs.claim_channel_outbound;
  db.rpcs.claim_channel_outbound = async args => {
    const result = await claim(args) as { claimed: boolean; row: Row; link?: Row };
    const r = db.rows("outbound_messages").find(o => o.id === args.outbound_id)!;
    if (!result.claimed || !String(r.ref).startsWith("command:")) return result;
    const c = db.rows("routine_commands").find(c => ["command", c.id, c.notification_revision].join(":") === r.ref &&
      c.account_id === r.account_id && c.context_generation === r.context_generation &&
      isDeepStrictEqual(c.channel_binding, r.binding) && ["waiting", "done", "blocked", "failed", "uncertain"].includes(String(c.status)) &&
      r.body === String(c.reply) + " Request " + String(c.id).slice(0, 8) + "." &&
      db.rows("account_members").some(m => m.account_id === c.account_id && m.user_id === c.user_id && m.role === "owner"));
    if (c) return result;
    Object.assign(r, { status: "cancelled", attempt_id: null, send_started_at: null, error: "command_result_superseded", completed_at: db.now() });
    return { ...result, claimed: false, row: { ...r } };
  };
}
