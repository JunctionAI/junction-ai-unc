/* Niche brief — "research the business up front and adjust each workflow accordingly".

   One model call after the scan (task "niche_brief", balanced tier) turns the business profile +
   the nearest industry band + the playbooks that apply into a short structured read of the market:

     { categoryBand, summary, buyingTriggers, seasonality, channelsThatWork, benchmarks, avoid }

   Numbers-only-from-context: every number in any line must already appear in the material the
   model was given (profile, band ranges, playbook cards) or be a count of 12 or under; a benchmark
   with a number from nowhere is dropped, and with none left `benchmarks` is null. Lines are plain
   prose — no markdown, no emoji, no filler — in Unc's voice.

   The brief is stored as memories (kind fact · source scan · tags ["niche", …], one source_ref per
   account, so a re-scan replaces rather than duplicates) and read back by resolvePreset through
   the "Category band: <id>" memory (src/lib/runtime/presets/store.ts). Without a model provider the
   deterministic half still lands: the band and why.

   Relative imports only (worker-buildable). */

import type { DbClient } from "../db/types";
import { createTextClient, resolveModel } from "../llm/router";
import { BAND_IDS, BAND_LABEL, isBandId, pickBand, resolvePreset, type BandId, type ResolveInput } from "../runtime/presets/industry";
import { NICHE_BAND_TAG, NICHE_TAG } from "../runtime/presets/store";
import { PRESET_DOMAINS } from "../runtime/presets/types";
import { modelFromProfile } from "../unc/businessType";
import { addMemories, findBySourceRef, forget, type BrainOptions, type Memory, type NewMemory } from "./memory";
import { recallPlaybooks, type Playbook } from "./playbooks";

export interface NicheBenchmark {
  metric: string;
  low: number | null;
  high: number | null;
  unit: string;
  /** Which card / context line it came from. */
  source: string;
}

export interface NicheBrief {
  categoryBand: BandId | null;
  /** Why the band — from pickBand, never the model. */
  bandWhy: string;
  /** ≤ 3 sentences, Unc's voice. */
  summary: string;
  buyingTriggers: string[];
  seasonality: string[];
  channelsThatWork: string[];
  /** null = nothing in the playbooks / context carried a number for this market. */
  benchmarks: NicheBenchmark[] | null;
  avoid: string[];
}

export interface ProfileLike {
  name?: string | null;
  oneLiner?: string | null;
  category?: string | null;
  products?: string[];
  audience?: string | null;
  market?: { region?: string | null; competitorsMentioned?: string[] } | null;
  signals?: string[];
  businessType?: string | null;
  sells?: string | null;
  storefront?: string | null;
}

export const NICHE_BRIEF_MAX_TOKENS = 1800;
export const NICHE_BRIEF_EFFORT = "medium" as const;
export const MAX_LIST = 5;
export const MAX_LINE_CHARS = 180;
export const MAX_SUMMARY_CHARS = 420;
export const nicheBriefSourceRef = (accountId: string) => `niche_brief:${accountId}`;

// ---------- context ----------

export function resolveInputFromProfile(profile: ProfileLike | null, extra: Partial<ResolveInput> = {}): ResolveInput {
  const p = profile ?? {};
  const m = modelFromProfile(p);
  return {
    businessType: m.businessType,
    sells: m.sells,
    storefront: m.storefront,
    category: p.category ?? null,
    descriptor: [p.name ?? "", p.oneLiner ?? "", ...(p.products ?? []).slice(0, 8)].filter(Boolean).join(" · ") || null,
    ...extra,
  };
}

export function playbookQuery(profile: ProfileLike | null, band: BandId | null): string {
  return [profile?.category, profile?.oneLiner, band ? BAND_LABEL[band] : "", "buying triggers seasonality channels benchmarks what to avoid"].filter(Boolean).join(" ");
}

export interface NicheContext {
  profile: ProfileLike | null;
  band: BandId | null;
  bandWhy: string;
  playbooks: Playbook[];
  /** The band's non-money ranges per domain, as the model sees them. */
  bandRanges: Record<string, Record<string, { low: number | null; high: number | null; value: number | string | null }>>;
}

export function buildNicheContext(profile: ProfileLike | null, playbooks: Playbook[], extra: Partial<ResolveInput> = {}): NicheContext {
  const input = resolveInputFromProfile(profile, extra);
  const { band, why } = pickBand(input);
  const bandRanges: NicheContext["bandRanges"] = {};
  for (const domain of PRESET_DOMAINS) {
    const set = resolvePreset(input, domain);
    bandRanges[domain] = Object.fromEntries(set.fields.filter((f) => f.unit !== "money").map((f) => [f.key, { low: f.industry?.low ?? null, high: f.industry?.high ?? null, value: f.industry?.value ?? null }]));
  }
  return { profile, band, bandWhy: why, playbooks, bandRanges };
}

