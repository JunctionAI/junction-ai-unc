/* Client Brain — what Unc recalls before he answers.

     recallForContext(db, accountId, { query, kinds?, limit = 12 })
       1. pinned: live constraints + preferences, by importance (always; up to 8)
       2. upcoming: live events in the next 30 days, soonest first (up to 5)
       3. top-k for the query:
            - embeddings configured → embed the query, match_memories RPC (cosine)
            - otherwise (or on any failure) → keyword overlap + recency over the live memories
       Returns compact "[kind] text" lines with dates, capped at ~1500 chars.

   Degradation is the design: with no OPENAI_API_KEY nothing breaks — mode reads "keyword"
   and the same shape comes back. Relative imports only (worker-buildable). */

import type { DbClient, Row } from "../db/types";
import { embed as defaultEmbed, isEmbeddingConfigured, type EmbedFn } from "../llm/embed";
import { contentWords } from "./extract";
import { listMemories, type Memory, type MemoryKind } from "./memory";

export const RECALL_LIMIT = 12;
export const RECALL_MAX_CHARS = 1500;
export const PINNED_MAX = 8;
export const UPCOMING_MAX = 5;
export const UPCOMING_WINDOW_DAYS = 30;
const CANDIDATE_POOL = 200;
const DAY_MS = 86_400_000;

export interface RecallOptions {
  query?: string;
  /** Restricts the query-matched slice (pinned constraints/preferences and upcoming events always come). */
  kinds?: MemoryKind[];
  /** Total memories returned: pinned rules fill first, then upcoming events, then the query slice. */
  limit?: number;
  maxChars?: number;
  now?: () => Date;
  /** null = never embed (keyword mode); undefined = the real embed when configured. */
  embed?: EmbedFn | null;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  happensAt: string | null;
  importance: number;
  /** pinned | upcoming | similarity | keyword */
  via: "pinned" | "upcoming" | "similarity" | "keyword";
  score: number;
}

export interface RecallResult {
  lines: string[];
  memories: RecalledMemory[];
  /** How the query slice was ranked. */
  mode: "similarity" | "keyword" | "none";
  truncated: boolean;
}

export function formatMemoryLine(m: Pick<Memory, "kind" | "text" | "happensAt">): string {
  const date = m.kind === "event" && m.happensAt ? ` ${m.happensAt.slice(0, 10)}` : "";
  return `[${m.kind}${date}] ${m.text}`;
}

/** Keyword score: overlap of query content words with the memory, plus recency and importance. */
export function keywordScore(query: string, m: Pick<Memory, "text" | "createdAt" | "importance">, now: Date): number {
  const q = contentWords(query);
  const words = new Set(contentWords(m.text));
  let hit = 0;
  for (const w of q) if (words.has(w)) hit++;
  const overlap = q.length ? hit / q.length : 0;
  const ageDays = Math.max(0, (now.getTime() - new Date(m.createdAt).getTime()) / DAY_MS);
  const recency = 1 / (1 + ageDays / 30);
  return overlap + 0.3 * recency + 0.05 * m.importance;
}

interface MatchRow {
  id: string;
  kind: string;
  text: string;
  importance: number;
  confidence: number;
  happens_at: string | null;
  similarity: number;
}

