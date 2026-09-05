/* Inbound — process one durably claimed message with its original arrival binding.

     handleInbound(deps, captured)
       link code            → atomic captured control, welcome line on that channel
       unknown sender       → one honest line ("I don't know this number yet…"), nothing stored
       button / keyword     → resolve the approval → decideApproval (the SAME resume path the
                              app uses, decided_by = the linked founder) → receipt line in
                              Unc's voice; "Why" → the approval's reasoning
       text                 → append to the one thread (idempotent on the platform message id)
                              → the SAME pipeline as /api/unc/chat (respondAsUnc over the
                              account's persisted state + the whole cross-channel history)
                              → Unc's reply stored with the channel and sent back on it

   Every branch is idempotent on external_msg_id: a redelivered webhook does nothing twice.
   `respond` and `decide` are injectable so the tests script them; the defaults are the real
   pipeline and the real approvals handler. */

import { decideApproval, DecideError, type DecideInput, type DecideOutcome } from "../approvals/handlers";
import { randomUUID } from "node:crypto";
import { unwrap, type DbClient } from "../db/types";
import type { Store } from "../runtime/store/interface";
import { buildServerContext, respondAsUnc } from "../unc/respond";
import type { AccountsSource } from "@/worker/accounts";
import { linkFailedLine, NO_MODEL_LINE, SMS_NO_MODEL_LINE, receiptLine, resolveApproval, resolveFailureLine, unlinkedLine, whyLine } from "./approvals";
import { looksLikeLinkCode, welcomeLine } from "./links";
import { flushQueued, sendOnLink, type AdapterRegistry, type OutboundDeps } from "./outbound";
import { parseSmsKeyword } from "./adapters/twilio";
import { appendInbound, historyFor, type HistoryTurn } from "./thread";
import { parseApprovalButton, type ChannelLink, type InboundEvent } from "./types";
import { routeCommand } from "../commands/message";
import { applyInboundControl, assertInboundBinding, readCapturedInbound, type CapturedInbound } from "./binding";
import { contextMemoryDb } from "../db/contextGeneration";
import { RuntimeContextError } from "../runtime/contextFence";
import { messagingDisabled } from "./releaseGate";

export type Log = (event: string, fields: Record<string, unknown>) => void;

export type RespondFn = (input: { accountId: string; contextGeneration: number; db: DbClient; history: HistoryTurn[]; channel: InboundEvent["channel"]; guard: () => Promise<void> }) => Promise<{ ok: true; reply: string } | { ok: false; reason: string }>;
export type DecideFn = (input: DecideInput) => Promise<DecideOutcome>;

export const OWNER_DECISION_LINE = "Only the account owner can approve or hold this. The decision is still waiting in the app.";

export interface InboundDeps {
  /** Service-role client. */
  db: DbClient;
  store: Store;
  accounts: AccountsSource;
  adapters: AdapterRegistry;
  now: () => Date;
  log?: Log;
  respond?: RespondFn;
  decide?: DecideFn;
}

export type InboundOutcome =
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | { kind: "linked"; accountId: string; linkId: string }
  | { kind: "link_failed"; reason: "unknown" | "expired" | "channel_mismatch" }
  | { kind: "unlinked" }
  | { kind: "unsubscribed"; accountId: string }
  | { kind: "replied"; accountId: string; reply: string; live: boolean }
  | { kind: "decided"; accountId: string; approvalId: string; decision: "approved" | "held"; reply: string }
  | { kind: "why"; accountId: string; approvalId: string; reply: string }
  | { kind: "decision_failed"; accountId: string; reply: string };

const defaultRespond: RespondFn = async ({ accountId, db, history, channel, contextGeneration, guard }) => {
  await guard();
  db = contextMemoryDb(db, accountId, contextGeneration);
  const context = await buildServerContext(db, accountId);
  await guard();
  return respondAsUnc({ history, context, surface: "corner", account: { accountId, db }, voice: channel === "sms" ? "sms" : "default", guard });
};

async function seen(db: DbClient, event: InboundEvent, accountId: string, contextGeneration: number, linkId: string): Promise<boolean> {
  const row = await unwrap<{ id: string } | null>("chat_messages.select", db.from("chat_messages").select("id").eq("account_id", accountId)
    .eq("context_generation", contextGeneration).eq("external_scope", linkId).eq("channel", event.channel).eq("external_msg_id", event.externalMsgId).maybeSingle());
  return !!row;
}

/** Channel links name the app user who created them. Re-resolve that user's current role for
    every consequential decision; a stale, transferred or member-owned link never inherits the
    service role used by the webhook processor. */
async function linkedOwner(db: DbClient, link: Pick<ChannelLink, "accountId" | "userId">): Promise<boolean> {
  if (!link.userId) return false;
  try {
    const row = await unwrap<{ role: string } | null>("account_members.select", db.from("account_members").select("role").eq("account_id", link.accountId).eq("user_id", link.userId).maybeSingle());
    return row?.role === "owner";
  } catch {
    return false;
  }
}

