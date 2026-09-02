/* Small local reader/writer for the 0010 `memories` table — what intake and the
   "What Unc knows" API need. Deliberately minimal and self-contained: the full brain
   (extraction, embedding, retrieval) lives in src/lib/brain/memory.ts and is not imported here;
   both write the same rows, so anything written through this file is visible to the brain.

   Rules that hold on every write:
     - dedupe on identical text (trimmed) among the account's live memories
     - forgetting sets valid_to; nothing is ever deleted
     - a founder edit creates a NEW row (source 'founder', confidence 1.0) and points the old
       one at it via superseded_by — the history survives, the brain reads only live rows */

import { unwrap, type DbClient } from "../db/types";

export type MemoryKind = "fact" | "preference" | "constraint" | "decision" | "relationship" | "event" | "lesson" | "summary";
export type MemorySource = "chat" | "onboarding" | "scan" | "receipt" | "self_review" | "intake" | "founder" | "brief";

export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "constraint", "decision", "relationship", "event", "lesson", "summary"] as const;
export const isMemoryKind = (v: unknown): v is MemoryKind => typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);

export interface MemoryInput {
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  confidence: number;
  importance?: number;
  tags?: string[];
  happens_at?: string | null;
  source_ref?: string | null;
}

export interface MemoryRow {
  id: string;
  account_id: string;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  source_ref: string | null;
  confidence: number;
  importance: number;
  tags: string[];
  happens_at: string | null;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  created_at: string;
}

const COLS = "id, account_id, kind, text, source, source_ref, confidence, importance, tags, happens_at, valid_from, valid_to, superseded_by, created_at";

export const normaliseText = (t: string) => t.replace(/\s+/g, " ").trim();

export async function listActiveMemories(db: DbClient, accountId: string): Promise<MemoryRow[]> {
  const rows = await unwrap<MemoryRow[]>("memories.select", db.from("memories").select(COLS).eq("account_id", accountId).is("valid_to", null).order("created_at", { ascending: false }));
  return rows ?? [];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function toRow(accountId: string, m: MemoryInput, now: string) {
  return {
    account_id: accountId,
    kind: m.kind,
    text: normaliseText(m.text).slice(0, 4000),
    source: m.source,
    source_ref: m.source_ref ?? null,
    confidence: clamp(Math.round(m.confidence * 100) / 100, 0, 1),
    importance: clamp(Math.round(m.importance ?? 3), 1, 5),
    tags: m.tags ?? [],
    happens_at: m.happens_at ?? null,
    valid_from: now,
    valid_to: null,
    created_at: now,
    updated_at: now,
  };
}

/** Insert, skipping any text already live on the account (and duplicates within the batch). */
export async function writeMemories(db: DbClient, accountId: string, inputs: MemoryInput[], now = new Date()): Promise<{ inserted: MemoryRow[]; skipped: number }> {
  const clean = inputs.map((m) => ({ ...m, text: normaliseText(m.text) })).filter((m) => m.text);
  if (!clean.length) return { inserted: [], skipped: 0 };
  const existing = new Set((await listActiveMemories(db, accountId)).map((r) => normaliseText(r.text).toLowerCase()));
  const rows: ReturnType<typeof toRow>[] = [];
  let skipped = 0;
  for (const m of clean) {
    const key = m.text.toLowerCase();
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    rows.push(toRow(accountId, m, now.toISOString()));
  }
  if (!rows.length) return { inserted: [], skipped };
  const inserted = await unwrap<MemoryRow[]>("memories.insert", db.from("memories").insert(rows).select(COLS));
  return { inserted: inserted ?? [], skipped };
}

/** "Forget": end the memory's validity. false when it isn't a live memory on this account. */
export async function forgetMemory(db: DbClient, accountId: string, id: string, now = new Date()): Promise<boolean> {
  const rows = await unwrap<{ id: string }[]>("memories.forget", db.from("memories").update({ valid_to: now.toISOString(), updated_at: now.toISOString() }).eq("account_id", accountId).eq("id", id).is("valid_to", null).select("id"));
  return (rows ?? []).length > 0;
}

/** Founder correction: new row (founder, 1.0) supersedes the old. null when the old row isn't live here. */
export async function reviseMemory(db: DbClient, accountId: string, id: string, text: string, now = new Date()): Promise<MemoryRow | null> {
  const old = await unwrap<MemoryRow | null>("memories.get", db.from("memories").select(COLS).eq("account_id", accountId).eq("id", id).is("valid_to", null).maybeSingle());
  if (!old) return null;
  const row = toRow(accountId, { kind: old.kind, text, source: "founder", confidence: 1, importance: Math.max(old.importance, 4), tags: old.tags, happens_at: old.happens_at, source_ref: old.id }, now.toISOString());
  const created = await unwrap<MemoryRow>("memories.insert", db.from("memories").insert(row).select(COLS).single());
  await unwrap("memories.supersede", db.from("memories").update({ valid_to: now.toISOString(), superseded_by: created.id, updated_at: now.toISOString() }).eq("id", old.id));
  return created;
}

/** "Add something Unc should know" — founder-stated, full confidence. */
export async function addFounderMemory(db: DbClient, accountId: string, text: string, kind: MemoryKind = "fact", now = new Date()): Promise<MemoryRow | null> {
  const { inserted } = await writeMemories(db, accountId, [{ kind, text, source: "founder", confidence: 1, importance: 4 }], now);
  return inserted[0] ?? null;
}
