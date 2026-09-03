/* What a routine can honestly do for THIS account right now — computed from its spec
   (catalog-specs.ts), the account's connected platforms and, when known, the kind of
   business it is. Pure.

     not_for_business_type     the routine is built around a store (cart, orders, post-purchase
                               flows) and this business has none — hidden from "Recommended",
                               shown in the library with the honest line
     approval_gated            the chain mutates (execute node): runnable when required reads
                               are connected. Dry-run shapes the exact request; live apply still
                               waits on an approval (and LIVE_MODE_ENABLED).
     needs_connector:<p>       a REQUIRED read platform (or one the skill's stated minimum
                               names) with a connector card is not connected
     ready                     launch wave (wave 1), every required read answerable — drafts only
     draft_only                wave-2 chain without a mutation (research / notify): runnable,
                               hands over drafts, not in the launch wave

   Optional reads (ReadNode.optional — the wave-1 drafting routines) and the skill minimum's
   `helpful` platforms never gate: a founder with only a site profile still gets a draft. They
   surface as the hint "Better with Gorgias, LinkedIn connected" (betterWith / betterWithCopy),
   which is a nudge, never a block. Research sources (web, llm_search, calendar) never gate a
   routine; they have no card. An unknown business type (nothing scanned, nothing said) never
   hides anything. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { hasStore, modelUnknown, type BusinessModel } from "../unc/businessType";
import type { Platform, RoutineSpec } from "./types";

export type Availability = "ready" | "draft_only" | "approval_gated" | "not_for_business_type" | `needs_connector:${string}`;

const CARD_PLATFORMS = new Set(Object.values(CONNECTOR_PLATFORMS));

/** Routines that only make sense with a store: carts, orders, post-purchase flows, delivery-timed
    reviews. Everything else in the catalog reads as well for a services, SaaS, local, creator or
    B2B business (its Shopify reads fall back to research / the site when there is no store). */
export const STORE_ONLY_ROUTINES: Record<string, string> = {
  "D05-W01": "Welcome flow tuning turns first orders into second orders",
  "D05-W02": "Abandoned cart recovery needs a cart",
  "D05-W03": "Segmentation refresh cuts customers by orders and spend",
  "D05-W04": "Winback works from order history",
  "D05-W05": "Post-purchase education follows an order",
  "D05-W06": "Review requests are timed from delivery",
  "D05-W07": "Campaign calendar prep plans around order seasonality and product launches",
};

export const NOT_FOR_STORE_LESS_COPY = "For stores — not your model";

/** The honest line when the routine is not for this business, else null. Unknown ⇒ null. */
export function notForBusinessType(spec: Pick<RoutineSpec, "id">, model: BusinessModel | null | undefined): string | null {
  if (!STORE_ONLY_ROUTINES[spec.id]) return null;
  if (modelUnknown(model) || hasStore(model)) return null;
  return NOT_FOR_STORE_LESS_COPY;
}

/** True when the routine fits the business (or nothing is known about it). */
export const fitsBusiness = (spec: Pick<RoutineSpec, "id">, model: BusinessModel | null | undefined): boolean => notForBusinessType(spec, model) === null;

/** Every read platform that has a connector card, in chain order, unique (required and optional). */
export function readPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && CARD_PLATFORMS.has(n.source) && !out.includes(n.source)) out.push(n.source);
  return out;
}

/** The card platforms that GATE the routine: its required (non-optional) reads plus whatever the
    skill's stated minimum names, in chain order, unique. */
export function requiredPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && !n.optional && CARD_PLATFORMS.has(n.source) && !out.includes(n.source)) out.push(n.source);
  for (const p of spec.minimum?.platforms ?? []) if (CARD_PLATFORMS.has(p) && !out.includes(p)) out.push(p);
  return out;
}

/** The card platforms that HELP but never gate: optional reads plus the minimum's `helpful`,
    minus anything required, in chain order, unique. */
export function helpfulPlatforms(spec: RoutineSpec): Platform[] {
  const required = new Set(requiredPlatforms(spec));
  const out: Platform[] = [];
  for (const p of [...readPlatforms(spec), ...(spec.minimum?.helpful ?? [])]) if (CARD_PLATFORMS.has(p) && !required.has(p) && !out.includes(p)) out.push(p);
  return out;
}

export function routineAvailability(spec: RoutineSpec, connected: Iterable<string>, model?: BusinessModel | null): Availability {
  if (!fitsBusiness(spec, model)) return "not_for_business_type";
  const have = new Set(connected);
  const missing = requiredPlatforms(spec).find((p) => !have.has(p));
  if (missing) return `needs_connector:${missing}`;
  if (spec.mutates) return "approval_gated";
  return spec.wave === 1 ? "ready" : "draft_only";
}

/** Helpful platforms not yet connected — the "Better with …" hint. Empty when the routine is
    blocked for another reason (a hint under a block would read as a second block). */
export function betterWith(spec: RoutineSpec, connected: Iterable<string>, model?: BusinessModel | null): Platform[] {
  if (!canEnable(routineAvailability(spec, connected, model))) return [];
  const have = new Set(connected);
  return helpfulPlatforms(spec).filter((p) => !have.has(p));
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
    case "approval_gated":
      return "I'll prepare the exact change and wait for you";
    case "not_for_business_type":
      return NOT_FOR_STORE_LESS_COPY;
    default:
      return "";
  }
}

export function canEnable(a: Availability): boolean {
  return a === "ready" || a === "draft_only" || a === "approval_gated";
}

/** The hint line for helpful-but-missing platforms (the copy floor in docs/PRODUCT-EXPERIENCE.md);
    null with nothing to suggest. A nudge, never a block. */
export function betterWithCopy(platforms: readonly string[]): string | null {
  if (!platforms.length) return null;
  return `Better with ${platforms.map((p) => NAME_BY_PLATFORM[p] ?? p).join(", ")} connected`;
}
