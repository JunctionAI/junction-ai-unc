/* Benchmark segments for an account — resolved from the database (service role), never
   stored on the benchmark row itself (a row only ever carries the segment label + n ≥ 5).

     "shopify"                 a connected Shopify store
     "revenue_band:<band>"     the governing revenue goal's baseline (monthly) × 12 → annual

   Pure over the DbClient slice, so the worker and the Home route share it and the tests
   run it on the schema-checked fake. */

import { unwrap, type DbClient } from "../db/types";
import { revenueBand } from "./benchmarks";

export async function segmentsForAccount(db: DbClient, accountId: string): Promise<string[]> {
  const [connectors, goals] = await Promise.all([
    unwrap<{ platform: string; status: string }[]>("connectors.select", db.from("connectors").select("platform, status").eq("account_id", accountId).eq("platform", "shopify")),
    unwrap<{ category: string; baseline: number | string | null }[]>("goals.select", db.from("goals").select("category, baseline").eq("account_id", accountId).eq("tier", "governing")),
  ]);
  const out: string[] = [];
  if (connectors.some((c) => c.status === "connected")) out.push("shopify");
  const revenue = goals.find((g) => g.category === "revenue");
  const band = revenueBand(revenue?.baseline === null || revenue?.baseline === undefined ? null : Number(revenue.baseline) * 12);
  if (band) out.push(band);
  return out;
}

/** The most specific segment to read "The bar" against: revenue band beats platform beats all. */
export function primarySegment(segments: string[]): string {
  return segments.find((s) => s.startsWith("revenue_band:")) ?? segments.find((s) => s === "shopify") ?? "all";
}
