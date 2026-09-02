/* The plan's phase-1 channel → what the guided first run needs from it (docs/PRODUCT-EXPERIENCE.md
   "Business types"): which platforms to offer, and the one recommended wave-1 routine.

   Platform suggestions come from the founder, not from a table:
     picked    what they said they use (onboarding steps 2 + 4 → resource_profiles.known_platforms)
     spotted   what the scan evidenced in their site's source (a Shopify storefront, a Klaviyo
               script, a Meta pixel …) — "I spotted this on your site"
     nothing else. Never Shopify for a business with no store; never a card because a table said so.

   Pure over the catalog. The channel itself is the same deterministic ranking that built the
   plan (src/lib/platform/plan.ts scoreChannels), so a server reading resource_profiles and a
   client holding PlatformState land on the same answer. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { ALL_SYSTEMS } from "../platform/catalog";
import { scoreChannels, type ChannelKey, type Posture } from "../platform/plan";
import { fitsBusiness } from "../runtime/availability";
import { CATALOG_SPECS } from "../runtime/catalog-specs";
import type { Platform, RoutineSpec } from "../runtime/types";
import type { BusinessModel, PlatformEvidence } from "../unc/businessType";

/** Card name ↔ slug. */
export const PLATFORM_NAME: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([name, slug]) => [slug, name]));
export const platformName = (slug: string): string => PLATFORM_NAME[slug] ?? slug;

const CONNECTABLE = new Set<string>(Object.values(CONNECTOR_PLATFORMS));

/** resource_profiles.known_platforms entries → connector slugs. Card names map 1:1; the
    onboarding's broader chips map to what they evidence; everything else maps to nothing
    (a Facebook page is not an ads account; "Other" is not a connector). */
export const KNOWN_PLATFORM_SLUGS: Record<string, Platform[]> = {
  ...(Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([name, slug]) => [name, [slug as Platform]])) as Record<string, Platform[]>),
  "Google (Search & Ads)": ["ga4", "search_console", "google_ads"],
  "Email / SMS": [],
  Facebook: [],
  X: [],
  Bing: [],
  Pinterest: [],
  Reddit: [],
  Other: [],
};

/** The email question's answers, as they are recorded in known_platforms. */
export type EmailToolAnswer = "klaviyo" | "mailchimp" | "none";
export const EMAIL_TOOL_LABEL: Record<EmailToolAnswer, string> = { klaviyo: "Klaviyo", mailchimp: "Mailchimp", none: "No email tool yet" };
export const EMAIL_QUESTION = "Which tool sends your email?";

/** What the founder answered about email, read back from known_platforms. */
export function emailToolFrom(knownPlatforms: Iterable<string>): EmailToolAnswer | null {
  const known = new Set(knownPlatforms);
  if (known.has(EMAIL_TOOL_LABEL.klaviyo)) return "klaviyo";
  if (known.has(EMAIL_TOOL_LABEL.mailchimp)) return "mailchimp";
  if (known.has(EMAIL_TOOL_LABEL.none)) return "none";
  return null;
}

/** Connector slugs the founder's known_platforms evidence, in the order they were named, unique. */
export function knownPlatformSlugs(knownPlatforms: Iterable<string>): Platform[] {
  const out: Platform[] = [];
  for (const name of knownPlatforms) for (const slug of KNOWN_PLATFORM_SLUGS[name] ?? []) if (!out.includes(slug)) out.push(slug);
  return out;
}

export interface PhaseOneInput {
  posture: Posture;
  strengths: string[];
  budgetMo: number;
}

/** The channel the agreed plan starts with. */
export function phaseOneChannel(input: PhaseOneInput): ChannelKey {
  return scoreChannels(input.posture, input.strengths ?? [], input.budgetMo)[0].k;
}

const CAT_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.cat]));

/** Wave-1 (draft-only) routines of a channel, catalog order — only those that fit the business when it is known. */
export function waveOneRoutines(channel: ChannelKey, model?: BusinessModel | null): RoutineSpec[] {
  return CATALOG_SPECS.filter((s) => s.wave === 1 && CAT_BY_ID.get(s.id) === channel && fitsBusiness(s, model));
}

/** Everything the routine reads through a real connector (for the "reads …" line). */
export function readPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && CONNECTABLE.has(n.source) && !out.includes(n.source)) out.push(n.source);
  return out;
}

/** The connector platforms phase 1 reads — from the catalog (its wave-1 routines, else every
    routine of the channel), never a hand table. Used only to ORDER the founder's own platforms. */
export function channelReads(channel: ChannelKey): Platform[] {
  const wave1 = CATALOG_SPECS.filter((s) => s.wave === 1 && CAT_BY_ID.get(s.id) === channel);
  const pool = wave1.length ? wave1 : CATALOG_SPECS.filter((s) => CAT_BY_ID.get(s.id) === channel);
  const out: Platform[] = [];
  for (const s of pool) for (const p of readPlatforms(s)) if (!out.includes(p)) out.push(p);
  return out;
}

/** Wave-1 routines that read as well for a business with no store — the recommendation pool when
    the plan's channel has nothing that fits (an Email plan with no store, no email tool yet). */
export const GENERIC_WAVE_ONE: string[] = ["D01-W01", "D01-W03", "D04-W01", "D04-W03", "D03-W01"];

