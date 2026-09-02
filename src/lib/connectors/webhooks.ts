/* Shopify mandatory compliance webhooks (app-review hard requirement):

     customers/data_request   a customer asked the merchant for their data
     customers/redact         delete a customer's personal data
     shop/redact              the merchant uninstalled 48h+ ago — forget the shop

   Verification: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(SHOPIFY_CLIENT_SECRET, raw body)),
   compared timing-safe against the RAW body (never a re-serialised JSON). Anything that fails
   the check is 401 before the body is even parsed.

   Effects (accounts mode): one receipt row per delivery (kind notification, run_id null) on
   every account the shop belongs to, carrying ids and counts only — never emails, names or
   order contents. shop/redact additionally marks the connector disconnected and deletes its
   sealed token and tears the tenant's warehouse sync down (provisioner.purgeTenant: the
   Airbyte connection + source). We hold no customer data outside the warehouse today
   (routines are read-only), so data_request / customers_redact are acknowledged and
   receipted; per-customer redaction inside the warehouse schema is an ops step
   (docs/CONNECTORS-FIRST-BOOT.md §9).

   Shopify retries on anything but 2xx; a verified delivery for a shop we don't know is 200
   with recorded:false — nothing to act on, nothing to retry. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { insertSystemReceipt } from "@/lib/db/receipts";
import type { DbClient } from "@/lib/db/types";
import { purgeLine } from "./handlers";
import type { PurgeResult, SyncProvisioner } from "./provisioning";
import { normaliseShopDomain } from "./registry";
import { deleteSecret, findConnectorsByExternalRef, updateConnector, type ConnectorRow } from "./store";

export type ShopifyComplianceTopic = "customers/data_request" | "customers/redact" | "shop/redact";

export const COMPLIANCE_TOPICS: ShopifyComplianceTopic[] = ["customers/data_request", "customers/redact", "shop/redact"];

/** Route segment forms (no slash in a path segment) and the header form both normalise. */
export function normaliseTopic(raw: string | null | undefined): ShopifyComplianceTopic | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().replace(/_/g, "/").replace(/^customers\/data\/request$/, "customers/data_request");
  return (COMPLIANCE_TOPICS as string[]).includes(t) ? (t as ShopifyComplianceTopic) : null;
}

/** Path form for registering the endpoints: customers_data_request, customers_redact, shop_redact. */
export function topicPathSegment(topic: ShopifyComplianceTopic): string {
  return topic.replace("/", "_");
}

