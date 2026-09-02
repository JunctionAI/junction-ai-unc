/* Realistic response payloads, in the shapes the platform docs describe (trimmed to the fields
   the readers touch, plus the noise a real answer carries). Fake ids and values throughout —
   nothing here came from a live account. */

// ---------- Shopify Admin REST 2026-07 ----------

export const SHOPIFY_SHOP = {
  shop: { id: 12345678, name: "Acme Wellness", email: "owner@example.com", domain: "acme.example.com", myshopify_domain: "acme.myshopify.com", currency: "NZD", timezone: "(GMT+12:00) Auckland", plan_name: "basic" },
};

/** orders.json, page 1 of 2 (a paid order, a cancelled one, a partially refunded one). */
export const SHOPIFY_ORDERS_PAGE_1 = {
  orders: [
    { id: 5001, name: "#1001", created_at: "2026-09-01T09:12:00+12:00", total_price: "89.00", current_total_price: "89.00", subtotal_price: "80.00", financial_status: "paid", fulfillment_status: "fulfilled", cancelled_at: null, currency: "NZD", customer: { id: 501 }, line_items: [{ id: 1, title: "Sea Cucumber 90s", quantity: 1, price: "80.00" }] },
    { id: 5002, name: "#1002", created_at: "2026-09-01T14:40:00+12:00", total_price: "142.50", current_total_price: "142.50", financial_status: "voided", cancelled_at: "2026-09-01T15:00:00+12:00", currency: "NZD", customer: { id: 502 }, line_items: [] },
    { id: 5003, name: "#1003", created_at: "2026-09-02T02:05:00+12:00", total_price: "120.00", current_total_price: "60.00", financial_status: "partially_refunded", cancelled_at: null, currency: "NZD", customer: { id: 503 }, line_items: [] },
  ],
};

export const SHOPIFY_ORDERS_PAGE_2 = {
  orders: [{ id: 5004, name: "#1004", created_at: "2026-08-30T10:00:00+12:00", total_price: "59.00", current_total_price: "59.00", financial_status: "paid", cancelled_at: null, currency: "NZD", customer: { id: 504 }, line_items: [] }],
};

export const SHOPIFY_LINK_NEXT = (shop: string, pageInfo: string) => `<https://${shop}/admin/api/2026-07/orders.json?limit=250&page_info=${pageInfo}>; rel="next"`;
export const SHOPIFY_LINK_PREV_NEXT = (shop: string, prev: string, next: string) => `<https://${shop}/admin/api/2026-07/orders.json?limit=250&page_info=${prev}>; rel="previous", <https://${shop}/admin/api/2026-07/orders.json?limit=250&page_info=${next}>; rel="next"`;

export const SHOPIFY_CUSTOMERS = {
  customers: [
    { id: 501, email: "a@example.com", orders_count: 3, total_spent: "312.00", last_order_id: 5001, updated_at: "2026-09-01T09:12:00+12:00" },
    { id: 502, email: "b@example.com", orders_count: 1, total_spent: "142.50", last_order_id: 5002, updated_at: "2026-09-01T14:40:00+12:00" },
    { id: 503, email: "c@example.com", orders_count: 2, total_spent: "180.00", last_order_id: 5003, updated_at: "2026-09-02T02:05:00+12:00" },
  ],
};

