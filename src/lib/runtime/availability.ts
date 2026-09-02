/* What a routine can honestly do for THIS account right now — computed from its spec
   (catalog-specs.ts) and the account's connected platforms. Pure.

     wave_2                    the chain mutates (execute node): every executor refuses today
     needs_connector:<p>       a read platform with a connector card is not connected
     ready                     launch wave (wave 1), every read answerable — drafts only
     draft_only                wave-2 chain without a mutation (research / notify): runnable,
                               hands over drafts, not in the launch wave

   Research sources (web, llm_search, calendar) never gate a routine; they have no card. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import type { Platform, RoutineSpec } from "./types";

export type Availability = "ready" | "draft_only" | "wave_2" | `needs_connector:${string}`;

const CARD_PLATFORMS = new Set(Object.values(CONNECTOR_PLATFORMS));

/** Read platforms that have a connector card, in chain order, unique. */
export function readPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && CARD_PLATFORMS.has(n.source) && !out.includes(n.source)) out.push(n.source);
  return out;
}

export function routineAvailability(spec: RoutineSpec, connected: Iterable<string>): Availability {
  if (spec.mutates) return "wave_2";
  const have = new Set(connected);
  const missing = readPlatforms(spec).find((p) => !have.has(p));
  if (missing) return `needs_connector:${missing}`;
  return spec.wave === 1 ? "ready" : "draft_only";
}

export function missingPlatform(a: Availability): string | null {
  return a.startsWith("needs_connector:") ? a.slice("needs_connector:".length) : null;
}

const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

/** The one honest line under a routine row (the copy floor in docs/PRODUCT-EXPERIENCE.md). */
export function availabilityCopy(a: Availability): string {
  const p = missingPlatform(a);
  if (p) return `needs ${NAME_BY_PLATFORM[p] ?? p} connected`;
  switch (a) {
    case "ready":
      return "drafts only — nothing goes out without you";
    case "draft_only":
      return "draft-only for now";
    case "wave_2":
      return "changes things on a platform — coming in wave 2, off until then";
    default:
      return "";
  }
}

export function canEnable(a: Availability): boolean {
  return a === "ready" || a === "draft_only";
}