export function shopifyWebhookHmac(rawBody: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export function verifyShopifyWebhookHmac(rawBody: string | Buffer, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(shopifyWebhookHmac(rawBody, secret), "base64");
  let provided: Buffer;
  try {
    provided = Buffer.from(header.trim(), "base64");
  } catch {
    return false;
  }
  return expected.length === provided.length && expected.length > 0 && timingSafeEqual(expected, provided);
}

export interface WebhookDeps {
  /** Service-role client; null when the DB isn't configured. */
  db: DbClient | null;
  /** SHOPIFY_CLIENT_SECRET; null when Shopify isn't configured. */
  secret: string | null;
  now: () => Date;
  log?: (line: string) => void;
  /** Per-tenant sync; shop/redact tears the shop's sync down through it. */
  provisioner?: SyncProvisioner;
}

export interface WebhookRequest {
  /** The [topic] route segment. */
  topicParam: string;
  headers: { hmac: string | null; topic: string | null; shopDomain: string | null };
  rawBody: string;
}

export type WebhookResult = { status: 200; body: { ok: true; topic: ShopifyComplianceTopic; recorded: boolean; accounts: number } } | { status: 400 | 401 | 404 | 503; body: { error: string } };

function describe(topic: ShopifyComplianceTopic, shop: string, body: Record<string, unknown>): { description: string; payload: Record<string, unknown> } {
  const customerId = (body.customer as { id?: unknown } | undefined)?.id;
  const orders = Array.isArray(body.orders_requested) ? body.orders_requested.length : Array.isArray(body.orders_to_redact) ? body.orders_to_redact.length : 0;
  const base = { topic, shop_domain: shop, customer_id: customerId ?? null, orders: orders || null, webhook_id: typeof body.id === "string" ? body.id : null };
  switch (topic) {
    case "customers/data_request":
      return { description: `Shopify data request for customer ${customerId ?? "?"} on ${shop} — no customer data is held outside the certified warehouse; nothing to hand over from the app.`, payload: base };
    case "customers/redact":
      return { description: `Shopify redaction request for customer ${customerId ?? "?"} on ${shop} — acknowledged; warehouse tenant purge follows the sync schedule.`, payload: base };
    case "shop/redact":
      return { description: `Shopify shop/redact for ${shop} — connector disconnected and its token deleted.`, payload: base };
  }
}

export async function handleShopifyWebhook(deps: WebhookDeps, req: WebhookRequest): Promise<WebhookResult> {
  const topic = normaliseTopic(req.topicParam) ?? normaliseTopic(req.headers.topic);
  if (!topic) return { status: 404, body: { error: "unknown webhook topic" } };
  if (!deps.secret) return { status: 503, body: { error: "shopify is not configured" } };
  if (!verifyShopifyWebhookHmac(req.rawBody, req.headers.hmac, deps.secret)) {
    deps.log?.(`webhooks.shopify topic=${topic} result=bad_hmac`);
    return { status: 401, body: { error: "invalid HMAC" } };
  }
  // The header topic wins when both are present and disagree (the path is ours; the header is Shopify's).
  const headerTopic = normaliseTopic(req.headers.topic);
  const effective = headerTopic ?? topic;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(req.rawBody || "{}");
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { status: 400, body: { error: "invalid JSON body" } };
  }
  const shop = normaliseShopDomain(req.headers.shopDomain) ?? normaliseShopDomain(body.shop_domain);
  if (!deps.db || !shop) {
    deps.log?.(`webhooks.shopify topic=${effective} result=${deps.db ? "no_shop" : "no_db"}`);
    return { status: 200, body: { ok: true, topic: effective, recorded: false, accounts: 0 } };
  }

  const rows = await findConnectorsByExternalRef(deps.db, "shopify", shop);
  const now = deps.now().toISOString();
  const { description, payload } = describe(effective, shop, body);
  for (const row of rows) {
    if (effective === "shop/redact") {
      const purge = await redactShop({ ...deps, db: deps.db }, row, now);
      await insertSystemReceipt(deps.db, { accountId: row.account_id, kind: "notification", platform: "shopify", description: `${description} ${purgeLine(purge)}`, payload: { ...payload, sync_purge: purge }, now });
      continue;
    }
    await insertSystemReceipt(deps.db, { accountId: row.account_id, kind: "notification", platform: "shopify", description, payload, now });
  }
  deps.log?.(`webhooks.shopify topic=${effective} accounts=${rows.length} result=recorded`);
  return { status: 200, body: { ok: true, topic: effective, recorded: rows.length > 0, accounts: rows.length } };
}

/** The token is already dead on Shopify's side (the app was uninstalled) — no revoke, just
    the sync teardown, then the secret. */
async function redactShop(deps: WebhookDeps & { db: DbClient }, row: ConnectorRow, now: string): Promise<PurgeResult> {
  let purge: PurgeResult = { purged: false, deleted: [], reason: "sync_not_configured" };
  if (deps.provisioner) {
    try {
      purge = await deps.provisioner.purgeTenant(row.account_id, "shopify");
    } catch (e) {
      purge = { purged: false, deleted: [], reason: e instanceof Error && "code" in e ? `airbyte_${String((e as { code: unknown }).code)}` : "purge_failed" };
    }
  }
  await deleteSecret(deps.db, row.id);
  await updateConnector(deps.db, row.id, { status: "disconnected", last_sync_result: "error:shop_redacted", last_sync_at: now });
  return purge;
}
