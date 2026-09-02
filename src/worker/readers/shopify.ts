/* Shopify Admin REST reader (read-only). API version 2026-07 (the Partner app's
   api_version — shopify/shopify.app.toml).

   Resources: orders | products | customers | checkouts (abandoned) | pages.
   Endpoint shape: GET https://{shop}/admin/api/{version}/{resource}.json with the access
   token in X-Shopify-Access-Token (never the URL).

   Request shaping against the current docs:
     orders      status=any, created_at_min=<window start>, limit≤250, fields=…,
                 financial_status=<filter.financial_status> when the query says so
                 (paid | partially_refunded | refunded | any … — default unfiltered),
                 fulfillment_status likewise
     customers   updated_at_min=<window start>
     checkouts   created_at_min (abandoned checkouts)
     pages/products  created_at_min when a window is given
   Cursor pagination follows the Link header's rel="next" (page_info) for up to MAX_PAGES
   pages — Shopify allows only limit + fields on a page_info request, and the next URL it
   hands back already carries them.

   Parsing is defensive: money fields are strings ("89.00") → num(); missing fields read 0
   and are named in the provenance note; cancelled and refunded/voided orders are excluded
   from revenue (current_total_price — net of refunds — is preferred over total_price). */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { clampLimit, fetchJson, nextLink, num, round2, sum, windowStartIso } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const SHOPIFY_API_VERSION = "2026-07";
/** Pages of ≤ 250 followed per read (2 000 rows) — enough for the catalog's windows. */
export const MAX_PAGES = 8;

const PLATFORM = "shopify" as const;

// ---------- fixtures ----------

const FIXTURE_ROWS: Record<string, Row[]> = {
  orders: [
    { id: 1001, total_price: "89.00", current_total_price: "89.00", financial_status: "paid", cancelled_at: null, created_at: "2026-09-01T09:12:00Z", landing_site: "/", referring_site: "https://instagram.com", customer_id: 501, line_items: [{ title: "Sea Cucumber 90s", quantity: 1 }] },
    { id: 1002, total_price: "142.50", current_total_price: "142.50", financial_status: "paid", cancelled_at: null, created_at: "2026-09-01T14:40:00Z", landing_site: "/products/collagen", referring_site: "https://facebook.com", customer_id: 502, line_items: [{ title: "Marine Collagen", quantity: 2 }] },
    { id: 1003, total_price: "59.00", current_total_price: "59.00", financial_status: "paid", cancelled_at: null, created_at: "2026-09-02T02:05:00Z", landing_site: "/", referring_site: "", customer_id: 503, line_items: [{ title: "Propolis", quantity: 1 }] },
  ],
  products: [
    { id: 2001, title: "Sea Cucumber 90s", body_html: "<p>Wild-harvested.</p>", tags: "joint, marine", handle: "sea-cucumber" },
    { id: 2002, title: "Marine Collagen", body_html: "<p>Type I collagen.</p>", tags: "skin, marine", handle: "marine-collagen" },
  ],
  customers: [
    { id: 501, email: "fixture-1@example.com", orders_count: 3, total_spent: "312.00", last_order_at: "2026-09-01T09:12:00Z" },
    { id: 502, email: "fixture-2@example.com", orders_count: 1, total_spent: "142.50", last_order_at: "2026-09-01T14:40:00Z" },
  ],
  checkouts: [
    { id: 3001, email: "fixture-3@example.com", total_price: "120.00", abandoned_checkout_url: "https://example.myshopify.com/checkouts/3001", updated_at: "2026-09-01T18:00:00Z", line_items: [{ title: "Marine Collagen", quantity: 1 }] },
    { id: 3002, email: "fixture-4@example.com", total_price: "64.00", abandoned_checkout_url: "https://example.myshopify.com/checkouts/3002", updated_at: "2026-09-01T20:30:00Z", line_items: [{ title: "Propolis", quantity: 1 }] },
    { id: 3003, email: "fixture-5@example.com", total_price: "89.00", abandoned_checkout_url: "https://example.myshopify.com/checkouts/3003", updated_at: "2026-09-02T01:10:00Z", line_items: [{ title: "Sea Cucumber 90s", quantity: 1 }] },
    { id: 3004, email: "fixture-6@example.com", total_price: "178.00", abandoned_checkout_url: "https://example.myshopify.com/checkouts/3004", updated_at: "2026-09-02T03:45:00Z", line_items: [{ title: "Marine Collagen", quantity: 2 }] },
    { id: 3005, email: "fixture-7@example.com", total_price: "59.00", abandoned_checkout_url: "https://example.myshopify.com/checkouts/3005", updated_at: "2026-09-02T05:20:00Z", line_items: [{ title: "Propolis", quantity: 1 }] },
  ],
  pages: [
    { id: 4001, handle: "about", title: "About us", metafields_global_title_tag: "About us", metafields_global_description_tag: "Who we are." },
    { id: 4002, handle: "shipping", title: "Shipping", metafields_global_title_tag: "", metafields_global_description_tag: "" },
  ],
};

