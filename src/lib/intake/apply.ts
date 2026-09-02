/* applyIntake — turn one validated intake payload into rows (service role; the caller has
   already authenticated the key and resolved the account).

   What is written, and the rules (docs/N8N-INTAKE.md §What gets written):
     memories            one row per field/item, kind mapped per field, source 'intake';
                         confidence 0.9 for structured fields, 0.6 for free text; identical text
                         is skipped (memoryWriter dedupe)
     business_profiles   profile jsonb MERGED: incoming non-null values win, nulls never
                         overwrite, lists are unioned; scan_status untouched
     goals               inserted only when the account has NO goal yet (category 'revenue',
                         tier 'governing'); otherwise a warning — the founder's goal is theirs
     resource_profiles   merged the same way (budget/hours only when given; socials + platforms
                         unioned; website only when empty)
     team_members        contacts + resources.team appended when the name is new
     connectors          'disconnected' row per platform (external_ref as the hint) when none
                         exists; an existing row keeps its status, only a missing external_ref
                         is filled in
     intake_events       one audit row: the payload, the outcome (counts, warnings, the
                         idempotency-key hash) — the same row answers a replayed request */

import { unwrap, type DbClient } from "../db/types";
import type { MemoryInput } from "./memoryWriter";
import { writeMemories } from "./memoryWriter";
import type { IntakePayload } from "./schema";

export interface IntakeWritten {
  memories: number;
  memories_skipped: number;
  profile_fields: number;
  goal: 0 | 1;
  resource_fields: number;
  team_members: number;
  connectors: number;
}

export interface IntakeOutcome {
  ok: true;
  event_id: string;
  written: IntakeWritten;
  warnings: string[];
  /** true when an Idempotency-Key matched an earlier event: nothing was written again. */
  replayed: boolean;
}

export interface ApplyOptions {
  keyId: string | null;
  now?: Date;
  idempotencyKeyHash?: string | null;
  warnings?: string[];
}

const STRUCTURED = 0.9;
const FREE_TEXT = 0.6;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const union = (a: unknown, b: string[] | undefined): string[] => {
  const out: string[] = Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  for (const s of b ?? []) if (!out.includes(s)) out.push(s);
  return out;
};

/** Memories derived from the payload — pure, so the mapping is testable without a database. */
export function memoriesFromIntake(p: IntakePayload, eventRef: string | null): MemoryInput[] {
  const out: MemoryInput[] = [];
  const add = (kind: MemoryInput["kind"], text: string, confidence: number, extra: Partial<MemoryInput> = {}) => out.push({ kind, text, source: "intake", confidence, importance: 3, source_ref: eventRef, ...extra });
  const b = p.business;
  if (b) {
    if (b.name) add("fact", `The business is called ${b.name}.`, STRUCTURED, { tags: ["business"], importance: 4 });
    if (b.website) add("fact", `Website: ${b.website}`, STRUCTURED, { tags: ["business"] });
    if (b.socials?.length) add("fact", `Social accounts: ${b.socials.join(", ")}`, STRUCTURED, { tags: ["business", "social"] });
    if (b.category) add("fact", `Category: ${b.category}`, STRUCTURED, { tags: ["business"] });
    if (b.products?.length) add("fact", `Products: ${b.products.join(", ")}`, STRUCTURED, { tags: ["business", "products"], importance: 4 });
    if (b.market) add("fact", `Market: ${b.market}`, STRUCTURED, { tags: ["business", "market"] });
    if (b.voice_notes) add("preference", `Voice notes from the founder: ${b.voice_notes}`, FREE_TEXT, { tags: ["voice"], importance: 4 });
  }
  const g = p.goal;
  if (g?.title) {
    const bits = [g.title];
    if (g.baseline !== undefined) bits.push(`baseline ${g.baseline}${g.currency ? ` ${g.currency}` : ""}`);
    if (g.deadline) bits.push(`by ${g.deadline}`);
    add("decision", `Goal: ${bits.join(" · ")}`, STRUCTURED, { tags: ["goal"], importance: 5 });
  }
  const r = p.resources;
  if (r) {
    if (r.budget_monthly !== undefined) add("fact", `Monthly growth budget: ${r.budget_monthly}${g?.currency ? ` ${g.currency}` : ""}`, STRUCTURED, { tags: ["resources", "budget"], importance: 4 });
    if (r.hours_weekly !== undefined) add("fact", `Founder hours available per week: ${r.hours_weekly}`, STRUCTURED, { tags: ["resources"] });
    for (const t of r.team ?? []) add("relationship", `${t.name}${t.role ? ` — ${t.role}` : ""} is on the team.`, STRUCTURED, { tags: ["team"] });
  }
  for (const pl of p.platforms ?? []) add("fact", `Uses ${pl.platform}${pl.external_ref ? ` (${pl.external_ref})` : ""}.`, STRUCTURED, { tags: ["platforms"] });
  for (const c of p.contacts ?? []) add("relationship", `${c.name}${c.role ? ` — ${c.role}` : ""}${c.email ? ` (${c.email})` : ""}`, STRUCTURED, { tags: ["contacts"] });
  for (const f of p.facts ?? []) add("fact", f, FREE_TEXT);
  for (const s of p.preferences ?? []) add("preference", s, FREE_TEXT, { importance: 4 });
  for (const s of p.constraints ?? []) add("constraint", s, FREE_TEXT, { importance: 4 });
  for (const e of p.events ?? []) add("event", e.text, FREE_TEXT, { happens_at: e.at ?? null });
  if (p.notes) add("fact", p.notes, FREE_TEXT, { tags: ["intake_notes"] });
  return out;
}