/** A direct line to a sender we hold no account for — no ledger row can exist without one. */
async function sayToUnknown(deps: InboundDeps, event: InboundEvent, text: string): Promise<void> {
  if (messagingDisabled(process.env)) throw new RuntimeContextError("automation_paused", "External messaging is disabled.");
  const adapter = deps.adapters[event.channel];
  if (!adapter?.configured) return;
  // Slack needs a workspace token; an unknown Slack user in an installed workspace still has one on file via team meta — skip rather than guess.
  if (event.channel === "slack") return;
  const pseudo: ChannelLink = { id: "", accountId: "", bindingVersion: 0, linkCodeGeneration: null, userId: null, channel: event.channel, externalId: event.externalId, handle: null, displayName: null, verifiedAt: null, linkCode: null, linkCodeExpiresAt: null, prefs: { brief: false, approvals: false, drafts: false, quiet_hours: null }, meta: {}, lastInboundAt: deps.now().toISOString(), createdAt: "" };
  await adapter.send(event.externalId, { text }, { link: pseudo }).catch(() => undefined);
}

export async function handleInbound(deps: InboundDeps, input: CapturedInbound): Promise<InboundOutcome> {
  const captured = readCapturedInbound({ ...input });
  const event = captured.event;
  if (messagingDisabled(process.env)) throw new RuntimeContextError("automation_paused", "External messaging is disabled.");
  const log = deps.log ?? (() => {});
  const now = deps.now();
  const originalLink = await assertInboundBinding(deps.db, captured);
  if (!originalLink) {
    if (!event.lifecycle && event.text && looksLikeLinkCode(event.text)) {
      await sayToUnknown(deps, event, linkFailedLine("unknown"));
      return { kind: "link_failed", reason: "unknown" };
    }
    if (event.text) await sayToUnknown(deps, event, unlinkedLine());
    log("channels.unlinked_sender", { channel: event.channel });
    return { kind: "unlinked" };
  }
  // STOP, code consumption and human handoff are derived from the saved event and applied
  // atomically. A stale link cannot delete or transfer a newer connection.
  const control = await applyInboundControl(deps.db, captured);
  if (control.kind === "unsubscribed") return { kind: "unsubscribed", accountId: control.accountId };
  const { link, captured: processing } = control;
  const binding = processing.binding;
  if (binding.kind === "unlinked") throw new RuntimeContextError("context_unavailable", "Missing verified binding.");
  const { accountId, contextGeneration } = binding;
  const guard = async (allowPaused = false) => {
    if (messagingDisabled(process.env)) throw new RuntimeContextError("automation_paused", "External messaging is disabled.");
    await assertInboundBinding(deps.db, processing, { allowPaused });
  };
  const slackOrigin = event.channel === "slack" && event.conversationId && event.threadId
    ? { workspaceId: event.scopeId, conversationId: event.conversationId, threadId: event.threadId } : undefined;
  const outbound: OutboundDeps = { db: deps.db, adapters: deps.adapters, now: deps.now, log, guard: () => guard(control.kind === "linked" || control.kind === "handoff"),
    ...(slackOrigin ? { replyContext: { live: false, inReplyTo: event.externalMsgId, conversationId: slackOrigin.conversationId, threadId: slackOrigin.threadId } } : {}) };
  if (control.kind === "linked") {
    await guard(true);
    await sendOnLink(outbound, link, "link", { text: welcomeLine(event.channel) }, { contextGeneration, ref: `inbound:${captured.id}`, allowPaused: true, appendToThread: false });
    return { kind: "linked", accountId, linkId: link.id };
  }
  if (control.kind === "handoff") {
    await guard(true);
    const reply = "i’ve paused automated replies here. open Junction in the app for support. a human has not been assigned yet.";
    await sendOnLink(outbound, link, "system", { text: reply }, { contextGeneration, ref: `inbound:${captured.id}`, allowPaused: true });
    return { kind: "replied", accountId, reply, live: false };
  }
  if (event.channel === "apple" && link.meta.human_support_requested) return { kind: "ignored", reason: "human support requested; automation paused" };
  await guard();
  if (await seen(deps.db, event, accountId, contextGeneration, link.id)) return { kind: "duplicate" };
  await guard();
  const openedLink = link;
  // Only queued work with this same original account/generation/link revision can drain.
  await flushQueued(outbound, link, contextGeneration);
  await guard();

  // 3. a decision — a button, or a keyword ("YES 1a2b3c4d")
  const button = parseApprovalButton(event.action);
  const keyword = !button && event.text ? parseSmsKeyword(event.text) : null;
  if (button || keyword) {
    const verb = button ? button.verb : keyword!.verb;
    const resolved = await resolveApproval(deps.store, accountId, button ? { approvalId: button.approvalId } : { short: keyword!.short }, now, contextGeneration);
    await guard();
    // The founder's turn, as said — so the app thread shows the decision was taken here.
    const said = event.text ?? (resolved.ok ? `${verb === "why" ? "Why" : verb === "approve" ? "Approve" : "Hold"} — ${resolved.approval.title}` : `${verb}`);
    const turn = await appendInbound(deps.db, { accountId, contextGeneration, externalScope: link.id, channel: event.channel, text: said, externalMsgId: event.externalMsgId, now });
    if (!turn.created) return { kind: "duplicate" };
    let reply: string;
    let outcome: InboundOutcome;
    if (!resolved.ok) {
      reply = resolveFailureLine(resolved);
      outcome = { kind: "decision_failed", accountId, reply };
    } else if (verb === "why") {
      reply = whyLine(resolved.approval);
      outcome = { kind: "why", accountId, approvalId: resolved.approval.id, reply };
      try {
        await guard();
        await deps.store.appendTasteEvent({ id: randomUUID(), accountId, approvalId: resolved.approval.id, routineId: resolved.approval.routineId, action: "why_opened", context: { channel: event.channel }, createdAt: now.toISOString() });
      } catch (error) {
        if (error instanceof RuntimeContextError) throw error;
        /* the taste ledger is best-effort here; the decision path writes its own */
      }
    } else {
      const decision = verb === "approve" ? "approved" : "held";
      if (!(await linkedOwner(deps.db, link))) {
        reply = OWNER_DECISION_LINE;
        outcome = { kind: "decision_failed", accountId, reply };
        log("channels.decide_refused", { accountId, reason: "owner_only", userId: link.userId });
      } else {
        const decide: DecideFn = deps.decide ?? ((input) => decideApproval({ store: deps.store, accounts: deps.accounts, db: deps.db, now: deps.now }, input));
        try {
          await guard();
          const out = await decide({ accountId, approvalId: resolved.approval.id, decision, decidedBy: link.userId ?? undefined });
          await guard();
          reply = receiptLine(decision, out.approval, out.run);
          outcome = { kind: "decided", accountId, approvalId: resolved.approval.id, decision, reply };
        } catch (err) {
          if (err instanceof RuntimeContextError) throw err;
          reply = err instanceof DecideError ? (err.code === "already_decided" ? "That one's already been decided — the receipt is in the app." : err.code === "not_found" ? "I can't find that decision any more." : "That run can't be resumed from here — open it in the app.") : "Something went wrong taking that decision — it's still waiting in the app.";
          outcome = { kind: "decision_failed", accountId, reply };
          log("channels.decide_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    await guard();
    await deps.adapters[event.channel]?.ack?.(event, reply.slice(0, 200)).catch(() => undefined);
    await guard();
    const sent = await sendOnLink(outbound, openedLink, "reply", { text: reply }, { contextGeneration, ref: `inbound:${captured.id}`, appendToThread: true });
    await guard();
    if (sent.status === "uncertain") throw new Error("Channel delivery requires reconciliation; do not replay");
    return outcome;
  }

  // 4. a message → the same conversation, the same Unc
  if (!event.text) return { kind: "ignored", reason: "no text" };
  await guard();
  const turn = await appendInbound(deps.db, { accountId, contextGeneration, externalScope: link.id, channel: event.channel, text: event.text, externalMsgId: event.externalMsgId, meta: { ...(event.displayName ? { from: event.displayName } : {}), ...(slackOrigin ? { slack_origin: slackOrigin } : {}) }, now });
  if (!turn.created) return { kind: "duplicate" };
  if (link.slackRouteId && !slackOrigin) throw new Error("Routed Slack conversation origin missing");
  const history = await historyFor(deps.db, accountId, undefined, contextGeneration, link.slackRouteId ? slackOrigin : undefined);
  await guard();
  const respond = deps.respond ?? defaultRespond;
  let reply = event.channel === "sms" ? SMS_NO_MODEL_LINE : NO_MODEL_LINE;
  let live = false;
  try {
    const command = await routeCommand(deps.db, deps.store, { accountId, contextGeneration, userId: binding.userId, channel: event.channel, requestId: event.externalMsgId, linkId: link.id,
      channelBinding: { bindingVersion: link.bindingVersion, externalId: event.externalId, ...(event.scopeId ? { scopeId: event.scopeId } : {}),
        ...(slackOrigin ? { conversationId: slackOrigin.conversationId, threadId: slackOrigin.threadId } : {}) } }, event.text);
    await guard();
    const r = command ? { ok: true as const, reply: command.reply } : await respond({ accountId, contextGeneration, db: deps.db, history, channel: event.channel, guard });
    await guard();
    if (r.ok) {
      reply = r.reply;
      live = true;
    } else log("channels.respond_fallback", { accountId, reason: r.reason });
  } catch (err) {
    if (err instanceof RuntimeContextError) throw err;
    log("channels.respond_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
  }
  await guard();
  const sent = await sendOnLink(outbound, openedLink, "reply", { text: reply }, { contextGeneration, ref: `inbound:${captured.id}`, appendToThread: true,
    replyContext: { live, inReplyTo: event.externalMsgId } });
  await guard();
  if (sent.status === "uncertain") throw new Error("Channel delivery requires reconciliation; do not replay");
  return { kind: "replied", accountId, reply, live };
}
