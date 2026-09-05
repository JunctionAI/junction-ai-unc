/* Shared fixtures for the channels tests: a seeded schema-checked fake, a ticking clock,
   recording fake adapters (nothing here reaches a network), and a verified link seeder. */

import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { rowToLink, welcomeLine } from "../links";
import type { AdapterRegistry } from "../outbound";
import type { Channel, ChannelAdapter, ChannelLink, ChannelPrefs, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";
import { installInboxFixture } from "./inboxFixture";
import { acceptInboundEvent } from "../acceptedInbox";
import { applyInboundControl, type CapturedInbound } from "../binding";
import { handleInbound, type InboundDeps, type InboundOutcome } from "../inbound";

export const ACCT = "00000000-0000-4000-8000-00000000acc1";
export const OTHER = "00000000-0000-4000-8000-00000000acc2";
export const USER = "00000000-0000-4000-8000-00000000u5e1";
export const T0 = "2026-09-02T09:00:00.000Z";

export function channelDb(): FakeSupabase {
  const db = new FakeSupabase();
  db.now = () => T0;
  installInboxFixture(db);
  db.seed("accounts", [
    { id: ACCT, name: "Example Co", context_generation: 0, automation_paused: false },
    { id: OTHER, name: "Someone Else", context_generation: 0, automation_paused: false },
  ]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  return db;
}

/** Old receiver fixtures still express provider events; run them through the NEW captured
 * contract before calling the real handler. Production has no raw-event processing path. */
export async function handleTestInbound(deps: InboundDeps, event: InboundEvent | CapturedInbound): Promise<InboundOutcome> {
  if ("binding" in event) return handleInbound(deps, event);
  if (deps.db instanceof FakeSupabase) deps.db.now = () => deps.now().toISOString();
  const captured = await acceptInboundEvent(deps.db, event);
  const row = await deps.db.from("channel_inbox").select("status").eq("id", captured.id).single();
  if ((row.data as { status: string }).status !== "queued") return { kind: "duplicate" };
  await deps.db.from("channel_inbox").update({ status: "running" }).eq("id", captured.id).eq("status", "queued");
  const result = await handleInbound(deps, captured);
  await deps.db.from("channel_inbox").update({ status: "done" }).eq("id", captured.id).eq("status", "running");
  return result;
}

let codeEvent = 0;
export async function consumeCodeForTest(db: FakeSupabase, input: { code: string; channel: Channel; externalId: string; handle?: string; displayName?: string; now: Date }) {
  db.now = () => input.now.toISOString();
  const captured = await acceptInboundEvent(db, { channel: input.channel, externalId: input.externalId, externalMsgId: `code-fixture-${++codeEvent}`, text: input.code, handle: input.handle, displayName: input.displayName });
  if (captured.binding.kind !== "link_code") return { ok: false as const, reason: "unknown" };
  await db.from("channel_inbox").update({ status: "running" }).eq("id", captured.id);
  const result = await applyInboundControl(db, captured);
  if (result.kind !== "linked") throw new Error("Expected a captured code handshake");
  await db.from("channel_inbox").update({ status: "done" }).eq("id", captured.id);
  return { ok: true as const, link: result.link, welcome: welcomeLine(input.channel) };
}

/** A clock that ticks 1 s per now() so created_at ordering is deterministic. */
export function clock(start = T0) {
  let t = new Date(start).getTime();
  return {
    now: () => new Date((t += 1000)),
    at: () => new Date(t),
    set: (iso: string) => {
      t = new Date(iso).getTime();
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export class FakeAdapter implements ChannelAdapter {
  readonly sent: { to: string; payload: OutboundPayload; opts: SendOptions }[] = [];
  readonly acks: { event: InboundEvent; text?: string }[] = [];
  fail = false;
  private n = 0;
  constructor(
    readonly channel: Channel,
    readonly configured = true,
  ) {}
  async send(to: string, payload: OutboundPayload, opts: SendOptions): Promise<SendResult> {
    this.sent.push({ to, payload, opts });
    if (this.fail) return { ok: false, error: `${this.channel} down` };
    return { ok: true, externalMsgId: `${this.channel}-out-${++this.n}` };
  }
  async ack(event: InboundEvent, text?: string) {
    this.acks.push({ event, text });
  }
}

export function fakeAdapters(over: Partial<Record<Channel, FakeAdapter>> = {}): AdapterRegistry & Record<"telegram" | "whatsapp" | "slack" | "sms", FakeAdapter> {
  return {
    telegram: over.telegram ?? new FakeAdapter("telegram"),
    whatsapp: over.whatsapp ?? new FakeAdapter("whatsapp"),
    slack: over.slack ?? new FakeAdapter("slack"),
    sms: over.sms ?? new FakeAdapter("sms"),
  };
}

export const PREFS_ON: ChannelPrefs = { brief: true, approvals: true, drafts: true, quiet_hours: null };

/** Seed a verified link row straight into the fake. */
export function seedLink(db: FakeSupabase, over: Partial<{ id: string; account_id: string; user_id: string | null; channel: Channel; slack_route_id: string | null; external_id: string; handle: string | null; display_name: string | null; verified_at: string | null; prefs: ChannelPrefs; meta: Record<string, unknown>; last_inbound_at: string | null; created_at: string }> = {}): ChannelLink {
  const row = {
    account_id: ACCT,
    user_id: USER,
    channel: "telegram" as Channel,
    external_id: "tg-chat-1",
    handle: "tom",
    display_name: "Tom",
    verified_at: T0,
    prefs: PREFS_ON,
    meta: {},
    last_inbound_at: T0,
    created_at: T0,
    ...over,
  };
  return rowToLink(db.insertRow("channel_links", row));
}