async function findReplay(db: DbClient, accountId: string, hash: string): Promise<IntakeOutcome | null> {
  const rows = await unwrap<{ id: string; outcome: Record<string, unknown> }[]>(
    "intake_events.replay",
    db.from("intake_events").select("id, outcome").eq("account_id", accountId).order("created_at", { ascending: false }).limit(200),
  );
  for (const r of rows ?? []) {
    const o = r.outcome ?? {};
    if (o.idempotency_key_hash === hash && isObj(o.written)) return { ok: true, event_id: r.id, written: o.written as unknown as IntakeWritten, warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [], replayed: true };
  }
  return null;
}

async function mergeBusinessProfile(db: DbClient, accountId: string, p: IntakePayload, now: string): Promise<number> {
  const b = p.business;
  if (!b) return 0;
  const existing = await unwrap<{ profile: Record<string, unknown> } | null>("business_profiles.get", db.from("business_profiles").select("profile").eq("account_id", accountId).maybeSingle());
  const prof: Record<string, unknown> = { ...(existing?.profile ?? {}) };
  let n = 0;
  const set = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    prof[k] = v;
    n++;
  };
  set("name", b.name);
  set("category", b.category);
  if (b.products?.length) {
    prof.products = union(prof.products, b.products);
    n++;
  }
  if (b.market) {
    const m = isObj(prof.market) ? { ...prof.market } : {};
    m.region = b.market;
    prof.market = m;
    n++;
  }
  if (b.voice_notes) {
    const v = isObj(prof.voice) ? { ...prof.voice } : {};
    v.tone = b.voice_notes;
    if (!Array.isArray(v.phrases)) v.phrases = [];
    prof.voice = v;
    n++;
  }
  const sources = [...(b.website ? [b.website] : []), ...(b.socials ?? [])];
  if (sources.length) {
    prof.sources = union(prof.sources, sources);
    n++;
  }
  if (!n) return 0;
  const row: Record<string, unknown> = existing ? { account_id: accountId, profile: prof, updated_at: now } : { account_id: accountId, profile: prof, scan_status: "pending", updated_at: now };
  await unwrap("business_profiles.upsert", db.from("business_profiles").upsert(row, { onConflict: "account_id" }));
  return n;
}

async function upsertGoalIfNone(db: DbClient, accountId: string, p: IntakePayload, now: string, warnings: string[]): Promise<0 | 1> {
  const g = p.goal;
  if (!g?.title) return 0;
  const existing = await unwrap<{ id: string }[]>("goals.select", db.from("goals").select("id").eq("account_id", accountId).limit(1));
  if ((existing ?? []).length) {
    warnings.push("goal: the account already has a goal — left as the founder set it (recorded as a memory only)");
    return 0;
  }
  await unwrap("goals.insert", db.from("goals").insert({ account_id: accountId, category: "revenue", tier: "governing", title: g.title, baseline: g.baseline ?? null, deadline: g.deadline ?? null, created_at: now, updated_at: now }));
  if (g.currency) await unwrap("accounts.currency", db.from("accounts").update({ currency: g.currency }).eq("id", accountId));
  return 1;
}

