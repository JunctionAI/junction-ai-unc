/* POST /api/webhooks/shopify/<topic> — Shopify's mandatory compliance webhooks.

   Register these three URLs in the app's Compliance webhooks (Dev Dashboard → App → Webhooks):
     https://<APP_URL>/api/webhooks/shopify/customers_data_request
     https://<APP_URL>/api/webhooks/shopify/customers_redact
     https://<APP_URL>/api/webhooks/shopify/shop_redact

   HMAC-verified over the raw body with SHOPIFY_CLIENT_SECRET (timing-safe); 401 on a bad
   signature, 404 on an unknown topic, 503 when Shopify isn't configured, else 200 with a
   receipt row per affected account (src/lib/connectors/webhooks.ts). No session — Shopify calls this. */

import { getProvisioner } from "@/lib/connectors/provisioning";
import { handleShopifyWebhook } from "@/lib/connectors/webhooks";
import { isDbConfigured } from "@/lib/db/client";
import { asDb } from "@/lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ topic: string }> }) {
  const { topic } = await ctx.params;
  const rawBody = await req.text();
  const secret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim() || null;
  const db = isDbConfigured() && isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  const now = () => new Date();
  const log = (line: string) => console.log(`[webhooks] ${line}`);
  const provisioner = db ? getProvisioner({ db, fetch: (input, init) => fetch(input, init), now, log }, process.env) : undefined;
  const result = await handleShopifyWebhook(
    { db, secret, now, log, provisioner },
    {
      topicParam: topic,
      headers: { hmac: req.headers.get("x-shopify-hmac-sha256"), topic: req.headers.get("x-shopify-topic"), shopDomain: req.headers.get("x-shopify-shop-domain") },
      rawBody,
    },
  );
  return Response.json(result.body, { status: result.status });
}