export const NICHE_SYSTEM = `You are Unc, the marketing department that runs a founder's growth beside them. You are writing how you read their market, before any routine runs. Register: "In your corner." First person, plain prose, numbers over adjectives, no hype, no exclamation marks, no markdown, no bullets, no emoji.

Rules that are not negotiable:
- Only numbers that appear in the MATERIAL below (the profile, the band ranges, the playbook cards). A number from anywhere else is invented; leave it out. A benchmark with no number in the material is not a benchmark — omit it.
- Say what the business actually does from the profile; never assume it is a store unless the profile says so.
- Every line is one idea, under 180 characters, specific to this market. No filler ("it's worth noting", "great question", "as you know").
- The summary is at most three sentences: what kind of market this is, what wins in it, what I will do differently because of it.

Answer with ONE JSON object and nothing else:
{"categoryBand": <one of ${BAND_IDS.map((b) => `"${b}"`).join(" | ")} | null>,
 "summary": "<≤ 3 sentences>",
 "buyingTriggers": ["<what makes someone buy, in this market>", …≤5],
 "seasonality": ["<when demand moves and why>", …≤4],
 "channelsThatWork": ["<channel and why it works here>", …≤4],
 "benchmarks": [{"metric": "<what>", "low": <number|null>, "high": <number|null>, "unit": "<unit>", "source": "<which card or context line>"}, …≤5],
 "avoid": ["<what not to do in this market>", …≤4]}`;

export function renderNicheMaterial(ctx: NicheContext): string {
  const p = ctx.profile ?? {};
  const lines: string[] = [];
  lines.push("PROFILE:");
  lines.push(JSON.stringify({ name: p.name ?? null, oneLiner: p.oneLiner ?? null, category: p.category ?? null, products: (p.products ?? []).slice(0, 12), audience: p.audience ?? null, market: p.market ?? null, signals: (p.signals ?? []).slice(0, 10), businessType: p.businessType ?? null, sells: p.sells ?? null, storefront: p.storefront ?? null }));
  lines.push("");
  lines.push(`NEAREST BAND: ${ctx.band ? `${ctx.band} (${BAND_LABEL[ctx.band]})` : "unknown"} — ${ctx.bandWhy}`);
  lines.push("BAND RANGES (industry defaults I would apply):");
  lines.push(JSON.stringify(ctx.bandRanges));
  lines.push("");
  lines.push("PLAYBOOK CARDS:");
  if (!ctx.playbooks.length) lines.push("(none matched)");
  for (const pb of ctx.playbooks) lines.push(`## ${pb.title} [${pb.domain}]\n${pb.body.slice(0, 2200)}`);
  return lines.join("\n");
}

// ---------- validation ----------

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const norm = (t: string) => t.replace(/,/g, "");
const NO_MARKDOWN = /[*#_`>]|\[[^\]]*\]\(/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FILLER = /great question|good question|it'?s worth noting|as you know|to be honest|at the end of the day|here'?s the thing|let me explain|i'?d be happy to/i;

/** Every number in the material (plus counts 1–12) is fair game; nothing else is. */
export function allowedNumbers(material: string): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i <= 12; i++) set.add(String(i));
  for (const m of material.match(NUM_RE) ?? []) set.add(norm(m));
  return set;
}

export function numbersOk(text: string, allowed: Set<string>): boolean {
  return (text.match(NUM_RE) ?? []).every((m) => allowed.has(norm(m)));
}

const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-Z“"'(])/;

function cleanLine(v: unknown, allowed: Set<string>, maxChars: number, maxSentences: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || NO_MARKDOWN.test(t) || EMOJI.test(t) || FILLER.test(t) || /!/.test(t)) return null;
  if (!numbersOk(t, allowed)) return null;
  const clipped = t.split(SENTENCE_SPLIT).slice(0, maxSentences).join(" ");
  if (clipped.length > maxChars) return null;
  return clipped;
}