async function mergeResources(db: DbClient, accountId: string, p: IntakePayload, now: string): Promise<number> {
  const r = p.resources;
  const b = p.business;
  const platforms = (p.platforms ?? []).map((x) => x.platform);
  if (!r && !b?.website && !b?.socials?.length && !platforms.length) return 0;
  const existing = await unwrap<Record<string, unknown> | null>(
    "resource_profiles.get",
    db.from("resource_profiles").select("account_id, budget_monthly, hours_weekly, website, socials, known_platforms").eq("account_id", accountId).maybeSingle(),
  );
  const row: Record<string, unknown> = { account_id: accountId, updated_at: now };
  let n = 0;
  if (r?.budget_monthly !== undefined) {
    row.budget_monthly = r.budget_monthly;
    n++;
  }
  if (r?.hours_weekly !== undefined) {
    row.hours_weekly = r.hours_weekly;
    n++;
  }
  if (b?.website && !existing?.website) {
    row.website = b.website;
    n++;
  }
  if (b?.socials?.length) {
    row.socials = union(existing?.socials, b.socials);
    n++;
  }
  if (platforms.length) {
    row.known_platforms = union(existing?.known_platforms, platforms);
    n++;
  }
  if (!n) return 0;
  await unwrap("resource_profiles.upsert", db.from("resource_profiles").upsert(row, { onConflict: "account_id" }));
  return n;
}

async function appendTeam(db: DbClient, accountId: string, p: IntakePayload, now: string): Promise<number> {
  const people: { name: string; role: string }[] = [];
  for (const t of p.resources?.team ?? []) people.push({ name: t.name, role: t.role ?? "Marketing" });
  for (const c of p.contacts ?? []) people.push({ name: c.name, role: c.role ?? "Contact" });
  if (!people.length) return 0;
  const existing = await unwrap<{ name: string; position: number }[]>("team_members.select", db.from("team_members").select("name, position").eq("account_id", accountId));
  const known = new Set((existing ?? []).map((m) => m.name.trim().toLowerCase()));
  let position = (existing ?? []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
  const rows: Record<string, unknown>[] = [];
  for (const person of people) {
    const key = person.name.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    rows.push({ account_id: accountId, position: position++, name: person.name, role: person.role, created_at: now });
  }
  if (rows.length) await unwrap("team_members.insert", db.from("team_members").insert(rows));
  return rows.length;
}

async function hintConnectors(db: DbClient, accountId: string, p: IntakePayload, now: string): Promise<number> {
  const platforms = p.platforms ?? [];
  if (!platforms.length) return 0;
  const existing = await unwrap<{ id: string; platform: string; external_ref: string | null }[]>("connectors.select", db.from("connectors").select("id, platform, external_ref").eq("account_id", accountId));
  const byPlatform = new Map((existing ?? []).map((c) => [c.platform, c]));
  let n = 0;
  const inserts: Record<string, unknown>[] = [];
  for (const pl of platforms) {
    const cur = byPlatform.get(pl.platform);
    if (!cur) {
      if (inserts.some((i) => i.platform === pl.platform)) continue;
      inserts.push({ account_id: accountId, platform: pl.platform, status: "disconnected", external_ref: pl.external_ref ?? null, created_at: now });
      n++;
    } else if (!cur.external_ref && pl.external_ref) {
      await unwrap("connectors.hint", db.from("connectors").update({ external_ref: pl.external_ref }).eq("id", cur.id));
      n++;
    }
  }
  if (inserts.length) await unwrap("connectors.insert", db.from("connectors").insert(inserts));
  return n;
}

export async function applyIntake(db: DbClient, accountId: string, payload: IntakePayload, opts: ApplyOptions): Promise<IntakeOutcome> {
  const now = (opts.now ?? new Date()).toISOString();
  const warnings = [...(opts.warnings ?? [])];
  if (opts.idempotencyKeyHash) {
    const replay = await findReplay(db, accountId, opts.idempotencyKeyHash);
    if (replay) return replay;
  }

  // the audit row first, so every memory can point at it
  const event = await unwrap<{ id: string }>("intake_events.insert", db.from("intake_events").insert({ account_id: accountId, key_id: opts.keyId, payload: payload as unknown as Record<string, unknown>, outcome: { status: "in_progress" }, created_at: now }).select("id").single());

  const mem = await writeMemories(db, accountId, memoriesFromIntake(payload, event.id), new Date(now));
  const written: IntakeWritten = {
    memories: mem.inserted.length,
    memories_skipped: mem.skipped,
    profile_fields: await mergeBusinessProfile(db, accountId, payload, now),
    goal: await upsertGoalIfNone(db, accountId, payload, now, warnings),
    resource_fields: await mergeResources(db, accountId, payload, now),
    team_members: await appendTeam(db, accountId, payload, now),
    connectors: await hintConnectors(db, accountId, payload, now),
  };
  if (mem.skipped) warnings.push(`memories: ${mem.skipped} already known (identical text) — skipped`);

  const outcome: Record<string, unknown> = { status: "done", written, warnings };
  if (opts.idempotencyKeyHash) outcome.idempotency_key_hash = opts.idempotencyKeyHash;
  await unwrap("intake_events.outcome", db.from("intake_events").update({ outcome }).eq("id", event.id));
  return { ok: true, event_id: event.id, written, warnings, replayed: false };
}