export const SHOPIFY_ERROR_401 = { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" };

// ---------- Klaviyo (revision 2025-07-15) ----------

export const KLAVIYO_ACCOUNTS = {
  data: [{ type: "account", id: "AbC123", attributes: { test_account: false, contact_information: { default_sender_name: "Acme", default_sender_email: "hello@example.com", organization_name: "Acme Wellness" }, industry: "Health", timezone: "Pacific/Auckland", preferred_currency: "NZD" }, links: { self: "https://a.klaviyo.com/api/accounts/AbC123/" } }],
  links: { self: "https://a.klaviyo.com/api/accounts/", next: null, prev: null },
};

export const KLAVIYO_ERROR_401 = { errors: [{ id: "e1", status: 401, code: "not_authenticated", title: "Authentication credentials were not provided.", detail: "Missing or invalid private key.", source: { pointer: "/data/" } }] };

/** GET /api/metrics — two "Placed Order" metrics (the Shopify one must win). */
export const KLAVIYO_METRICS_LIST = {
  data: [
    { type: "metric", id: "M_api", attributes: { name: "Placed Order", created: "2024-01-01T00:00:00+00:00", updated: "2024-01-01T00:00:00+00:00", integration: { object: "integration", id: "0", key: "api", name: "API", category: "API" } } },
    { type: "metric", id: "M_shop", attributes: { name: "Placed Order", created: "2024-01-01T00:00:00+00:00", updated: "2024-01-01T00:00:00+00:00", integration: { object: "integration", id: "1", key: "shopify", name: "Shopify", category: "eCommerce" } } },
    { type: "metric", id: "M_rev", attributes: { name: "Submitted Review", integration: { name: "Reviews" } } },
  ],
  links: { self: "https://a.klaviyo.com/api/metrics/", next: null },
};

/** POST /api/metric-aggregates by $attributed_channel — "" = unattributed. */
export const KLAVIYO_METRIC_AGGREGATES = {
  data: {
    type: "metric-aggregate",
    id: "agg-1",
    attributes: {
      dates: ["2026-08-31T00:00:00+00:00", "2026-09-01T00:00:00+00:00"],
      data: [
        { dimensions: ["email"], measurements: { count: [3, 2], sum_value: [420.5, 180] } },
        { dimensions: ["sms"], measurements: { count: [1, 0], sum_value: [89, 0] } },
        { dimensions: [""], measurements: { count: [10, 12], sum_value: [1200, 1500.25] } },
      ],
    },
  },
};

export const KLAVIYO_FLOWS_ABANDONED = { data: [{ type: "flow", id: "FLOW_ac", attributes: { name: "Abandoned Cart", status: "live" } }], links: { next: null } };

/** POST /api/flow-values-reports — one row per flow message. */
export const KLAVIYO_FLOW_VALUES = {
  data: {
    type: "flow-values-report",
    attributes: {
      results: [
        { groupings: { flow_id: "FLOW_ac", flow_message_id: "MSG_1", send_channel: "email" }, statistics: { recipients: 410, opens: 220, clicks: 41, conversions: 12, conversion_value: 1080 } },
        { groupings: { flow_id: "FLOW_ac", flow_message_id: "MSG_2", send_channel: "email" }, statistics: { recipients: 380, opens: 170, clicks: 12, conversions: 4, conversion_value: 360 } },
      ],
    },
  },
};

// ---------- Meta Marketing API v23.0 ----------

export const META_AD_ACCOUNT = { name: "Acme Wellness NZ", account_status: 1, currency: "NZD", id: "act_1234567890" };
export const META_ERROR_190 = { error: { message: "Invalid OAuth access token - Cannot parse access token", type: "OAuthException", code: 190, fbtrace_id: "AbCdEf" } };

export const META_INSIGHTS_PAGE_1 = {
  data: [
    { campaign_id: "c1", campaign_name: "Prospecting", spend: "420.17", impressions: "51230", clicks: "812", ctr: "1.585", frequency: "1.8", purchase_roas: [{ action_type: "omni_purchase", value: "3.098" }], actions: [{ action_type: "link_click", value: "790" }, { action_type: "purchase", value: "18" }, { action_type: "omni_purchase", value: "19" }], action_values: [{ action_type: "omni_purchase", value: "1302.00" }], date_start: "2026-08-27", date_stop: "2026-09-02" },
    { campaign_id: "c2", campaign_name: "Retargeting", spend: "260.00", impressions: "9000", clicks: "120", ctr: "1.33", frequency: "4.6", actions: [{ action_type: "purchase", value: "9" }], action_values: [{ action_type: "purchase", value: "546.00" }], date_start: "2026-08-27", date_stop: "2026-09-02" },
  ],
  paging: { cursors: { before: "MAZDZD", after: "MQZDZD" }, next: "https://graph.facebook.com/v23.0/act_1234567890/insights?access_token=SHOULD_NOT_BE_USED&limit=100&after=MQZDZD" },
};

export const META_INSIGHTS_PAGE_2 = {
  data: [{ campaign_id: "c3", campaign_name: "Brand", spend: "10.00", impressions: "500", clicks: "20", ctr: "4.0", frequency: "1.1", date_start: "2026-08-27", date_stop: "2026-09-02" }],
  paging: { cursors: { before: "MQZDZD", after: "MgZDZD" } },
};

export const META_CAMPAIGNS = {
  data: [
    { id: "c1", name: "Prospecting", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "10000" },
    { id: "c2", name: "Retargeting", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", lifetime_budget: "250000" },
  ],
  paging: { cursors: { before: "a", after: "b" } },
};

// ---------- GA4 Data API v1beta ----------

export const GA4_PROPERTY = { name: "properties/123456", displayName: "acme.example.com", propertyType: "PROPERTY_TYPE_ORDINARY", timeZone: "Pacific/Auckland", currencyCode: "NZD" };
export const GA4_RUN_REPORT = {
  dimensionHeaders: [{ name: "sessionSource" }],
  metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }, { name: "conversions", type: "TYPE_FLOAT" }],
  rows: [
    { dimensionValues: [{ value: "google" }], metricValues: [{ value: "3975" }, { value: "48" }] },
    { dimensionValues: [{ value: "(direct)" }], metricValues: [{ value: "1200" }, { value: "10" }] },
  ],
  rowCount: 2,
  metadata: { currencyCode: "NZD", timeZone: "Pacific/Auckland" },
  kind: "analyticsData#runReport",
};
export const GOOGLE_TOKEN_OK = { access_token: "ya29.FAKE_ACCESS_TOKEN_FOR_TESTS_0000000000", expires_in: 3599, scope: "https://www.googleapis.com/auth/analytics.readonly", token_type: "Bearer" };
export const GOOGLE_TOKEN_BAD = { error: "invalid_grant", error_description: "Token has been expired or revoked." };
export const GOOGLE_ADS_CUSTOMERS = { resourceNames: ["customers/1234567890", "customers/9876543210"] };

// ---------- HubSpot ----------

export const HUBSPOT_ACCOUNT = { portalId: 44556677, accountType: "STANDARD", timeZone: "Pacific/Auckland", companyCurrency: "NZD", uiDomain: "app.hubspot.com", dataHostingLocation: "na1" };
export const HUBSPOT_ERROR_401 = { status: "error", message: "The access token is invalid or expired.", correlationId: "abc", category: "INVALID_AUTHENTICATION" };
