/* What a routine can honestly do for THIS account right now — computed from its spec
   (catalog-specs.ts), the account's connected platforms and, when known, the kind of
   business it is. Pure.

     not_for_business_type     the routine is built around a store (cart, orders, post-purchase
                               flows) and this business has none — hidden from "Recommended",
                               shown in the library with the honest line
     approval_gated            the chain mutates (execute node): runnable when required reads
                               are connected. Dry-run shapes the exact request; live apply still
                               waits on an approval (and LIVE_MODE_ENABLED).
     unavailable:<p>:<r>[:c]   a REQUIRED platform/resource read, or an exact field/filter/metric
                               contract, is not implemented by the production worker yet;
                               connecting an account would not fix it
     needs_connector:<p>       a supported REQUIRED read platform (or one the skill's stated
                               minimum names) with a connector card is not connected
     ready                     launch wave (wave 1), every required read answerable — drafts only
     draft_only                wave-2 chain without a mutation (research / notify): runnable,
                               hands over drafts, not in the launch wave

   Optional reads (ReadNode.optional — the wave-1 drafting routines) and the skill minimum's
   `helpful` platforms never gate: a founder with only a site profile still gets a draft. A
   "Better with ... connected" hint is only shown when the worker can actually read that
   platform/resource. Required research sources (web, llm_search, calendar) do gate even though
   they have no connector card: otherwise the UI would advertise a routine the worker is certain
   to fail. An unknown business type (nothing scanned, nothing said) never hides anything. */

import { CONNECTOR_PLATFORMS } from "../db/mapping";
import { hasStore, modelUnknown, type BusinessModel } from "../unc/businessType";
import type { Platform, ReadNode, RoutineSpec } from "./types";

export type Availability = "ready" | "draft_only" | "approval_gated" | "not_for_business_type" | `needs_connector:${string}` | `unavailable:${string}:${string}` | `unavailable:${string}:${string}:${string}`;

const CARD_PLATFORMS = new Set(Object.values(CONNECTOR_PLATFORMS));

export interface WorkerReadContract {
  /** Omitted means the reader owns field validation. When present, every requested field must
      be in this list; this catches convenience fields the provider silently drops. */
  fields?: readonly string[];
  /** Query filter keys the live reader actually applies. */
  filters?: readonly string[];
  /** ReadResult.metrics keys the reader derives for templates and predicates. `count` and `rows`
      are supplied by the runtime and need not be listed. */
  metrics?: readonly string[];
}

/** Production-live reads implemented by WorkerConnectorReader and its readers. This mapping is
    deliberately narrower than fixture coverage: Google Ads currently has fixture-only reads,
    so it must not make a real account look runnable. Meta is described down to fields, filters
    and derived metrics because accepting the endpoint alone would still advertise broken rules.
    An unlisted platform/resource fails closed. */
