/* Client Brain — durable per-account memory (memories, migration 0010).

     addMemory(db, input, opts)            insert, or merge into a near-identical live memory of
                                           the same kind (confidence/importance/tags bumped, no
                                           duplicate row); embedding computed on insert when
                                           embeddings are configured
     supersede(db, oldId, newId, opts)     old memory closed (valid_to) and pointed at the new one
     forget(db, id, opts)                  valid_to = now (soft delete; history stays)
     listMemories(db, accountId, opts)     live memories (newest first), optionally by kind /
                                           including expired

   Every function takes the client explicitly (service role server-side; the founder's own
   RLS client also passes member_all). The embedding column is never selected back — vectors
   stay in the database. Relative imports only (worker-buildable). */

import type { DbClient, Row } from "../db/types";
import { unwrap } from "../db/types";
import { embed as defaultEmbed, isEmbeddingConfigured, type EmbedFn } from "../llm/embed";

export const MEMORY_KINDS = ["fact", "preference", "constraint", "decision", "relationship", "event", "lesson", "summary"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SOURCES = ["chat", "onboarding", "scan", "receipt", "self_review", "intake", "founder", "brief"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const isMemoryKind = (v: unknown): v is MemoryKind => typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);
export const isMemorySource = (v: unknown): v is MemorySource => typeof v === "string" && (MEMORY_SOURCES as readonly string[]).includes(v);

export interface Memory {
  id: string;
  accountId: string;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  sourceRef: string | null;
  confidence: number;
  importance: number;
  tags: string[];
  happensAt: string | null;
  validFrom: string;
  validTo: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewMemory {
  accountId: string;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  sourceRef?: string | null;
  /** 0–1, default 0.7. */
  confidence?: number;
  /** 1–5, default 3. */
  importance?: number;
  tags?: string[];
  /** ISO timestamp; events only. */
  happensAt?: string | null;
}

export interface BrainOptions {
  now?: () => Date;
  /** null = never embed (tests / degraded mode); undefined = the real embed when configured. */
  embed?: EmbedFn | null;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface AddMemoryResult {
  memory: Memory;
  /** true when the text matched a live memory of the same kind and that row was updated instead. */
  merged: boolean;
}

export interface ListMemoriesOptions {
  kinds?: MemoryKind[];
  limit?: number;
  includeExpired?: boolean;
}

export const MEMORY_TEXT_MAX = 600;
/** Jaccard similarity on normalised tokens at/above which two texts are "the same memory". */
export const DEDUPE_THRESHOLD = 0.85;
const DEFAULT_LIST_LIMIT = 50;

/** Columns read back — never `embedding`. */
export const MEMORY_COLUMNS = "id, account_id, kind, text, source, source_ref, confidence, importance, tags, happens_at, valid_from, valid_to, superseded_by, created_at, updated_at";

export function rowToMemory(r: Row): Memory {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    kind: r.kind as MemoryKind,
    text: String(r.text ?? ""),
    source: r.source as MemorySource,
    sourceRef: (r.source_ref as string | null) ?? null,
    confidence: Number(r.confidence ?? 0.7),
    importance: Number(r.importance ?? 3),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    happensAt: (r.happens_at as string | null) ?? null,
    validFrom: String(r.valid_from ?? r.created_at ?? ""),
    validTo: (r.valid_to as string | null) ?? null,
    supersededBy: (r.superseded_by as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? r.created_at ?? ""),
  };
}

// ---------- text normalisation (shared with extract/retrieve) ----------

export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}%$]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normaliseText(s).split(" ").filter(Boolean);
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Same memory? Exact normalised match or near-identical token sets. */
export function isNearIdentical(a: string, b: string): boolean {
  const na = normaliseText(a);
  const nb = normaliseText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return jaccard(na.split(" "), nb.split(" ")) >= DEDUPE_THRESHOLD;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function cleanTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const s = String(t).trim().toLowerCase().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function embedFor(text: string, opts: BrainOptions, accountId: string, db: DbClient): Promise<number[] | null> {
  const fn = opts.embed === undefined ? (isEmbeddingConfigured() ? defaultEmbed : null) : opts.embed;
  if (!fn) return null;
  try {
    const r = await fn([text], { accountId, db });
    return r.vectors[0] ?? null;
  } catch (err) {
    opts.log?.("brain.embed_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ---------- CRUD ----------

export async function addMemory(db: DbClient, input: NewMemory, opts: BrainOptions = {}): Promise<AddMemoryResult> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_MAX);
  if (!text) throw new Error("memory text is empty");
  if (!isMemoryKind(input.kind)) throw new Error(`unknown memory kind ${String(input.kind)}`);
  if (!isMemorySource(input.source)) throw new Error(`unknown memory source ${String(input.source)}`);
  const confidence = round2(clamp(input.confidence ?? 0.7, 0, 1));
  const importance = clamp(Math.round(input.importance ?? 3), 1, 5);
  const tags = cleanTags(input.tags);
  const happensAt = isoOrNull(input.happensAt);

  // Dedupe against the live memories of the same kind.
  const live = await listMemories(db, input.accountId, { kinds: [input.kind], limit: 400 });
  const twin = live.find((m) => isNearIdentical(m.text, text));
  if (twin) {
    const patch: Row = {
      confidence: round2(clamp(Math.max(twin.confidence, confidence) + 0.05, 0, 1)),
      importance: Math.max(twin.importance, importance),
      tags: cleanTags([...twin.tags, ...tags]),
      updated_at: now,
    };
    if (happensAt && happensAt !== twin.happensAt) patch.happens_at = happensAt;
    if (input.sourceRef && !twin.sourceRef) patch.source_ref = input.sourceRef;
    await unwrap("memories.merge", db.from("memories").update(patch).eq("id", twin.id));
    return {
      memory: { ...twin, confidence: patch.confidence as number, importance: patch.importance as number, tags: patch.tags as string[], happensAt: (patch.happens_at as string | undefined) ?? twin.happensAt, sourceRef: (patch.source_ref as string | undefined) ?? twin.sourceRef, updatedAt: now },
      merged: true,
    };
  }

  const embedding = await embedFor(text, opts, input.accountId, db);
  const row: Row = {
    account_id: input.accountId,
    kind: input.kind,
    text,
    source: input.source,
    source_ref: input.sourceRef ?? null,
    confidence,
    importance,
    tags,
    happens_at: happensAt,
    valid_from: now,
    valid_to: null,
    superseded_by: null,
    created_at: now,
    updated_at: now,
  };
  if (embedding) row.embedding = embedding;
  const inserted = await unwrap<Row[]>("memories.insert", db.from("memories").insert(row).select(MEMORY_COLUMNS));
  const r = inserted?.[0];
  if (!r) throw new Error("memories.insert: no row returned");
  return { memory: rowToMemory(r), merged: false };
}

/** Insert several; returns each result in order. Failures are per item (the rest still land). */
export async function addMemories(db: DbClient, inputs: NewMemory[], opts: BrainOptions = {}): Promise<{ results: AddMemoryResult[]; failed: { input: NewMemory; error: string }[] }> {
  const results: AddMemoryResult[] = [];
  const failed: { input: NewMemory; error: string }[] = [];
  for (const input of inputs) {
    try {
      results.push(await addMemory(db, input, opts));
    } catch (err) {
      failed.push({ input, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, failed };
}

export async function getMemory(db: DbClient, id: string): Promise<Memory | null> {
  const r = await unwrap<Row | null>("memories.get", db.from("memories").select(MEMORY_COLUMNS).eq("id", id).maybeSingle());
  return r ? rowToMemory(r) : null;
}

/** Close `oldId` in favour of `newId` (same account). The new memory stays live untouched. */
export async function supersede(db: DbClient, oldId: string, newId: string, opts: BrainOptions = {}): Promise<void> {
  if (oldId === newId) throw new Error("a memory cannot supersede itself");
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const [oldM, newM] = await Promise.all([getMemory(db, oldId), getMemory(db, newId)]);
  if (!oldM) throw new Error(`memory ${oldId} not found`);
  if (!newM) throw new Error(`memory ${newId} not found`);
  if (oldM.accountId !== newM.accountId) throw new Error("memories belong to different accounts");
  await unwrap("memories.supersede", db.from("memories").update({ valid_to: now, superseded_by: newId, updated_at: now }).eq("id", oldId));
}

/** Soft delete: the row stays for history but is no longer live. */
export async function forget(db: DbClient, id: string, opts: BrainOptions = {}): Promise<void> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  await unwrap("memories.forget", db.from("memories").update({ valid_to: now, updated_at: now }).eq("id", id));
}

export async function listMemories(db: DbClient, accountId: string, opts: ListMemoriesOptions = {}): Promise<Memory[]> {
  let q = db.from("memories").select(MEMORY_COLUMNS).eq("account_id", accountId);
  if (opts.kinds?.length) q = q.in("kind", opts.kinds);
  if (!opts.includeExpired) q = q.is("valid_to", null);
  q = q.order("created_at", { ascending: false }).limit(opts.limit ?? DEFAULT_LIST_LIMIT);
  const rows = await unwrap<Row[]>("memories.list", q);
  return (rows ?? []).map(rowToMemory);
}

/** Live memories carrying this source_ref (idempotency checks for hooks). */
export async function findBySourceRef(db: DbClient, accountId: string, sourceRef: string): Promise<Memory[]> {
  const rows = await unwrap<Row[]>("memories.by_source_ref", db.from("memories").select(MEMORY_COLUMNS).eq("account_id", accountId).eq("source_ref", sourceRef).is("valid_to", null));
  return (rows ?? []).map(rowToMemory);
}
