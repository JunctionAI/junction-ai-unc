/* Client Brain — the founder's personalisation profile (account_profiles, migration 0010).

     getProfile(db, accountId)                       → AccountProfile | null
     updateProfile(db, accountId, patch, opts)       shallow-merge each jsonb block; founder_notes replaces
     deriveDecisionStyle(tasteEvents, approvals)     approval_rate, median_decision_hours, holds_by_kind,
                                                     risk_appetite — from the taste ledger + approvals
     refreshDecisionStyle(db, store, accountId)      derive from the store and write it
     renderProfileForPrompt(profile)                 the short "how to work with this founder" block

   Relative imports only (worker-buildable). */

import type { DbClient, Row } from "../db/types";
import { unwrap } from "../db/types";
import { ALL_SYSTEMS } from "../platform/catalog";
import type { ApprovalRecord, TasteEvent } from "../runtime/types";

export type RiskAppetite = "low" | "medium" | "high";

export interface ToneProfile {
  formality?: "casual" | "neutral" | "formal";
  length?: "short" | "medium" | "long";
  humour?: "none" | "light" | "dry";
  directness?: "gentle" | "direct" | "blunt";
}

export interface DecisionStyle {
  /** approved / (approved + held); null until there is a decision. */
  approval_rate: number | null;
  /** created → decided, hours; null until an approval carries decidedAt. */
  median_decision_hours: number | null;
  /** holds per routine category (the catalog's `cat`), e.g. {"Paid": 3}. */
  holds_by_kind: Record<string, number>;
  risk_appetite: RiskAppetite;
  /** Decisions counted (approved + held). */
  decisions: number;
}

export interface CadenceProfile {
  brief_time_local?: string;
  timezone?: string;
  quiet_days?: string[];
}

export interface ChannelsProfile {
  email?: boolean | string;
  whatsapp?: boolean | string;
  slack?: boolean | string;
}

export interface AccountProfile {
  accountId: string;
  tone: ToneProfile;
  decisionStyle: Partial<DecisionStyle>;
  cadence: CadenceProfile;
  channels: ChannelsProfile;
  founderNotes: string | null;
  updatedAt: string;
}

export interface ProfilePatch {
  tone?: ToneProfile;
  decisionStyle?: Partial<DecisionStyle>;
  cadence?: CadenceProfile;
  channels?: ChannelsProfile;
  founderNotes?: string | null;
}

