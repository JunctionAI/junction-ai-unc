# AVGAR Klaviyo account identity — independent live proof

6 September 2026 NZ / 5 September UTC. **PASS: credential/account identity read.
PARTIAL: calendar integration.** This is a point-in-time provider observation,
not an ongoing-auth guarantee, calendar registration or customer calendar run.

## Real execution

- Separate Codex-owned manual probe: `BHU55GyCpcRVh8eq`,
  `CODEX — AVGAR — Verify Klaviyo account — READ ONLY`.
- Saved execution [85](https://junctionai8.app.n8n.cloud/workflow/BHU55GyCpcRVh8eq/executions/85),
  manual, success, finished; `2026-09-05T20:11:58.081Z` to
  `2026-09-05T20:11:58.477Z` (396 ms; HTTP node 340 ms).
- Actual saved `workflowVersionId`: `a8a13681-4811-4601-b088-9b7a5875db30`.
  It is the execution's top-level field, not `workflowData.versionId` or an
  expected revision echoed into output.
- Existing credential reference `4mkTKL1q0njNafh9` / `Header Auth account`,
  `httpHeaderAuth`. No credential was created, edited, exported or rotated.
- One real GET to `https://a.klaviyo.com/api/accounts/`, sparse fields only:
  organization name, website, timezone, preferred currency, test-account flag.
  Revision `2026-07-15`; timeout 10 seconds; retries off; no body or pagination.
  No customer records, campaign sends, provider mutations, or paid search calls.
- HTTP **200**, provider request `d5527573-753c-4833-b7e6-8035e512d6b4`.
- Exactly two connected nodes: manual trigger `f6d224f5-b66e-4876-be7f-f392e7a7b1eb`
  → HTTP request `f77c8ace-6b4a-495a-8fd8-01a78fd09267`. Both ran once;
  no pinned output, child workflow, scheduler or public webhook.
- SHA-256 of saved HTTP node JSON output (JSON.stringify order):
  `7dc9b65b5fe206f2c3bb7dacd3e37f9371858e291b4e244e40bf11a2ce1b1391`.
  Raw response/headers remain in the authenticated n8n execution, not this repo.

## Verified identity and reporting context

| Field | Provider observation |
|---|---|
| Klaviyo account ID | `SuYidF` (response body and `cid` header agree) |
| Organization | `Avgar` |
| Website | `https://avgarsport.com` |
| Test account | `false` |
| Provider timezone | `US/Eastern`, normalized by Intl to `America/New_York` |
| Provider preferred currency | `USD` |

Unc's independently read AVGAR account remains
`aa5cfc84-2569-4c99-9b40-67003ae55eda`, generation **1**, currency **NZD**,
automation paused. The domain and previously accepted AVGAR workflow credential
match; this is not an instruction to copy credentials to another tenant.

**Do not overwrite either currency.** `client.currency` in the calendar contract
means Unc business-context currency and must remain NZD for this account. Provider
reporting currency is USD. The current calendar path reads campaign metadata, not
revenue, and must not synthesize or convert revenue/performance. Any later financial
dataset needs its own explicit source-currency/FX semantics. Likewise, preserve the
observed provider timezone separately; calendar date timezone must be explicit in
the reviewed binding, not silently inferred from Tom's device or the US/NZ/AU markets.

## Independent verification and regression coverage

`node scripts/verify-klaviyo-account-probe.mjs` passed at
`2026-09-05T20:14:34.837Z`. It makes one authenticated GET for saved execution 85
using the existing worker-held reader key; **zero new Klaviyo calls and zero writes**.
Secrets never leave the worker. It binds the exact saved workflow revision,
trigger/HTTP node IDs, credential, request URL/options, connections, successful
single runs, source linkage, timing, unpinned output and expected account/domain.
Its output allowlists identity/provenance fields and explicitly says no binding
created and calendar not ready. It does not equate a saved read with current health.

`node --test scripts/tests/klaviyo-account-probe.test.mjs`: **39/39 pass**.
These are synthetic verifier tests, including wrong account/credential/revision,
pins, retries, extra nodes, altered request, incomplete/error response, timezone/
currency substitution and private-field omission. Focused ESLint and diff checks
pass. No app/worker runtime source changed; no build or deployment was needed.

The editor auto-selected the keyword receiver credential when Header Auth was
chosen. This was corrected **before execution**, and the actual saved execution
independently proves use of the Klaviyo credential. The original draft was reused,
not duplicated after its browser tab closed. Available n8n tooling had no mutation
connector; the authenticated editor was used, followed by supported API readback.
This was a watched internal manual read, not a published production workflow.

## Preserved state and next work

Nguyen's Email TEST `DV5Wv6wXlzpz4zeN` independently remains inactive at revision
`f96c1b82-348a-4711-823f-a9f68498793e`; it was not edited, published or executed.
The new probe is also unpublished/inactive. Worker commands, messaging, live mode,
SMS and Apple flags remain false; command release scopes remain empty. No pause,
routine switch, Unc database registration or provider setting was changed.

This removes the missing Klaviyo account-identity evidence for the next binding
(B06/B08 progress), but does not close B06/B08 across platforms/clients. Next:

1. Package the separate Codex calendar receiver against the accepted contract,
   with distinct receiver credential, authority call, exact node/revision pins
   and real campaign-metadata input. Reuse the existing provider credential.
2. Create the reviewed AVGAR-only registration/binding with this identity proof
   and explicit timezone/currency semantics. Revalidate after credential changes;
   do not treat this saved read as perpetual authorization.
3. Prove one bounded shadow calendar run, independent execution/artifact/receipt
   readback, customer selection/reload/switch-off and recovery.

The original B01–B24 and all-screen/all-client/launch objective remains active.
No contractor complaint, payment, contract change or new commercial commitment
was sent. This does not transfer Codex integration work back to Nguyen.