export interface RecommendOptions {
  model?: BusinessModel | null;
  /** resource_profiles.known_platforms — "No email tool yet" / "Mailchimp" keep Klaviyo-reading routines out of the recommendation. */
  knownPlatforms?: Iterable<string>;
}

/** Platforms the founder has said they do NOT have — a routine that must read one is not recommended first. */
export function excludedPlatforms(knownPlatforms: Iterable<string> = []): Platform[] {
  const email = emailToolFrom(knownPlatforms);
  return email === "none" || email === "mailchimp" ? ["klaviyo"] : [];
}

/** The routines the guided step and Home's "Setting up next" draw from, in order: the phase-1
    channel's wave-1 routines that fit the business and read nothing the founder said they lack;
    when the channel has none (an Email plan for a business with no store; Paid ads, whose every
    routine changes live spend), the generic wave-1 routines that fit. */
export function recommendationPool(channel: ChannelKey, opts: RecommendOptions = {}): RoutineSpec[] {
  const excluded = new Set(excludedPlatforms(opts.knownPlatforms ?? []));
  const usable = (s: RoutineSpec) => !readPlatforms(s).some((p) => excluded.has(p));
  const own = waveOneRoutines(channel, opts.model).filter(usable);
  if (own.length) return own;
  return GENERIC_WAVE_ONE.map((id) => CATALOG_SPECS.find((s) => s.id === id)).filter((s): s is RoutineSpec => !!s && fitsBusiness(s, opts.model) && usable(s));
}

/** The one routine the guided step recommends: the first of the pool that isn't on yet; when
    every candidate is on, the first one (already on — the step says so). */
export function recommendedRoutine(channel: ChannelKey, enabledIds: Iterable<string>, opts: RecommendOptions = {}): RoutineSpec | null {
  const on = new Set(enabledIds);
  const pool = recommendationPool(channel, opts);
  return pool.find((s) => !on.has(s.id)) ?? pool[0] ?? null;
}

// ---------- platform suggestions ----------

export interface PlatformSuggestion {
  platform: Platform;
  name: string;
  /** picked = the founder said so (known_platforms); spotted = evidenced in their site's source. */
  source: "picked" | "spotted";
  /** The spotted evidence line ("a Klaviyo signup script on the site"). */
  evidence?: string;
}

export interface SuggestionInput {
  channel: ChannelKey;
  /** resource_profiles.known_platforms. */
  knownPlatforms: Iterable<string>;
  /** business_profiles.profile.platformsSpotted. */
  spotted?: PlatformEvidence[] | null;
}

/** (a) what the founder picked — the ones phase 1 reads first, then the rest; (b) what the scan
    spotted on their site and they didn't already name; (c) nothing else. */
export function suggestPlatforms(input: SuggestionInput): PlatformSuggestion[] {
  const reads = channelReads(input.channel);
  const picked = knownPlatformSlugs(input.knownPlatforms);
  // the founder's own order, with the ones phase 1 doesn't read moved behind the ones it does
  const ordered = [...picked.filter((p) => reads.includes(p)), ...picked.filter((p) => !reads.includes(p))];
  const out: PlatformSuggestion[] = ordered.map((platform) => ({ platform, name: platformName(platform), source: "picked" }));
  for (const s of input.spotted ?? []) {
    if (!CONNECTABLE.has(s.platform) || out.some((o) => o.platform === s.platform)) continue;
    out.push({ platform: s.platform as Platform, name: platformName(s.platform), source: "spotted", evidence: s.evidence });
  }
  return out;
}

export const SUGGESTION_COPY = {
  spotted: "I spotted this on your site",
  picked: "You said you use this",
} as const;

/** The one honest question when phase 1 is Email and nothing says how email is sent: not picked,
    not spotted, not connected, not answered. */
export function emailQuestionNeeded(input: { channel: ChannelKey; knownPlatforms: Iterable<string>; spotted?: PlatformEvidence[] | null; connected?: Iterable<string> }): boolean {
  if (input.channel !== "Email & SMS") return false;
  const known = [...input.knownPlatforms];
  if (emailToolFrom(known) !== null) return false;
  if (knownPlatformSlugs(known).includes("klaviyo")) return false;
  if ((input.spotted ?? []).some((s) => s.platform === "klaviyo")) return false;
  if ([...(input.connected ?? [])].includes("klaviyo")) return false;
  return true;
}

/** The connector a routine cannot honestly run without: its execute platform, else the platform
    its KPI contract reads. Wave-1 routines never execute, so for them it is the KPI read (or
    nothing — a runs-counted draft routine has no hard dependency; its reads fall back to
    research/fixtures and the draft still lands). */
export function requiredPlatform(spec: RoutineSpec): Platform | null {
  const exec = spec.nodes.find((n) => n.kind === "execute");
  if (exec && exec.kind === "execute" && CONNECTABLE.has(exec.platform)) return exec.platform;
  const kpi = spec.kpi;
  if (kpi && kpi.source.kind === "read" && CONNECTABLE.has(kpi.source.platform)) return kpi.source.platform;
  return null;
}

/** One line on what turning the routine on gets the founder (catalog benefit, Unc's register). */
export function routineBenefit(routineId: string): string {
  return ALL_SYSTEMS.find((s) => s.id === routineId)?.benefit ?? "";
}

export function routineName(routineId: string): string {
  return ALL_SYSTEMS.find((s) => s.id === routineId)?.name ?? routineId;
}
