# Meta budget normalization and saved-data correction

Batch 52. PASS: source validation and real saved-data correction/reuse. Release evidence will be recorded separately. This advances B09/B11, not completion of the B01–B24/all-client goal.

## Corrected semantics

`unc.meta-budget.v2` requires configured and effective ACTIVE status for the active daily-budget subset. Paused/campaign-paused/deleted/archived/in-process/issue configurations are not targets. Lifetime allocations remain separate. Missing, malformed, conflicting or possibly campaign-owned budgets stay unknown; duplicate/missing IDs, unknown statuses and unsafe amounts prevent a usable total/target.

`active_daily_budget_total` means eligible active daily-budget configurations within the returned listing. It is not account spend, forecast spend, an account cap, or a complete campaign/ad-set ownership join. `daily_budget_total` and `projected_daily_spend` remain null. Largest-adset selection is limited to the eligible daily subset. Raw conversion still assumes two currency decimals; AVGAR's NZD was independently verified in Batch 51, not generalized to every currency.

Meta adsets/campaigns query hashes include the normalization version. Reader, save, readiness and reuse paths require its marker; old results under a new hash cannot be ready. Insights and other platforms retain prior hashes. Native pacing's skill check refuses missing/invalid/unverified forecasts and its prompt forbids budget configurations as forecasts. Pacing remains unavailable pending its projection, cap/currency and catalog/adapter contract.

## Actual saved-data acceptance

`scripts/correct-avgar-meta-budget-snapshot.mjs` defaults to GET-only. Explicit `--persist` permits one exact insert, checks fixed project/account/owner/generation/asset and requires AVGAR paused. It refuses stale/changed data, uses a deterministic ID and reconciles repeated invocation. No credential reads, provider requests, unrelated table access, RPCs, account updates or deletes. SourceNote retains lineage: source ID and normalized-row SHA256.

- Source: `e1a4b0c9-a7fd-4c1b-bc6b-906c55ff8033`, 62 normalized adsets, fetched `2026-09-05T16:23:36.380Z`.
- Original record hash: `0b1cae06d0033d68980e6eee9cd438e9b733e042ca3a91318301936955f0f150`.
- Source rows hash: `a5be313dddda96232c6b4ad5beb93307964553389e03013578a6d19aec37b520`.
- Derived: `a1223279-93b6-59fe-a6a2-089222fe77f3`, stored `2026-09-05T16:39:20.756Z`, same original source time.
- Query hash: `9ff158ea4ed8cd7502ede2785e86b11103089ad62864c546e9ebe30b4ab640cc`.
- Result: 2 active daily adsets, NZD 32.61; largest eligible ID `120249470895090580`, daily amount 22.61. Ambiguous/forecast metrics null. No second division by 100.
- Dry inspection: 9 database GETs, 0 writes/provider requests.
- Persist/readback at `16:39:21.077Z`: 15 GETs, one insert, 0 provider requests. A new StoredDatasetReader serves the derived ID and unchanged rows/source timestamp.
- Repeat explicit persist at `16:39:45.235Z`: 11 GETs, zero writes/provider requests, same served ID.
- Independent SQL at `16:39:57.249623Z` confirms both records. Historical aggregate 173.67 preserved, not relabelled. AVGAR paused/generation 1/NZD; four runs and one command unchanged.

Normal 60-minute source expiry still applies. No background sync or read-routing cutover enabled.

## Validation and remaining work

Full Vitest: 216 files / 2,820 tests passed. Ten Node derivation tests passed (identity, query, provenance, source time, units, cardinality, deterministic ID, preserved history). App/worker TypeScript and Next.js 16.3.4 production webpack build passed. Full lint: zero errors, 44 existing warnings; changed-file lint and diff whitespace check passed.

Next: matched app/worker release, actual runtime readback, scoped ongoing producer cadence/restart proof before stored-reader cutover. Complete query/metric joins, product-price CPA policy, auth lifecycle, customer/channel/second-client acceptance and remaining original register items. Nguyen owns his agreed five-lane delivery; no workflow, contract/payment or Upwork message changed in this batch.
