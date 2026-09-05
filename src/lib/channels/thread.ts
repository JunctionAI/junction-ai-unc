/* One thread. Every turn — said in the app, on Telegram, on WhatsApp, on Slack, by text —
   is a chat_messages row on thread 'corner' with `channel` naming where it was said.

     appendInbound     the founder's message from a channel  (sender 'user')
     appendOutbound    Unc's reply / push on a channel        (sender 'unc')
     listThread        the unified view, oldest first, optionally since a timestamp —
                       what GET /api/channels/thread returns and the corner UI renders with a
                       "via Telegram" chip on non-app rows
     historyFor        the last N turns as model messages (all channels) — what replyViaUnc
                       feeds the same pipeline the app uses

   The app's own turns are persisted by the client autosave (src/lib/db/accountState.ts →
   chat_messages, channel 'app', positions 0..n). Channel rows must never collide with those
   positions, so they take a position in a far band (seconds since 2026-01-01 + 1e8) with a
   retry on the unique key — ordering for readers is created_at, never position. The client
   hydrates only channel='app' rows (loadAccountRows), so it never re-saves a channel row.

   Idempotent on (account, generation, channel, original link scope, external_msg_id).

   Relative imports only (worker-buildable). */

import { unwrap, type DbClient, type DbError, type Row } from "../db/types";
import type { MessageChannel } from "./types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { runtimeGeneration, RuntimeContextError } from "../runtime/contextFence";

export const THREAD = "corner";
export const HISTORY_TURNS = 24;
export const MAX_TURN_CHARS = 4000;

const POSITION_EPOCH = Date.UTC(2026, 0, 1);
export const POSITION_BAND = 100_000_000;
const POSITION_RETRIES = 25;

const COLS = "id, account_id, thread, position, lane, sender, body, meta, channel, external_msg_id, delivery, created_at";

export interface UnifiedMessage {
  id: string;
  at: string;
  sender: "user" | "unc" | "staff";
  body: string;
  channel: MessageChannel;
  externalMsgId: string | null;
  /** Absolute app index for merging a bounded remote snapshot with local app history. */
  appPosition?: number;
  meta: Record<string, unknown>;
  delivery: Record<string, unknown>;
}

export function rowToUnified(r: Row): UnifiedMessage {
  return {
    id: String(r.id),
    at: String(r.created_at ?? ""),
    sender: (r.sender as UnifiedMessage["sender"]) ?? "unc",
    body: String(r.body ?? ""),
    channel: (typeof r.channel === "string" ? r.channel : "app") as MessageChannel,
    externalMsgId: r.external_msg_id ? String(r.external_msg_id) : null,
    ...((r.channel ?? "app") === "app" ? { appPosition: Number(r.position) } : {}),
    meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : {},
    delivery: r.delivery && typeof r.delivery === "object" ? (r.delivery as Record<string, unknown>) : {},
  };
}

/** A position far above anything the client writes; unique per second, retried on a clash. */
export function positionFor(now: Date, attempt = 0): number {
  return POSITION_BAND + Math.max(0, Math.floor((now.getTime() - POSITION_EPOCH) / 1000)) + attempt;
}

export interface AppendInput {
  accountId: string;
  /** Captured before any model/provider wait. Missing is legacy generation zero only. */
  contextGeneration?: number;
  /** Original link's stable ID; separates provider message IDs across senders/workspaces. */
  externalScope?: string;
  channel: MessageChannel;
  sender: "user" | "unc";
  text: string;
  externalMsgId?: string | null;
  delivery?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  now: Date;
}

export interface AppendResult {
  id: string;
  /** false = a row with this external_msg_id already existed (redelivery); nothing written. */
  created: boolean;
}

const isUnique = (e: DbError | null | undefined) => !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message));

