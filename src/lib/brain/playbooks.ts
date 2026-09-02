/* Playbooks — Junction's own methods (email, paid, SEO/GEO, content, sales, analytics,
   strategy) as retrievable cards, global not per-account (migration 0010 `playbooks`).

     recallPlaybooks(query, domains?, limit?, opts?)   the cards most relevant to a question
     renderPlaybooksForPrompt(playbooks, opts?)        the block a system prompt appends

   Retrieval: when OPENAI_API_KEY is set the query is embedded (text-embedding-3-small, 1536
   dims — the same shape scripts/import-playbooks.ts stores) and match_playbooks does cosine
   search; when it isn't, or when no playbook has an embedding yet, a keyword ranker over
   title + tags + body stands in. Either way the answer is the same shape, so the prompt
   never knows which path ran.

   Not wired into src/lib/unc/prompt.ts (another agent's file). The one-line call, from
   docs/CLIENT-BRAIN.md:

     const block = renderPlaybooksForPrompt(await recallPlaybooks(question, undefined, 4));

   Relative imports only — scripts/import-playbooks.ts builds this file standalone. */

import { asDb } from "../db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../db/server";
import { unwrap, type DbClient } from "../db/types";

export type PlaybookDomain = "email" | "paid" | "seo" | "content" | "sales" | "strategy" | "analytics";
export const PLAYBOOK_DOMAINS: readonly PlaybookDomain[] = ["email", "paid", "seo", "content", "sales", "strategy", "analytics"] as const;
export const isPlaybookDomain = (v: unknown): v is PlaybookDomain => typeof v === "string" && (PLAYBOOK_DOMAINS as readonly string[]).includes(v);

export interface Playbook {
  id: string;
  domain: PlaybookDomain;
  title: string;
  body: string;
  tags: string[];
  /** Cosine similarity (embedding path) or a normalised keyword score (fallback). */
  score: number;
  via: "embedding" | "keyword";
}

export type Embedder = (text: string) => Promise<number[] | null>;

export interface RecallOptions {
  /** Defaults to the service-role client when configured; null = no database (returns []). */
  db?: DbClient | null;
  /** In-memory cards to rank instead of the table (keyword mode; the eval script feeds it the
      content/ files when no database is configured). Takes precedence over `db`. */
  rows?: PlaybookRowLite[] | null;
  /** Defaults to the OpenAI embeddings call when OPENAI_API_KEY is set. Pass `async () => null` to force keyword. */
  embed?: Embedder;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

/** OpenAI embeddings over fetch — the same auth/base-URL conventions as the chat adapter
    (OPENAI_API_KEY, optional OPENAI_BASE_URL). null when no key or on any failure; never throws. */
export async function embedText(text: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  const key = (env.OPENAI_API_KEY ?? "").trim();
  if (!key || !text.trim()) return null;
  const base = ((env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000), dimensions: EMBEDDING_DIMS }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { embedding?: number[] }[] };
    const v = j.data?.[0]?.embedding;
    return Array.isArray(v) && v.length === EMBEDDING_DIMS ? v : null;
  } catch {
    return null;
  }
}

// ---------- keyword fallback (pure, exported for tests) ----------

const STOP = new Set(["the", "and", "for", "with", "that", "this", "what", "how", "should", "can", "you", "your", "our", "are", "was", "have", "has", "not", "but", "about", "into", "from", "will", "would", "could", "does", "did", "why", "when", "where", "which", "there", "them", "they", "than", "then", "more", "most", "just", "like", "get", "got", "make", "made", "need", "want", "unc", "me", "my", "i", "a", "an", "to", "of", "in", "on", "at", "is", "it", "be", "do", "we", "us", "so", "if", "or", "as", "by"]);

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    const t = raw.replace(/s$/, ""); // crude stem: emails → email
    if (t.length >= 3 && !STOP.has(t) && !STOP.has(raw)) seen.add(t);
  }
  return [...seen];
}

export interface PlaybookRowLite {
  id: string;
  domain: string;
  title: string;
  body: string;
  tags: string[] | null;
}

export function keywordRank(query: string, rows: PlaybookRowLite[], limit: number): Playbook[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const scored = rows.map((r) => {
    const title = r.title.toLowerCase();
    const tags = (r.tags ?? []).join(" ").toLowerCase();
    const body = r.body.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      if (tags.includes(t)) score += 2;
      const n = body.split(t).length - 1;
      score += Math.min(n, 4) * 0.5;
    }
    return { r, score };
  });
  const max = Math.max(0, ...scored.map((s) => s.score));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title))
    .slice(0, limit)
    .map(({ r, score }) => ({ id: r.id, domain: r.domain as PlaybookDomain, title: r.title, body: r.body, tags: r.tags ?? [], score: max ? Math.round((score / max) * 100) / 100 : 0, via: "keyword" as const }));
}

// ---------- recall ----------

function defaultDb(): DbClient | null {
  try {
    return isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  } catch {
    return null;
  }
}