function cleanList(v: unknown, allowed: Set<string>, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = cleanLine(item, allowed, MAX_LINE_CHARS, 2);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function cleanBenchmarks(v: unknown, allowed: Set<string>): NicheBenchmark[] | null {
  if (!Array.isArray(v)) return null;
  const out: NicheBenchmark[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const metric = cleanLine(r.metric, allowed, 80, 1);
    const source = typeof r.source === "string" ? r.source.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const unit = typeof r.unit === "string" ? r.unit.trim().slice(0, 24) : "";
    const num = (x: unknown): number | null | undefined => {
      if (x === null || x === undefined) return null;
      if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
      return allowed.has(norm(String(x))) ? x : undefined;
    };
    const low = num(r.low);
    const high = num(r.high);
    if (!metric || !source || low === undefined || high === undefined) continue; // an invented number drops the benchmark
    if (low === null && high === null) continue; // a benchmark needs a number
    if (NO_MARKDOWN.test(source) || NO_MARKDOWN.test(unit)) continue;
    out.push({ metric, low, high, unit, source });
    if (out.length >= MAX_LIST) break;
  }
  return out.length ? out : null;
}

export function extractJsonObject(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Validate the model's JSON against the material. Null when nothing usable came back. */
export function parseNicheBrief(raw: unknown, ctx: NicheContext, material = renderNicheMaterial(ctx)): NicheBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const allowed = allowedNumbers(material);
  const summary = cleanLine(r.summary, allowed, MAX_SUMMARY_CHARS, 3);
  if (!summary) return null;
  const modelBand = isBandId(r.categoryBand) ? r.categoryBand : null;
  // The model may sharpen an unknown band; it never overrides a band the evidence already picked.
  const categoryBand = ctx.band ?? modelBand;
  return {
    categoryBand,
    bandWhy: ctx.band ? ctx.bandWhy : modelBand ? `my read of the profile: ${BAND_LABEL[modelBand].toLowerCase()}` : ctx.bandWhy,
    summary,
    buyingTriggers: cleanList(r.buyingTriggers, allowed, MAX_LIST),
    seasonality: cleanList(r.seasonality, allowed, 4),
    channelsThatWork: cleanList(r.channelsThatWork, allowed, 4),
    benchmarks: cleanBenchmarks(r.benchmarks, allowed),
    avoid: cleanList(r.avoid, allowed, 4),
  };
}

/** What lands without a model: the band and why, honestly labelled. */
export function deterministicBrief(ctx: NicheContext): NicheBrief {
  const band = ctx.band;
  return {
    categoryBand: band,
    bandWhy: ctx.bandWhy,
    summary: band ? `I read you as ${BAND_LABEL[band].toLowerCase()}: ${ctx.bandWhy}. I start every routine on that band's defaults and adjust as your numbers come in.` : `${ctx.bandWhy}. I start every routine on conservative defaults and sharpen them once the scan or you tell me the model.`,
    buyingTriggers: [],
    seasonality: [],
    channelsThatWork: [],
    benchmarks: null,
    avoid: [],
  };
}

// ---------- memories ----------

export function nicheBriefMemories(accountId: string, brief: NicheBrief): NewMemory[] {
  const ref = nicheBriefSourceRef(accountId);
  const mem = (text: string, tags: string[], importance = 3): NewMemory => ({ accountId, kind: "fact", text, source: "scan", sourceRef: ref, confidence: 0.75, importance, tags: [NICHE_TAG, ...tags] });
  const out: NewMemory[] = [];
  if (brief.categoryBand) out.push(mem(`Category band: ${brief.categoryBand} (${BAND_LABEL[brief.categoryBand]}) — ${brief.bandWhy}`, [NICHE_BAND_TAG], 4));
  out.push(mem(`How I read the market: ${brief.summary}`, ["niche_summary"], 4));
  for (const t of brief.buyingTriggers) out.push(mem(`Buying trigger: ${t}`, ["trigger"]));
  for (const s of brief.seasonality) out.push(mem(`Seasonality: ${s}`, ["seasonality"]));
  for (const c of brief.channelsThatWork) out.push(mem(`Channel that works here: ${c}`, ["channel"]));
  for (const a of brief.avoid) out.push(mem(`Avoid in this market: ${a}`, ["avoid"]));
  for (const b of brief.benchmarks ?? []) {
    const range = b.low !== null && b.high !== null && b.low !== b.high ? `${b.low}–${b.high}` : String(b.low ?? b.high);
    out.push(mem(`Benchmark, ${b.metric}: ${range}${b.unit ? ` ${b.unit}` : ""} — ${b.source}`, ["benchmark"]));
  }
  return out;
}

/** Reassemble the brief from the account's niche memories (null when none were written). */
export function nicheBriefFromMemories(memories: Pick<Memory, "text" | "tags">[]): NicheBrief | null {
  const rows = memories.filter((m) => m.tags.includes(NICHE_TAG));
  if (!rows.length) return null;
  const has = (tag: string) => rows.filter((m) => m.tags.includes(tag));
  const after = (text: string, prefix: RegExp) => text.replace(prefix, "").trim();
  const bandRow = has(NICHE_BAND_TAG)[0];
  const bandId = bandRow ? bandRow.text.match(/band:\s*([a-z_]+)/i)?.[1]?.toLowerCase() : undefined;
  const summaryRow = has("niche_summary")[0];
  const benchmarks: NicheBenchmark[] = [];
  for (const m of has("benchmark")) {
    const mm = m.text.match(/^Benchmark, (.+?): ([\d.]+)(?:–([\d.]+))?(?: ([^—]+?))? — (.+)$/);
    if (mm) benchmarks.push({ metric: mm[1], low: Number(mm[2]), high: mm[3] ? Number(mm[3]) : Number(mm[2]), unit: (mm[4] ?? "").trim(), source: mm[5] });
  }
  return {
    categoryBand: isBandId(bandId) ? bandId : null,
    bandWhy: bandRow ? after(bandRow.text, /^Category band: [a-z_]+ \([^)]*\) — /i) : "",
    summary: summaryRow ? after(summaryRow.text, /^How I read the market: /) : "",
    buyingTriggers: has("trigger").map((m) => after(m.text, /^Buying trigger: /)),
    seasonality: has("seasonality").map((m) => after(m.text, /^Seasonality: /)),
    channelsThatWork: has("channel").map((m) => after(m.text, /^Channel that works here: /)),
    benchmarks: benchmarks.length ? benchmarks : null,
    avoid: has("avoid").map((m) => after(m.text, /^Avoid in this market: /)),
  };
}

