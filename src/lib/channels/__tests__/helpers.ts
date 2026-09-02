/* Shared fixtures for the channels tests: a seeded schema-checked fake, a ticking clock,
   recording fake adapters (nothing here reaches a network), and a verified link seeder. */

import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { rowToLink } from "../links";
import type { AdapterRegistry } from "../outbound";
import type { Channel, ChannelAdapter, ChannelLink, ChannelPrefs, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const ACCT = "00000000-0000-4000-8000-00000000acc1";
export const OTHER = "00000000-0000-4000-8000-00000000acc2";
export const USER = "00000000-0000-4000-8000-00000000u5e1";
export const T0 = "2026-09-02T09:00:00.000Z";

export function channelDb(): FakeSupabase {
  const db = new FakeSupabase();
  db.seed("accounts", [
    { id: ACCT, name: "Example Co" },
    { id: OTHER, name: "Someone Else" },
  ]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  return db;
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
export function seedLink(db: FakeSupabase, over: Partial<{ id: string; account_id: string; user_id: string | null; channel: Channel; external_id: string; handle: string | null; display_name: string | null; verified_at: string | null; prefs: ChannelPrefs; meta: Record<string, unknown>; last_inbound_at: string | null; created_at: string }> = {}): ChannelLink {
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