export const FOUNDER_NOTES_MAX = 2000;
/** Below this many decisions the appetite is reported as medium (unknown), never low/high. */
export const RISK_MIN_DECISIONS = 3;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function rowToProfile(r: Row): AccountProfile {
  return {
    accountId: String(r.account_id),
    tone: obj(r.tone) as ToneProfile,
    decisionStyle: obj(r.decision_style) as Partial<DecisionStyle>,
    cadence: obj(r.cadence) as CadenceProfile,
    channels: obj(r.channels) as ChannelsProfile,
    founderNotes: (r.founder_notes as string | null) ?? null,
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function getProfile(db: DbClient, accountId: string): Promise<AccountProfile | null> {
  const r = await unwrap<Row | null>("account_profiles.get", db.from("account_profiles").select("account_id, tone, decision_style, cadence, channels, founder_notes, updated_at").eq("account_id", accountId).maybeSingle());
  return r ? rowToProfile(r) : null;
}

export async function updateProfile(db: DbClient, accountId: string, patch: ProfilePatch, opts: { now?: () => Date } = {}): Promise<AccountProfile> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const existing = await getProfile(db, accountId);
  const next: AccountProfile = {
    accountId,
    tone: { ...(existing?.tone ?? {}), ...(patch.tone ?? {}) },
    decisionStyle: { ...(existing?.decisionStyle ?? {}), ...(patch.decisionStyle ?? {}) },
    cadence: { ...(existing?.cadence ?? {}), ...(patch.cadence ?? {}) },
    channels: { ...(existing?.channels ?? {}), ...(patch.channels ?? {}) },
    founderNotes: patch.founderNotes === undefined ? (existing?.founderNotes ?? null) : patch.founderNotes === null ? null : patch.founderNotes.trim().slice(0, FOUNDER_NOTES_MAX) || null,
    updatedAt: now,
  };
  await unwrap(
    "account_profiles.upsert",
    db.from("account_profiles").upsert({ account_id: accountId, tone: next.tone, decision_style: next.decisionStyle, cadence: next.cadence, channels: next.channels, founder_notes: next.founderNotes, updated_at: now }, { onConflict: "account_id" }),
  );
  return next;
}

// ---------- decision style ----------

const CAT_BY_ROUTINE = new Map(ALL_SYSTEMS.map((s) => [s.id, s.cat]));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function riskAppetite(approvalRate: number | null, decisions: number): RiskAppetite {
  if (approvalRate === null || decisions < RISK_MIN_DECISIONS) return "medium";
  if (approvalRate >= 0.8) return "high";
  if (approvalRate >= 0.5) return "medium";
  return "low";
}

/** From the taste ledger (approved/held actions) — falling back to approval rows when the
    ledger is empty — plus decision latency from approvals that carry decidedAt. */
export function deriveDecisionStyle(tasteEvents: Pick<TasteEvent, "action" | "routineId">[], approvals: Pick<ApprovalRecord, "status" | "routineId" | "createdAt" | "decidedAt">[]): DecisionStyle {
  const decided = tasteEvents.filter((e) => e.action === "approved" || e.action === "held");
  const fromLedger = decided.length > 0;
  const rows = fromLedger ? decided.map((e) => ({ held: e.action === "held", routineId: e.routineId })) : approvals.filter((a) => a.status === "approved" || a.status === "held").map((a) => ({ held: a.status === "held", routineId: a.routineId }));
  const decisions = rows.length;
  const held = rows.filter((r) => r.held).length;
  const approval_rate = decisions ? Math.round(((decisions - held) / decisions) * 100) / 100 : null;
  const holds_by_kind: Record<string, number> = {};
  for (const r of rows) {
    if (!r.held) continue;
    const k = (r.routineId && CAT_BY_ROUTINE.get(r.routineId)) || r.routineId || "other";
    holds_by_kind[k] = (holds_by_kind[k] ?? 0) + 1;
  }
  const hours = approvals
    .filter((a) => a.decidedAt && a.createdAt)
    .map((a) => (new Date(a.decidedAt!).getTime() - new Date(a.createdAt).getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const med = median(hours);
  return { approval_rate, median_decision_hours: med === null ? null : Math.round(med * 10) / 10, holds_by_kind, risk_appetite: riskAppetite(approval_rate, decisions), decisions };
}

/** The slice of the runtime Store this needs (kept structural so any store — or a test stub — fits). */
export interface DecisionSource {
  listTasteEvents(accountId: string, opts?: { limit?: number }): Promise<TasteEvent[]>;
  listApprovals(accountId: string, status?: ApprovalRecord["status"]): Promise<ApprovalRecord[]>;
}

export async function refreshDecisionStyle(db: DbClient, store: DecisionSource, accountId: string, opts: { now?: () => Date } = {}): Promise<DecisionStyle> {
  const [events, approved, held] = await Promise.all([store.listTasteEvents(accountId, { limit: 500 }), store.listApprovals(accountId, "approved"), store.listApprovals(accountId, "held")]);
  const style = deriveDecisionStyle(events, [...approved, ...held]);
  await updateProfile(db, accountId, { decisionStyle: style }, opts);
  return style;
}

// ---------- prompt rendering ----------

const pct = (n: number) => `${Math.round(n * 100)}%`;

function decisionLine(d: Partial<DecisionStyle>): string | null {
  const parts: string[] = [];
  if (typeof d.approval_rate === "number" && (d.decisions ?? 0) > 0) parts.push(`approves ${pct(d.approval_rate)} of proposals (${d.decisions} decision${d.decisions === 1 ? "" : "s"} so far)`);
  if (typeof d.median_decision_hours === "number") parts.push(`usually decides within ${d.median_decision_hours < 1 ? "the hour" : `${Math.round(d.median_decision_hours)}h`}`);
  const holds = Object.entries(d.holds_by_kind ?? {}).sort((a, b) => b[1] - a[1]);
  if (holds.length) parts.push(`holds mostly on ${holds
    .slice(0, 3)
    .map(([k, n]) => `${k} (${n})`)
    .join(", ")}`);
  if (d.risk_appetite) parts.push(`risk appetite ${d.risk_appetite}`);
  return parts.length ? `Decisions: ${parts.join("; ")}.` : null;
}

function toneLine(t: ToneProfile): string | null {
  const parts: string[] = [];
  if (t.formality) parts.push(`${t.formality} register`);
  if (t.length) parts.push(`${t.length} replies`);
  if (t.directness) parts.push(`${t.directness} feedback`);
  if (t.humour && t.humour !== "none") parts.push(`${t.humour} humour is welcome`);
  else if (t.humour === "none") parts.push("no jokes");
  return parts.length ? `Tone: ${parts.join(", ")}.` : null;
}

function cadenceLine(c: CadenceProfile): string | null {
  const parts: string[] = [];
  if (c.brief_time_local) parts.push(`daily brief at ${c.brief_time_local}${c.timezone ? ` ${c.timezone}` : ""}`);
  else if (c.timezone) parts.push(`timezone ${c.timezone}`);
  if (c.quiet_days?.length) parts.push(`quiet on ${c.quiet_days.join(", ")}`);
  return parts.length ? `Cadence: ${parts.join("; ")}.` : null;
}

function channelsLine(ch: ChannelsProfile): string | null {
  const on = (Object.keys(ch) as (keyof ChannelsProfile)[]).filter((k) => !!ch[k]);
  return on.length ? `Reach them on ${on.map((k) => (typeof ch[k] === "string" ? `${k} (${ch[k]})` : k)).join(", ")}.` : null;
}

/** "" when the profile is empty. Founder notes are quoted verbatim — they are the founder's own words. */
export function renderProfileForPrompt(profile: AccountProfile | null): string {
  if (!profile) return "";
  const lines = [toneLine(profile.tone), decisionLine(profile.decisionStyle), cadenceLine(profile.cadence), channelsLine(profile.channels)].filter((l): l is string => !!l);
  if (profile.founderNotes?.trim()) lines.push(`In their own words: "${profile.founderNotes.trim()}"`);
  return lines.join("\n");
}
