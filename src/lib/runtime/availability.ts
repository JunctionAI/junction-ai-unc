/* What a routine can honestly do for THIS account right now — computed from its spec
   (catalog-specs.ts), the account's connected platforms and, when known, the kind of
   business it is. Pure.

     not_for_business_type     the routine is built around a store (cart, orders, post-purchase
                               flows) and this business has none — hidden from "Recommended",
                               shown in the library with the honest line
     wave_2                    the chain mutates (execute node): every executor refuses today
     needs_connector:<p>       a read platform with a connector card is not connected
     ready                     launch wave (wave 1), every read answerable — drafts only
     draft_only                wave-2 chain without a mutation (research / notify): runnable,
                               hands over drafts, not in the launch wave

   Research sources (web, llm_search, calendar) never gate a routine; they have no card.
   An unknown business type (nothing scanned, nothing said) never hides anything. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { hasStore, modelUnknown, type BusinessModel } from "../unc/businessType";
import type { Platform, RoutineSpec } from "./types";

export type Availability = "ready" | "draft_only" | "wave_2" | "not_for_business_type" | `needs_connector:${string}`;

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

/** Read platforms that have a connector card, in chain order, unique. */
export function readPlatforms(spec: RoutineSpec): Platform[] {
  const out: Platform[] = [];
  for (const n of spec.nodes) if (n.kind === "read" && CARD_PLATFORMS.has(n.source) && !out.includes(n.source)) out.push(n.source);
  return out;
}

export function routineAvailability(spec: RoutineSpec, connected: Iterable<string>, model?: BusinessModel | null): Availability {
  if (!fitsBusiness(spec, model)) return "not_for_business_type";
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
    case "not_for_business_type":
      return NOT_FOR_STORE_LESS_COPY;
    default:
      return "";
  }
}

export function canEnable(a: Availability): boolean {
  return a === "ready" || a === "draft_only";
}
