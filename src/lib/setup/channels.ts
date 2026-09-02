/* The plan's phase-1 channel → what the guided first run needs from it (docs/PRODUCT-EXPERIENCE.md):
     the platforms to connect (only those), and the one recommended wave-1 routine.

   Pure over the catalog. The channel itself is the same deterministic ranking that built the
   plan (src/lib/platform/plan.ts scoreChannels), so a server reading resource_profiles and a
   client holding PlatformState land on the same answer. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { ALL_SYSTEMS } from "../platform/catalog";
import { scoreChannels, type ChannelKey, type Posture } from "../platform/plan";
import { CATALOG_SPECS } from "../runtime/catalog-specs";
import type { Platform, RoutineSpec } from "../runtime/types";

/** The platforms phase 1 reads, per channel — the spec's table, first one is the anchor. */
export const CHANNEL_PLATFORMS: Record<ChannelKey, Platform[]> = {
  Content: ["instagram", "shopify"],
  "Email & SMS": ["klaviyo", "shopify"],
  "Paid ads": ["meta_ads", "shopify"],
  SEO: ["ga4", "search_console"],
  Sales: ["hubspot", "gmail"],
};

/** Card name ↔ slug. */
export const PLATFORM_NAME: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([name, slug]) => [slug, name]));
export const platformName = (slug: string): string => PLATFORM_NAME[slug] ?? slug;

export interface PhaseOneInput {
  posture: Posture;
  strengths: string[];
  budgetMo: number;
}

/** The channel the agreed plan starts with. */
export function phaseOneChannel(input: PhaseOneInput): ChannelKey {
  return scoreChannels(input.posture, input.strengths ?? [], input.budgetMo)[0].k;
}

/** Only the platforms phase 1 needs; a platform the founder said they use (onboarding step 2,
    resource_profiles.known_platforms) that phase 1 also reads is kept in front. */
export function phaseOnePlatforms(channel: ChannelKey): Platform[] {
  return [...CHANNEL_PLATFORMS[channel]];
}

/** Wave-1 (draft-only) routines of a channel, catalog order. */
export function waveOneRoutines(channel: ChannelKey): RoutineSpec[] {
  const cat = new Map(ALL_SYSTEMS.map((s) => [s.id, s.cat]));
  return CATALOG_SPECS.filter((s) => s.wave === 1 && cat.get(s.id) === channel);
}

/** The one routine the guided step recommends: the first wave-1 routine of the phase-1 channel
    the founder hasn't enabled; when every one is on, the first one (already on — the step says so). */
export function recommendedRoutine(channel: ChannelKey, enabledIds: Iterable<string>): RoutineSpec | null {
  const on = new Set(enabledIds);
  const wave1 = waveOneRoutines(channel);
  return wave1.find((s) => !on.has(s.id)) ?? wave1[0] ?? null;
}

const CONNECTABLE = new Set<string>(Object.values(CONNECTOR_PLATFORMS));

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

/** Everything the routine reads through a real connector (for the "reads …" line). */
export function readPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && CONNECTABLE.has(n.source) && !out.includes(n.source)) out.push(n.source);
  return out;
}

/** One line on what turning the routine on gets the founder (catalog benefit, Unc's register). */
export function routineBenefit(routineId: string): string {
  return ALL_SYSTEMS.find((s) => s.id === routineId)?.benefit ?? "";
}

export function routineName(routineId: string): string {
  return ALL_SYSTEMS.find((s) => s.id === routineId)?.name ?? routineId;
}