async function similaritySlice(db: DbClient, accountId: string, query: string, kinds: MemoryKind[] | undefined, count: number, opts: RecallOptions): Promise<RecalledMemory[] | null> {
  const fn = opts.embed === undefined ? (isEmbeddingConfigured() ? defaultEmbed : null) : opts.embed;
  if (!fn) return null;
  try {
    const e = await fn([query], { accountId, db });
    const vec = e.vectors[0];
    if (!vec) return null;
    const { data, error } = await db.rpc("match_memories", { acct: accountId, query_embedding: vec, match_count: count, kinds: kinds?.length ? kinds : null });
    if (error) {
      opts.log?.("brain.match_memories_failed", { accountId, error: error.message });
      return null;
    }
    const rows = (Array.isArray(data) ? data : []) as (Row & Partial<MatchRow>)[];
    return rows
      .filter((r) => typeof r.id === "string" && typeof r.text === "string")
      .map((r) => ({ id: String(r.id), kind: r.kind as MemoryKind, text: String(r.text), happensAt: (r.happens_at as string | null) ?? null, importance: Number(r.importance ?? 3), via: "similarity" as const, score: Number(r.similarity ?? 0) }));
  } catch (err) {
    opts.log?.("brain.similarity_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function recallForContext(db: DbClient, accountId: string, opts: RecallOptions = {}): Promise<RecallResult> {
  const now = (opts.now ?? (() => new Date()))();
  const limit = opts.limit ?? RECALL_LIMIT;
  const maxChars = opts.maxChars ?? RECALL_MAX_CHARS;
  const query = (opts.query ?? "").trim();
  const seen = new Set<string>();
  const picked: RecalledMemory[] = [];

  // 1. pinned rules
  const pinnedAll = await listMemories(db, accountId, { kinds: ["constraint", "preference"], limit: CANDIDATE_POOL });
  pinnedAll.sort((a, b) => b.importance - a.importance || b.confidence - a.confidence || (a.createdAt < b.createdAt ? 1 : -1));
  for (const m of pinnedAll.slice(0, Math.min(PINNED_MAX, limit))) {
    seen.add(m.id);
    picked.push({ id: m.id, kind: m.kind, text: m.text, happensAt: m.happensAt, importance: m.importance, via: "pinned", score: m.importance });
  }

  // 2. upcoming events
  const horizon = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS).toISOString();
  const nowIso = now.toISOString();
  const events = (await listMemories(db, accountId, { kinds: ["event"], limit: CANDIDATE_POOL })).filter((m) => m.happensAt && m.happensAt >= nowIso && m.happensAt <= horizon);
  events.sort((a, b) => (a.happensAt! < b.happensAt! ? -1 : 1));
  for (const m of events.slice(0, Math.max(0, Math.min(UPCOMING_MAX, limit - picked.length)))) {
    seen.add(m.id);
    picked.push({ id: m.id, kind: m.kind, text: m.text, happensAt: m.happensAt, importance: m.importance, via: "upcoming", score: 0 });
  }

  // 3. the query slice
  let mode: RecallResult["mode"] = "none";
  const room = Math.max(0, limit - picked.length);
  if (room > 0) {
    let slice: RecalledMemory[] | null = null;
    if (query) slice = await similaritySlice(db, accountId, query, opts.kinds, room + seen.size, opts);
    if (slice) mode = "similarity";
    else {
      mode = query ? "keyword" : "none";
      const pool = await listMemories(db, accountId, { kinds: opts.kinds, limit: CANDIDATE_POOL });
      slice = pool.map((m) => ({ id: m.id, kind: m.kind, text: m.text, happensAt: m.happensAt, importance: m.importance, via: "keyword" as const, score: query ? keywordScore(query, m, now) : 0.3 / (1 + Math.max(0, (now.getTime() - new Date(m.createdAt).getTime()) / DAY_MS) / 30) + 0.05 * m.importance }));
      slice.sort((a, b) => b.score - a.score);
    }
    let added = 0;
    for (const m of slice) {
      if (added >= room) break;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      picked.push(m);
      added++;
    }
  }

  // 4. render within the char budget (pinned first, then upcoming, then the slice)
  const lines: string[] = [];
  const memories: RecalledMemory[] = [];
  let used = 0;
  let truncated = false;
  for (const m of picked) {
    const line = formatMemoryLine(m);
    if (used + line.length + 1 > maxChars) {
      truncated = true;
      continue;
    }
    lines.push(line);
    memories.push(m);
    used += line.length + 1;
  }
  return { lines, memories, mode, truncated };
}
