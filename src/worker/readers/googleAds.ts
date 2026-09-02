/* Google Ads reader — FIXTURE ONLY.

   Live reads need a Google Ads developer token (applied for per manager
   account, approved by Google), an OAuth refresh token, and the
   login-customer-id header, then a GAQL query against
   POST https://googleads.googleapis.com/v{n}/customers/{id}/googleAds:searchStream.
   None of that credential handling exists in this worker (the only shipped
   CredentialProvider hands out fixture markers), so a non-fixture credential
   is answered with an honest "couldn't ask" rather than a guess. Wave 2. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { sum } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

const PLATFORM = "google_ads" as const;

export const GOOGLE_ADS_LIVE_REASON = "google_ads live reads need a developer token + OAuth refresh token + login-customer-id (Wave 2, founder-gated); only fixture reads are available";

const FIXTURE_ROWS: Record<string, Row[]> = {
  campaigns: [
    { campaign_id: "g-1", name: "Brand — exact", cost: 38.2, budget_amount: 40, status: "ENABLED" },
    { campaign_id: "g-2", name: "PMax — catalogue", cost: 71.9, budget_amount: 75, status: "ENABLED" },
  ],
  search_terms: [
    { search_term: "marine collagen nz", clicks: 41, cost: 33.1, conversions: 3 },
    { search_term: "sea cucumber capsules", clicks: 27, cost: 21.4, conversions: 2 },
  ],
};

export function googleAdsMetrics(resource: string, rows: Row[]): Metrics {
  if (resource === "campaigns") {
    const budget = sum(rows, "budget_amount");
    return { cost: sum(rows, "cost"), budget_amount: budget, projected_daily_spend: budget };
  }
  if (resource === "search_terms") return { clicks: sum(rows, "clicks"), cost: sum(rows, "cost"), conversions: sum(rows, "conversions") };
  return {};
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  const rows = FIXTURE_ROWS[query.resource];
  if (!rows) return fail(`google_ads resource "${query.resource}" has no reader`);
  if (creds.kind !== "fixture") return fail(GOOGLE_ADS_LIVE_REASON);
  return ok(PLATFORM, rows, googleAdsMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; live Google Ads reads are Wave 2");
}