export async function recallPlaybooks(query: string, domains?: PlaybookDomain[] | null, limit = 6, opts: RecallOptions = {}): Promise<Playbook[]> {
  const wanted = domains?.filter(isPlaybookDomain) ?? null;
  const n = Math.max(1, Math.min(20, Math.round(limit)));
  if (opts.rows) {
    if (!query.trim()) return [];
    const pool = wanted && wanted.length ? opts.rows.filter((r) => (wanted as string[]).includes(r.domain)) : opts.rows;
    return keywordRank(query, pool, n);
  }
  const db = opts.db === undefined ? defaultDb() : opts.db;
  if (!db || !query.trim()) return [];
  const env = opts.env ?? process.env;
  const embed: Embedder = opts.embed ?? ((t) => embedText(t, env, opts.fetchImpl));

  const vec = await embed(query);
  if (vec) {
    try {
      const rows = await unwrap<{ id: string; domain: string; title: string; body: string; similarity: number }[]>(
        "rpc.match_playbooks",
        db.rpc("match_playbooks", { query_embedding: vec, match_count: n, domains: wanted && wanted.length ? wanted : null }),
      );
      if (rows && rows.length) {
        // tags aren't returned by the RPC; fetch them in one go so the prompt block can show them
        const tagRows = await unwrap<{ id: string; tags: string[] | null }[]>("playbooks.tags", db.from("playbooks").select("id, tags").in("id", rows.map((r) => r.id)));
        const tags = new Map((tagRows ?? []).map((t) => [t.id, t.tags ?? []]));
        return rows.map((r) => ({ id: r.id, domain: r.domain as PlaybookDomain, title: r.title, body: r.body, tags: tags.get(r.id) ?? [], score: Math.round(Number(r.similarity) * 100) / 100, via: "embedding" as const }));
      }
    } catch {
      // fall through to keyword — the RPC missing or failing must never break a chat turn
    }
  }

  let q = db.from("playbooks").select("id, domain, title, body, tags");
  if (wanted && wanted.length) q = q.in("domain", wanted);
  const rows = await unwrap<PlaybookRowLite[]>("playbooks.select", q);
  return keywordRank(query, rows ?? [], n);
}

// ---------- prompt block ----------

export interface RenderOptions {
  /** Whole-block cap; the last card is truncated with an ellipsis rather than dropped silently. */
  maxChars?: number;
  /** Per-card body cap. */
  perPlaybookChars?: number;
  /** Replace the default header line (the chat prompt uses the compact "PLAYBOOK NOTES" form). */
  header?: string;
}

export const PLAYBOOKS_HEADER = "JUNCTION PLAYBOOKS (how we work — methods to draw on, NOT a source of numbers; every figure you state still has to come from the ACCOUNT CONTEXT):";

/** The text a system prompt appends. Empty string when there is nothing to add, so a caller can
    always concatenate it. The header tells the model these are METHODS — never a source of numbers. */
export function renderPlaybooksForPrompt(playbooks: Playbook[], opts: RenderOptions = {}): string {
  if (!playbooks.length) return "";
  const maxChars = opts.maxChars ?? 6000;
  const per = opts.perPlaybookChars ?? 1800;
  const header = opts.header ?? PLAYBOOKS_HEADER;
  const parts: string[] = [];
  let used = header.length;
  for (const p of playbooks) {
    const body = p.body.replace(/\s+\n/g, "\n").trim();
    const card = `\n\n## ${p.title} [${p.domain}${p.tags.length ? ` · ${p.tags.slice(0, 5).join(", ")}` : ""}]\n${body.length > per ? `${body.slice(0, per).trimEnd()}…` : body}`;
    if (used + card.length > maxChars) {
      const room = maxChars - used;
      if (room > 200) parts.push(`${card.slice(0, room - 1).trimEnd()}…`);
      break;
    }
    parts.push(card);
    used += card.length;
  }
  return `${header}${parts.join("")}`;
}

// ---------- content files (content/playbooks/<domain>/<slug>.md) ----------

export interface PlaybookFile {
  domain: PlaybookDomain;
  title: string;
  tags: string[];
  source: string | null;
  body: string;
}

/** Parse one playbook markdown file: a small YAML-ish frontmatter (domain, title, tags, source)
    and the body. Throws with the path in the message so the import script and the content test
    both name the offending file. */
export function parsePlaybookMarkdown(text: string, path = "<inline>"): PlaybookFile {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trim());
  if (!m) throw new Error(`${path}: missing frontmatter (--- domain/title/tags/source ---)`);
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  const domain = fm.domain;
  if (!isPlaybookDomain(domain)) throw new Error(`${path}: domain "${domain ?? ""}" is not one of ${PLAYBOOK_DOMAINS.join("|")}`);
  const title = (fm.title ?? "").replace(/^["']|["']$/g, "").trim();
  if (!title) throw new Error(`${path}: title is required`);
  const rawTags = (fm.tags ?? "").replace(/^\[|\]$/g, "");
  const tags = rawTags
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
  const body = m[2].trim();
  if (body.length < 200) throw new Error(`${path}: body is too short to be a playbook (${body.length} chars)`);
  return { domain, title, tags, source: fm.source?.trim() || null, body };
}

/** Text that gets embedded: title + tags + body, so a query on the topic finds the card. */
export const playbookEmbeddingText = (p: Pick<PlaybookFile, "domain" | "title" | "tags" | "body">) => `${p.title}\n[${p.domain}] ${p.tags.join(", ")}\n\n${p.body}`;