export const WORKER_LIVE_READ_CAPABILITIES: Readonly<Partial<Record<Platform, Readonly<Record<string, WorkerReadContract>>>>> = Object.freeze({
  shopify: Object.freeze({ orders: {}, products: {}, customers: {}, checkouts: {}, pages: {} }),
  klaviyo: Object.freeze({ flows: {}, metrics: {}, campaigns: {}, segments: {} }),
  ga4: Object.freeze({ report: {} }),
  meta_ads: Object.freeze({
    insights: Object.freeze({
      fields: Object.freeze(["ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "spend", "impressions", "clicks", "ctr", "frequency", "purchases", "purchase_value", "roas", "cpa"]),
      filters: Object.freeze(["level"]),
      metrics: Object.freeze(["spend", "purchases", "purchase_value", "roas", "cpa", "impressions", "clicks", "top_adset_id", "top_adset_name", "top_adset_roas", "top_adset_daily_budget", "worst_ad_id", "worst_ad_name", "worst_frequency", "worst_spend", "daily_budget_total", "projected_daily_spend", "reconciliation_pct"]),
    }),
    ads: Object.freeze({
      fields: Object.freeze(["id", "ad_id", "name", "status", "effective_status", "adset_id", "creative"]),
      filters: Object.freeze(["status"]),
      metrics: Object.freeze([]),
    }),
    adsets: Object.freeze({
      fields: Object.freeze(["id", "ad_id", "name", "status", "effective_status", "campaign_id", "daily_budget", "lifetime_budget"]),
      filters: Object.freeze(["status"]),
      metrics: Object.freeze(["daily_budget_total", "largest_adset_id", "largest_adset_name", "largest_daily_budget"]),
    }),
    campaigns: Object.freeze({
      fields: Object.freeze(["id", "ad_id", "name", "status", "effective_status", "objective", "daily_budget", "lifetime_budget"]),
      filters: Object.freeze(["status"]),
      metrics: Object.freeze(["daily_budget_total"]),
    }),
  }),
  hubspot: Object.freeze({ contacts: {}, deals: {} }),
});

export function workerCanRead(source: Platform, resource: string): boolean {
  const platform = WORKER_LIVE_READ_CAPABILITIES[source];
  return !!platform && Object.prototype.hasOwnProperty.call(platform, resource);
}

export interface UnsupportedRead {
  platform: Platform;
  resource: string;
  /** Missing portion of an otherwise-present reader contract, e.g. `metric.active_tests`. */
  contract?: string;
}

const BUILTIN_READ_MEMBERS = new Set(["count", "rows"]);

function referencedMembers(spec: RoutineSpec, alias: string): string[] {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`reads\\.${escaped}\\.([a-zA-Z0-9_]+)`, "g");
  const out: string[] = [];
  const source = JSON.stringify(spec.nodes);
  for (const match of source.matchAll(re)) if (!out.includes(match[1])) out.push(match[1]);
  return out;
}

function contractGaps(spec: RoutineSpec, node: ReadNode, capability: WorkerReadContract): UnsupportedRead[] {
  const gaps: UnsupportedRead[] = [];
  const add = (contract: string) => {
    if (!gaps.some((g) => g.contract === contract)) gaps.push({ platform: node.source, resource: node.query.resource, contract });
  };
  if (capability.filters) for (const key of Object.keys(node.query.filter ?? {})) if (!capability.filters.includes(key)) add(`filter.${key}`);
  if (capability.fields) for (const field of node.query.fields ?? []) if (!capability.fields.includes(field)) add(`field.${field}`);
  if (capability.metrics) {
    for (const member of referencedMembers(spec, node.as)) {
      if (!BUILTIN_READ_MEMBERS.has(member) && !capability.metrics.includes(member)) add(`metric.${member}`);
    }
  }
  return gaps;
}

function workerCanRunReadContract(spec: RoutineSpec, node: ReadNode): boolean {
  const capability = WORKER_LIVE_READ_CAPABILITIES[node.source]?.[node.query.resource];
  return !!capability && contractGaps(spec, node, capability).length === 0;
}

/** Every effectively-required read contract the production worker cannot answer. A read marked
    optional becomes required when the skill contract names its platform in minimum.platforms. */
export function unsupportedRequiredReads(spec: RoutineSpec): UnsupportedRead[] {
  const minimum = new Set(spec.minimum?.platforms ?? []);
  const gaps: UnsupportedRead[] = [];
  for (const node of spec.nodes) {
    if (node.kind !== "read") continue;
    if (node.optional && !minimum.has(node.source)) continue;
    const capability = WORKER_LIVE_READ_CAPABILITIES[node.source]?.[node.query.resource];
    if (!capability) gaps.push({ platform: node.source, resource: node.query.resource });
    else gaps.push(...contractGaps(spec, node, capability));
  }
  return gaps;
}

export function unsupportedRequiredRead(spec: RoutineSpec): UnsupportedRead | null {
  return unsupportedRequiredReads(spec)[0] ?? null;
}

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

/** The production-readable card platforms that HELP but never gate: optional reads plus the
    minimum's `helpful`, minus anything required, in chain order, unique. */
export function helpfulPlatforms(spec: RoutineSpec): Platform[] {
  const required = new Set(requiredPlatforms(spec));
  const out: Platform[] = [];
  const add = (p: Platform) => {
    if (CARD_PLATFORMS.has(p) && !required.has(p) && !out.includes(p)) out.push(p);
  };
  for (const node of spec.nodes) {
    if (node.kind === "read" && node.optional && workerCanRunReadContract(spec, node)) add(node.source);
  }
  for (const p of spec.minimum?.helpful ?? []) {
    const supportedRead = spec.nodes.find((node): node is ReadNode => node.kind === "read" && node.source === p && workerCanRunReadContract(spec, node));
    if (supportedRead || Object.keys(WORKER_LIVE_READ_CAPABILITIES[p] ?? {}).length > 0) add(p);
  }
  return out;
}

export function routineAvailability(spec: RoutineSpec, connected: Iterable<string>, model?: BusinessModel | null): Availability {
  if (!fitsBusiness(spec, model)) return "not_for_business_type";
  const unsupported = unsupportedRequiredRead(spec);
  if (unsupported) return `unavailable:${unsupported.platform}:${unsupported.resource}${unsupported.contract ? `:${unsupported.contract}` : ""}`;
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

export function unavailableRead(a: Availability): UnsupportedRead | null {
  if (!a.startsWith("unavailable:")) return null;
  const [platform, resource, ...contract] = a.slice("unavailable:".length).split(":");
  return platform && resource ? { platform: platform as Platform, resource, ...(contract.length ? { contract: contract.join(":") } : {}) } : null;
}

const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

/** The one honest line under a routine row (the copy floor in docs/PRODUCT-EXPERIENCE.md). */
export function availabilityCopy(a: Availability): string {
  const p = missingPlatform(a);
  if (p) return `needs ${NAME_BY_PLATFORM[p] ?? p} connected`;
  const unsupported = unavailableRead(a);
  if (unsupported) {
    const reader = `${NAME_BY_PLATFORM[unsupported.platform] ?? unsupported.platform.replaceAll("_", " ")} ${unsupported.resource.replaceAll("_", " ")} reader`;
    return unsupported.contract ? `${reader} isn't ready — missing ${unsupported.contract.replaceAll(".", " ").replaceAll("_", " ")}` : `${reader} isn't available yet`;
  }
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