export async function appendMessage(db: DbClient, input: AppendInput): Promise<AppendResult> {
  const generation = runtimeGeneration(input.contextGeneration);
  const identity = { accountId: input.accountId, contextGeneration: generation };
  const scope = input.externalScope ?? "";
  await assertRuntimeContext(db, identity, { allowPaused: true });
  const text = input.text.replace(/\s+$/, "").slice(0, MAX_TURN_CHARS);
  const findDuplicate = () => db.from("chat_messages").select("id").eq("account_id", input.accountId)
    .eq("context_generation", generation).eq("channel", input.channel).eq("external_scope", scope).eq("external_msg_id", input.externalMsgId);
  if (input.externalMsgId) {
    const dup = await unwrap<{ id: string } | null>("chat_messages.select", findDuplicate().maybeSingle());
    await assertRuntimeContext(db, identity, { allowPaused: true });
    if (dup) return { id: dup.id, created: false };
  }
  let lastError: DbError | null = null;
  for (let attempt = 0; attempt < POSITION_RETRIES; attempt++) {
    const { data, error } = await db
      .from("chat_messages")
      .insert({
        account_id: input.accountId,
        context_generation: generation,
        external_scope: scope,
        thread: THREAD,
        position: positionFor(input.now, attempt),
        lane: "ai",
        sender: input.sender,
        body: text,
        meta: input.meta ?? {},
        channel: input.channel,
        external_msg_id: input.externalMsgId ?? null,
        delivery: input.delivery ?? {},
        created_at: input.now.toISOString(),
      })
      .select("id")
      .single();
    if (!error) {
      await assertRuntimeContext(db, identity, { allowPaused: true });
      return { id: String((data as { id: string }).id), created: true };
    }
    if (error.code === "40001") throw new RuntimeContextError("context_changed", "The chat's business context changed.");
    if (!isUnique(error)) throw new Error(`chat_messages.insert: ${error.message}`);
    // a clash on external_msg_id is a concurrent redelivery, not a position clash
    if (input.externalMsgId) {
      const dup = await unwrap<{ id: string } | null>("chat_messages.select", findDuplicate().maybeSingle());
      await assertRuntimeContext(db, identity, { allowPaused: true });
      if (dup) return { id: dup.id, created: false };
    }
    lastError = error;
  }
  throw new Error(`chat_messages.insert: could not allocate a position (${lastError?.message ?? "unique clash"})`);
}

export const appendInbound = (db: DbClient, input: Omit<AppendInput, "sender">) => appendMessage(db, { ...input, sender: "user" });
export const appendOutbound = (db: DbClient, input: Omit<AppendInput, "sender">) => appendMessage(db, { ...input, sender: "unc" });

export interface ListThreadOptions {
  contextGeneration?: number;
  /** UI snapshots may include one older app anchor in addition to the bounded tail. */
  includeAppAnchor?: boolean;
  /** ISO; only rows created at/after it. */
  since?: string | null;
  limit?: number;
}

const byTime = (a: Row, b: Row) => {
  const ta = String(a.created_at ?? "");
  const tb = String(b.created_at ?? "");
  if (ta !== tb) return ta < tb ? -1 : 1;
  return Number(a.position ?? 0) - Number(b.position ?? 0);
};

/** Oldest first. Both app and channel rows — one conversation. Under RLS this is the member's
    own account; under the service role the caller pins the account. */
export async function listThread(db: DbClient, accountId: string, opts: ListThreadOptions = {}): Promise<UnifiedMessage[]> {
  const identity = { accountId, contextGeneration: runtimeGeneration(opts.contextGeneration) };
  await assertRuntimeContext(db, identity, { allowPaused: true });
  let q = db.from("chat_messages").select(COLS).eq("account_id", accountId).eq("context_generation", identity.contextGeneration).eq("thread", THREAD);
  if (opts.since) q = q.gte("created_at", opts.since);
  const limit = Number.isFinite(opts.limit ?? 500) ? Math.min(500, Math.max(1, Math.floor(opts.limit ?? 500))) : 500;
  const rows = await unwrap<Row[]>("chat_messages.select", q.order("created_at", { ascending: false }).order("position", { ascending: false }).limit(limit));
  const oldest = rows.at(-1);
  if (opts.includeAppAnchor && oldest && oldest.channel !== "app") {
    const anchors = await unwrap<Row[]>("chat_messages.anchor", db.from("chat_messages").select(COLS)
      .eq("account_id", accountId).eq("context_generation", identity.contextGeneration).eq("thread", THREAD)
      .eq("channel", "app").in("sender", ["user", "unc"]).lte("created_at", oldest.created_at)
      .order("created_at", { ascending: false }).order("position", { ascending: false }).limit(1));
    for (const anchor of anchors) if (!rows.some(row => row.id === anchor.id)) rows.push(anchor);
  }
  await assertRuntimeContext(db, identity, { allowPaused: true });
  const sorted = [...rows].sort(byTime);
  return sorted.map(rowToUnified);
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** The last `turns` turns across every channel, as the model sees them. Staff (human-lane)
    rows never sit on this thread; typing placeholders are never persisted. */
export async function historyFor(db: DbClient, accountId: string, turns = HISTORY_TURNS, contextGeneration = 0): Promise<HistoryTurn[]> {
  const all = await listThread(db, accountId, { contextGeneration });
  const out: HistoryTurn[] = [];
  for (const m of all) {
    if (m.sender === "staff") continue;
    const content = m.body.trim().slice(0, MAX_TURN_CHARS);
    if (!content) continue;
    out.push({ role: m.sender === "user" ? "user" : "assistant", content });
  }
  return out.slice(-turns);
}
