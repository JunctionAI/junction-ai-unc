/* Shopify Admin REST reader (read-only).

   Resources: orders | products | customers | checkouts (abandoned) | pages.
   Endpoint shape: GET https://{shop}/admin/api/{version}/{resource}.json
   with the access token in X-Shopify-Access-Token. Pagination is NOT followed
   (one page, limit ≤ 250) — enough for the catalog's windows; cursor paging is
   a Wave 2 concern along with real credentials. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { clampLimit, fetchJson, num, round2, sum, windowStartIso } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const SHOPIFY_API_VERSION = "2026-01";

const PLATFORM = "shopify" as const;

// ---------- fixtures ----------

const FIXTURE_ROWS: Record<string, Row[]> = {
  orders: [
    { id: 1001, total_price: "89.00", created_at: "2026-09-01T09:12:00Z", landing_site: "/", referring_site: "https://instagram.com", customer_id: 501, line_items: [{ title: "Sea Cucumber 90s", quantity: 1 }] },
    { id: 1002, total_price: "142.50", created_at: "2026-09-01T14:40:00Z", landing_site: "/products/collagen", referring_site: "https://facebook.com", customer_id: 502, line_items: [{ title: "Marine Collagen", quantity: 2 }] },
    { id: 1003, total_price: "59.00", created_at: "2026-09-02T02:05:00Z", landing_site: "/", referring_site: "", customer_id: 503, line_items: [{ title: "Propolis", quantity: 1 }] },
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

export function shopifyMetrics(resource: string, rows: Row[]): Metrics {
  switch (resource) {
    case "orders": {
      const revenue = sum(rows, "total_price");
      return { revenue, aov: rows.length ? round2(revenue / rows.length) : 0 };
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

export function shopifyRequest(query: ReadQuery, shopDomain: string, now: Date): { url: string } {
  const params = new URLSearchParams();
  params.set("limit", String(clampLimit(query.limit, 250, 50)));
  if (query.fields?.length) params.set("fields", [...new Set(["id", ...query.fields])].join(","));
  const since = windowStartIso(query.window, now);
  if (query.resource === "orders") params.set("status", "any");
  if (since) params.set(query.resource === "customers" ? "updated_at_min" : "created_at_min", since);
  return { url: `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/${query.resource}.json?${params.toString()}` };
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (!RESOURCES.has(query.resource)) return fail(`shopify resource "${query.resource}" has no reader`);
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource] ?? [];
    return ok(PLATFORM, rows, shopifyMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "shopify") return fail(`shopify reader was given ${creds.kind} credentials`);

  const { url } = shopifyRequest(query, creds.shopDomain, now());
  const res = await fetchJson(url, { method: "GET", headers: { "X-Shopify-Access-Token": creds.accessToken, Accept: "application/json" } }, opts);
  if (!res.ok) return fail(res.reason);
  const body = res.json as Record<string, unknown> | null;
  const rows = Array.isArray(body?.[query.resource]) ? (body![query.resource] as Row[]) : null;
  if (!rows) return fail(`shopify ${query.resource}: response had no "${query.resource}" array`);
  return ok(PLATFORM, rows, shopifyMetrics(query.resource, rows), now().toISOString(), "live", `GET /admin/api/${SHOPIFY_API_VERSION}/${query.resource}.json (single page)`);
}