export async function readNicheBrief(db: DbClient, accountId: string): Promise<NicheBrief | null> {
  const rows = await findBySourceRef(db, accountId, nicheBriefSourceRef(accountId));
  return nicheBriefFromMemories(rows);
}

/** Replace the account's niche memories with this brief (a re-scan supersedes, never duplicates). */
export async function persistNicheBrief(db: DbClient, accountId: string, brief: NicheBrief, opts: BrainOptions = {}): Promise<{ written: number; failed: number }> {
  const old = await findBySourceRef(db, accountId, nicheBriefSourceRef(accountId));
  for (const m of old) await forget(db, m.id, opts);
  const r = await addMemories(db, nicheBriefMemories(accountId, brief), opts);
  return { written: r.results.length, failed: r.failed.length };
}

// ---------- the call ----------

export interface NicheLlm {
  complete(prompt: { system: string; user: string; accountId?: string }): Promise<string>;
}

export interface GenerateOptions extends BrainOptions {
  /** undefined = the router (task niche_brief); null = no model (deterministic brief). */
  llm?: NicheLlm | null;
  /** Playbook cards to reason from; undefined = recallPlaybooks over the DB (or none without one). */
  playbooks?: Playbook[];
  /** Extra resolve inputs (currency, budget) the profile doesn't carry. */
  extra?: Partial<ResolveInput>;
  /** false = don't store (tests, previews). Default true when `db` is given. */
  persist?: boolean;
}

export interface GenerateResult {
  brief: NicheBrief;
  author: "model" | "deterministic";
  stored: { written: number; failed: number } | null;
}

export async function generateNicheBrief(input: { accountId: string; profile: ProfileLike | null; db: DbClient | null }, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const log = opts.log ?? (() => {});
  const bandFirst = pickBand(resolveInputFromProfile(input.profile, opts.extra));
  const playbooks = opts.playbooks ?? (await recallPlaybooks(playbookQuery(input.profile, bandFirst.band), null, 6, { db: input.db }).catch(() => []));
  const ctx = buildNicheContext(input.profile, playbooks, opts.extra);
  const material = renderNicheMaterial(ctx);
  let brief: NicheBrief | null = null;
  let author: GenerateResult["author"] = "deterministic";
  const llm: NicheLlm | null = opts.llm === undefined ? (resolveModel("niche_brief") ? createTextClient("niche_brief", { maxTokens: NICHE_BRIEF_MAX_TOKENS, effort: NICHE_BRIEF_EFFORT, jsonMode: true }, { db: input.db }) : null) : opts.llm;
  if (llm) {
    try {
      const raw = await llm.complete({ system: NICHE_SYSTEM, user: `MATERIAL:\n${material}`, accountId: input.accountId });
      brief = parseNicheBrief(extractJsonObject(raw), ctx, material);
      if (brief) author = "model";
      else log("brain.niche_brief_rejected", { accountId: input.accountId });
    } catch (err) {
      log("brain.niche_brief_llm_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (!brief) brief = deterministicBrief(ctx);
  let stored: GenerateResult["stored"] = null;
  if (input.db && opts.persist !== false) {
    try {
      stored = await persistNicheBrief(input.db, input.accountId, brief, opts);
    } catch (err) {
      log("brain.niche_brief_persist_failed", { accountId: input.accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { brief, author, stored };
}