// ---------- metrics ----------

const EXCLUDED_FINANCIAL = new Set(["voided", "refunded"]);

/** Orders that count toward revenue: not cancelled, not fully refunded/voided. */
export function countsTowardRevenue(r: Row): boolean {
  if (r.cancelled_at !== null && r.cancelled_at !== undefined && r.cancelled_at !== "") return false;
  if (typeof r.financial_status === "string" && EXCLUDED_FINANCIAL.has(r.financial_status)) return false;
  return true;
}

/** Net order value: current_total_price (after refunds) when Shopify sent it, else total_price. */
export function orderValue(r: Row): number {
  if (r.current_total_price !== undefined && r.current_total_price !== null && r.current_total_price !== "") return num(r.current_total_price);
  return num(r.total_price);
}

export function shopifyMetrics(resource: string, rows: Row[]): Metrics {
  switch (resource) {
    case "orders": {
      const counted = rows.filter(countsTowardRevenue);
      const revenue = round2(counted.reduce((a, r) => a + orderValue(r), 0));
      const gross = sum(rows, "total_price");
      return { revenue, aov: counted.length ? round2(revenue / counted.length) : 0, order_count: counted.length, excluded_count: rows.length - counted.length, gross_total_price: gross };
    }
    case "checkouts":
      return { total_value: sum(rows, "total_price") };
    case "customers":
      return { total_spent: sum(rows, "total_spent"), repeat_count: rows.filter((r) => num(r.orders_count) >= 2).length };
    case "pages": {
      const missing = rows.filter((r) => !r.metafields_global_title_tag || !r.metafields_global_description_tag);
      const worst = missing[0];
      return {
        missing_meta_count: missing.length,
        worst_page_id: worst ? String(worst.id) : null,
        worst_page_handle: worst ? String(worst.handle) : null,
        worst_page_meta_title: worst ? String(worst.metafields_global_title_tag ?? "") : null,
      };
    }
    default:
      return {};
  }
}

// ---------- request shaping ----------

const RESOURCES = new Set(["orders", "products", "customers", "checkouts", "pages"]);
const FINANCIAL_STATUSES = new Set(["authorized", "pending", "paid", "partially_paid", "refunded", "voided", "partially_refunded", "any", "unpaid"]);
const FULFILLMENT_STATUSES = new Set(["shipped", "partial", "unshipped", "any", "unfulfilled"]);
/** Always asked for on orders so the metrics can exclude cancelled/refunded rows. */
const ORDER_BASE_FIELDS = ["id", "created_at", "total_price", "current_total_price", "financial_status", "cancelled_at"];

