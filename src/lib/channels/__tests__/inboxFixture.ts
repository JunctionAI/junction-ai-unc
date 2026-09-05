/** Application-contract fixtures only. Transactions, locks, triggers and grants are proven
 * by the separate rollback SQL canaries, not by this JavaScript substitute. */
import type { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { Row } from "../../db/types";
import { looksLikeLinkCode, normaliseLinkCode } from "../links";
import { installOutboxFixture } from "./outboxFixture";

export function installInboxFixture(db: FakeSupabase) {
  installOutboxFixture(db);
  db.rpcs.verify_channel_inbound_binding = args => {
    const b = args.expected as Row;
    const event = args.inbound_event as Row;
    const link = db.rows("channel_links").find(l => l.id === b.linkId);
    const account = db.rows("accounts").find(a => a.id === b.accountId);
    if (b.version !== 1 || !link || !account || link.account_id !== b.accountId || link.user_id !== b.userId ||
      link.binding_version !== b.bindingVersion || account.context_generation !== b.contextGeneration || link.channel !== event.channel ||
      !db.rows("account_members").some(m => m.account_id === b.accountId && m.user_id === b.userId) ||
      (event.accountScope != null && event.accountScope !== b.accountId) ||
      (event.channel === "slack" && (!event.scopeId || (link.meta as Row)?.team_id !== event.scopeId)) ||
      !(b.kind === "linked" ? !!link.verified_at && link.external_id === event.externalId :
        b.kind === "link_code" && !link.verified_at && !!link.link_code && link.link_code_generation === b.contextGeneration &&
          !!link.link_code_expires_at && String(link.link_code_expires_at) > db.now()))
      throw Object.assign(new Error("Original channel context changed"), { code: "40001" });
    if (account.automation_paused && args.allow_paused !== true)
      throw Object.assign(new Error("automation_paused"), { code: "P0001" });
    return { ...link };
  };
  db.rpcs.accept_channel_inbound = args => {
    const event = args.inbound_event as Row;
    const prior = db.rows("channel_inbox").find(r => r.id === args.inbox_id);
    if (prior) {
      if (JSON.stringify(prior.event) !== JSON.stringify(event)) throw new Error("Provider event identity reused");
      return { ...prior };
    }
    const isCode = !event.lifecycle && looksLikeLinkCode(event.text as string);
    const link = db.rows("channel_links").find(l => isCode ? l.link_code === normaliseLinkCode(event.text as string)
      : l.channel === event.channel && l.external_id === event.externalId && !!l.verified_at);
    const account = link && db.rows("accounts").find(a => a.id === link.account_id);
    let binding: Row = { version: 1, kind: "unlinked" };
    if (link && account && link.channel === event.channel &&
      (!event.accountScope || event.accountScope === link.account_id) &&
      (event.channel !== "slack" || !!event.scopeId && (link.meta as Row)?.team_id === event.scopeId) &&
      db.rows("account_members").some(m => m.account_id === link.account_id && m.user_id === link.user_id) &&
      (!isCode || (!link.verified_at && link.link_code_generation === account.context_generation && String(link.link_code_expires_at) > db.now())))
      binding = { version: 1, kind: isCode ? "link_code" : "linked", accountId: link.account_id, contextGeneration: account.context_generation,
        linkId: link.id, bindingVersion: link.binding_version, userId: link.user_id };
    return { ...db.insertRow("channel_inbox", { id: args.inbox_id, channel: event.channel, event: { ...event }, binding, status: "queued" }) };
  };
  db.rpcs.claim_channel_inbound = () => {
    for (const row of db.rows("channel_inbox")) {
      if (row.status === "queued" && row.binding == null || row.status === "running" && new Date(String(row.updated_at)).getTime() < new Date(db.now()).getTime() - 600_000)
        Object.assign(row, { status: "uncertain", updated_at: db.now() });
    }
    const row = db.rows("channel_inbox").filter(r => r.status === "queued" && r.binding != null).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!row) return null;
    Object.assign(row, { status: "running", updated_at: db.now() });
    return { ...row };
  };
  db.rpcs.apply_channel_inbound_control = args => {
    const row = db.rows("channel_inbox").find(r => r.id === args.inbox_id);
    if (!row || row.status !== "running") throw new Error("Claimed message required");
    if (row.control_result) return row.control_result;
    const binding = row.binding as Row;
    const event = row.event as Row;
    const link = db.rows("channel_links").find(l => l.id === binding.linkId);
    const account = db.rows("accounts").find(a => a.id === binding.accountId);
    if (!link || !account || account.context_generation !== binding.contextGeneration || link.binding_version !== binding.bindingVersion || link.account_id !== binding.accountId || link.user_id !== binding.userId ||
      !db.rows("account_members").some(m => m.account_id === link.account_id && m.user_id === link.user_id)) throw new Error("Original connection changed");
    let kind: string;
    if (binding.kind === "link_code") {
      if (link.verified_at || !link.link_code || link.link_code_generation !== binding.contextGeneration || String(link.link_code_expires_at) <= db.now()) throw new Error("Original code invalid");
      db.deleteRows("channel_links", db.rows("channel_links").filter(l => l.id !== link.id && l.channel === event.channel && l.external_id === event.externalId));
      Object.assign(link, { external_id: event.externalId, verified_at: db.now(), last_inbound_at: db.now(), link_code: null, link_code_generation: null,
        link_code_expires_at: null, handle: event.handle ?? null, display_name: event.displayName ?? null, binding_version: Number(link.binding_version) + 1 });
      kind = "linked";
    } else {
      const source = String(event.text ?? "").trim().toLowerCase();
      if ((event.channel === "apple" && event.lifecycle === "conversation_closed") || ["sms", "apple"].includes(String(event.channel)) && ["stop", "unsubscribe", "cancel", "end", "quit"].includes(source)) {
        db.deleteRows("channel_links", [link]);
        return row.control_result = { kind: "unsubscribed", accountId: binding.accountId, contextGeneration: binding.contextGeneration };
      }
      if (event.channel === "apple" && ["help", "human", "support", "talk to a human"].includes(source)) {
        Object.assign(link, { meta: { ...link.meta as Row, human_support_requested: true }, binding_version: Number(link.binding_version) + 1 });
        kind = "handoff";
      } else { link.last_inbound_at = db.now(); kind = "opened"; }
    }
    return row.control_result = { kind, link: { ...link }, contextGeneration: binding.contextGeneration };
  };
}
