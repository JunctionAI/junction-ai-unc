import { test } from "node:test";
import assert from "node:assert/strict";
import { derive, sourceId, accountId, derivedId } from "./correct-avgar-meta-budget-snapshot.mjs";
const now = new Date("2026-09-05T16:40:00Z");
function source() {
  return { id: sourceId, account_id: accountId, connector_id: "e205b686-e207-485e-a8fa-12f0852375b0", external_ref: "act_3235248400060604", platform: "meta_ads",
    query_hash: "b02e4876cef586c4b4891f26ad3675b905d9e5dd408cc847ca941af9d2a5ca5d",
    query: { limit: 200, fields: ["id", "name", "status", "effective_status", "campaign_id", "daily_budget"], resource: "adsets" },
    source_fetched_at: "2026-09-05T16:23:36.380Z",
    result: { fetchedAt: "2026-09-05T16:23:36.380Z", provenance: "ok", metrics: { daily_budget_total: 173.67 }, rows: [
      { id: "120249470895090580", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: 22.61, lifetime_budget: 0 },
      { id: "other-active", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: 10, lifetime_budget: 0 },
      ...Array.from({ length: 60 }, (_, i) => ({ id: `paused-${i}`, status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED", daily_budget: 32.89, lifetime_budget: 0 })),
    ] } };
}
test("corrects normalized rows once, keeps original timestamp/history and records lineage", () => {
  const input = source(), before = structuredClone(input), result = derive(input, now);
  assert.equal(result.id, derivedId);
  assert.equal(result.result.metrics.active_daily_budget_total, 32.61);
  assert.equal(result.result.metrics.daily_budget_total, null);
  assert.equal(result.result.metrics.projected_daily_spend, null);
  assert.equal(result.source_fetched_at, input.source_fetched_at);
  assert.deepEqual(result.result.rows, input.result.rows);
  assert.match(result.result.sourceNote, new RegExp(sourceId));
  assert.deepEqual(input, before);
  assert.equal(derive(input, new Date("2026-09-05T16:41:00Z")).id, result.id);
});
for (const key of ["id", "account_id", "connector_id", "external_ref", "platform", "query_hash"]) test(`rejects changed ${key}`, () => {
  const input = source(); input[key] = "foreign"; assert.throws(() => derive(input, now));
});
test("rejects changed query and old fixture provenance", () => {
  const input = source(); input.query.limit = 100; assert.throws(() => derive(input, now), /wrong_query/);
  const fixture = source(); fixture.result.provenance = "fixture"; assert.throws(() => derive(fixture, now), /unverified_source/);
});
test("refuses stale, future and conflicting source times", () => {
  assert.throws(() => derive(source(), new Date("2026-09-05T17:24:00Z")), /source_not_fresh/);
  assert.throws(() => derive(source(), new Date("2026-09-05T16:22:00Z")), /source_not_fresh/);
  const input = source(); input.result.fetchedAt = now.toISOString(); assert.throws(() => derive(input, now), /source_time_mismatch/);
});
test("requires the inspected real-case cardinality and amounts", () => {
  const input = source(); input.result.rows.pop(); assert.throws(() => derive(input, now), /unexpected_source_rows/);
  const wrongUnits = source(); wrongUnits.result.rows[0].daily_budget = 2261; assert.throws(() => derive(wrongUnits, now), /unexpected_active_budget/);
});