export function shopifyRequest(query: ReadQuery, shopDomain: string, now: Date): { url: string; note: string } {
  const params = new URLSearchParams();
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const notes: string[] = [];
  params.set("limit", String(clampLimit(query.limit, 250, query.resource === "orders" ? 250 : 50)));
  if (query.fields?.length) params.set("fields", [...new Set([...(query.resource === "orders" ? ORDER_BASE_FIELDS : ["id"]), ...query.fields])].join(","));
  const since = windowStartIso(query.window, now);
  if (query.resource === "orders") {
    params.set("status", "any");
    if (typeof filter.financial_status === "string") {
      if (FINANCIAL_STATUSES.has(filter.financial_status)) params.set("financial_status", filter.financial_status);
      else notes.push(`ignored unknown financial_status "${filter.financial_status}"`);
    }
    if (typeof filter.fulfillment_status === "string") {
      if (FULFILLMENT_STATUSES.has(filter.fulfillment_status)) params.set("fulfillment_status", filter.fulfillment_status);
      else notes.push(`ignored unknown fulfillment_status "${filter.fulfillment_status}"`);
    }
  }
  if (since) params.set(query.resource === "customers" ? "updated_at_min" : "created_at_min", since);
  return { url: `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/${query.resource}.json?${params.toString()}`, note: notes.join("; ") };
}

/** Only a next link on the same shop + version is followed (never an arbitrary URL from a header). */
export function safeNextUrl(link: string | null | undefined, shopDomain: string): string | null {
  const next = nextLink(link);
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:" || u.host !== shopDomain || !u.pathname.startsWith(`/admin/api/${SHOPIFY_API_VERSION}/`)) return null;
    return next;
  } catch {
    return null;
  }
}

/** Provenance note for shapes the docs promise but the payload lacks. */
export function missingFieldsNote(resource: string, rows: Row[]): string {
  if (!rows.length) return "";
  const expected = resource === "orders" ? ["id", "created_at", "total_price"] : resource === "customers" ? ["id", "orders_count", "total_spent"] : resource === "checkouts" ? ["id", "total_price"] : ["id"];
  const missing = expected.filter((f) => rows.some((r) => r[f] === undefined));
  return missing.length ? `fields missing on some rows (read as 0/null): ${missing.join(", ")}` : "";
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (!RESOURCES.has(query.resource)) return fail(`shopify resource "${query.resource}" has no reader`);
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource] ?? [];
    return ok(PLATFORM, rows, shopifyMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "shopify") return fail(`shopify reader was given ${creds.kind} credentials`);

  const shaped = shopifyRequest(query, creds.shopDomain, now());
  const headers = { "X-Shopify-Access-Token": creds.accessToken, Accept: "application/json" };
  const rows: Row[] = [];
  let url: string | null = shaped.url;
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const res = await fetchJson(url, { method: "GET", headers }, opts);
    if (!res.ok) return pages === 0 ? fail(res.reason) : fail(`page ${pages + 1}: ${res.reason}`);
    const body = res.json as Record<string, unknown> | null;
    const page = Array.isArray(body?.[query.resource]) ? (body![query.resource] as Row[]) : null;
    if (!page) return fail(`shopify ${query.resource}: response had no "${query.resource}" array`);
    rows.push(...page);
    pages++;
    url = safeNextUrl(res.link, creds.shopDomain);
  }
  const notes = [`GET /admin/api/${SHOPIFY_API_VERSION}/${query.resource}.json (${pages} page${pages === 1 ? "" : "s"}${url ? ", more available — capped" : ""})`, shaped.note, missingFieldsNote(query.resource, rows)];
  if (query.resource === "orders") {
    const excluded = rows.length - rows.filter(countsTowardRevenue).length;
    notes.push(`revenue = current_total_price of non-cancelled, non-refunded orders${excluded ? ` (${excluded} excluded)` : ""}`);
  }
  return ok(PLATFORM, rows, shopifyMetrics(query.resource, rows), now().toISOString(), "live", notes.filter(Boolean).join("; "));
}
