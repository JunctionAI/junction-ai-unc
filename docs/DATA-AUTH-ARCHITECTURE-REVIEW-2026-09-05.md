# Unc: durable data and connection architecture review

Date: 5 September 2026. Status: PARTIAL implementation in the inspected local checkout; this is research and a proposed implementation contract, not deployment proof.

## Verdict

Tom's concern is justified. Reliable authentication and warehouse-first data access are separate requirements. Unc has pieces of both, but the inspected routine read paths do not establish a working shared ingestion-to-warehouse system. More routines cannot compensate for that missing integration.

The target is: synchronize each customer's platform data once, reuse it across authorized routines, and reserve live platform access for ingestion, genuinely fresh queries and controlled actions. This reduces dependence on an agent's session. It does not eliminate OAuth expiry, revocation, API quotas or provider outages.

## What Cody actually recommends

Cody's own [LinkedIn post](https://www.linkedin.com/posts/codyxschneider_if-you-lead-marketing-at-a-company-and-do-activity-7485030790888632320-PwuD) recommends a pipeline and warehouse, with Airbyte plus ClickHouse as a DIY option, or Graphed as a packaged option.

[Graphed's architecture article](https://www.graphed.com/blog/ai-agents-for-marketing-analytics) describes its stack as Fivetran into ClickHouse, followed by a semantic/ontology layer and a query interface for agents. That is vendor-reported architecture, not an independent audit. The DIY suggestion and Graphed's published implementation must not be conflated.

I also inspected the relevant approximately 18–22 minute passage of a [third-party transcript of the Cody/Greg Isenberg discussion](https://sozai.app/transcript/marketing-agents-too-good/). It discusses pipeline, warehouse, agent queries and writes back to platforms. Its anecdotal statements about API reads causing bans are not a sound general rule: Meta publishes an [official Insights API](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi?entity=request-31691153-cb5c56e2-5d56-46e5-b03d-10ee84b08a22) for reading advertising statistics, including asynchronous reporting for larger requests.

The earlier local Cody evidence audit was recovered. The referenced full X evidence pack was not found in this checkout, and two original X post URLs could not be reopened. This review does not claim to have re-read the complete X corpus or verified the original video. The architectural conclusion is corroborated by the primary sources above.

## What exists in Unc, and what does not yet follow from it

Paths below are relative to `work/unc-overnight`.

| Area | Local evidence | Assessment |
| --- | --- | --- |
| Routine reads | `src/worker/service.ts:105` constructs `WorkerConnectorReader`; `src/worker/providers/connectorReader.ts` dispatches platform readers | Live API path, not a shared warehouse lookup |
| n8n read bridge | `src/lib/n8n/proxy.ts:192` constructs the same reader | Moving execution into n8n does not itself make reads warehouse-first |
| Persisted metrics | `src/lib/brain/kpi.ts` stores KPI snapshots; `src/lib/metrics/catalog.ts:53` retrieves them | Useful existing persistence, but aggregated KPI rows are not a general historical dataset |
| Freshness | Catalog chooses the latest snapshot without a maximum-age check; `src/lib/runtime/engine.ts:306` supports optional node freshness limits | Partial safeguards, not one consistent dataset freshness contract |
| Ingestion provisioning | `src/lib/connectors/provisioning.ts:379` defines `provisionConnector`; production source search found no caller | Helper and tests are not proof that customer onboarding starts and maintains ingestion |
| Credential lifecycle | `src/lib/connectors/tokens.ts:112` and `:141` mark refresh/provider failures as reconnect-required | Temporary failures can become persistent disconnections in this path; historical incidents are not diagnosed by this alone |
| Sync credential propagation | Provisioning can update a source's credentials, but inspected token refresh code does not invoke that update | Token rotation and ingestion credential ownership need an explicit contract |

These are local code findings, not a claim that no external warehouse exists anywhere. Live ingestion configuration, production deployment and multi-day reliability were not verified in this review. Existing shadow workflow outputs remain useful business-logic evidence.

## Proposed architecture

### 1. A durable connection service, independent of the agent

Store customer/account identity, selected platform assets, consent/scopes, credential references and connection health server-side. Models receive permitted tools and opaque connection references, never tokens. Closing the chat or replacing the model must not affect the connection.

Give each OAuth grant one authoritative refresh owner. Concurrent requests must not race to rotate a refresh token; updates need locking or compare-and-swap protection. Separate temporary network failures, throttling, permission failures, configuration errors and confirmed revoked grants. Retry recoverable failures with bounded backoff; request customer reconnection only when appropriate.

[Nango's current documentation](https://nango.dev/docs/guides/auth/token-refreshing) describes proactive refreshing, retry/recovery and failure notifications for supported connections. This is a concrete reason to reopen the previous managed-auth evaluation. It is a candidate, not a selected supplier, and does not remove provider app review or customer consent requirements.

Before selecting vendors, prove that the chosen consent flow can support BOTH ingestion and permitted writes. A sync vendor's OAuth credentials may not be exportable or reusable by Unc. One customer-facing connection may require multiple underlying grants. Do not promise one OAuth screen until this has been demonstrated for each platform.

### 2. A shared ingestion service

Perform a bounded initial backfill, then incremental synchronization per tenant/source/dataset—not per routine. Persist cursors, job receipts, retries and coverage. Use webhooks where supported, plus reconciliation polling. Deduplicate overlapping jobs and apply provider quotas centrally.

Handle late changes, deletions and attribution revisions, not just newly created records. For example, the [official Airbyte Meta connector documentation](https://github.com/airbytehq/airbyte/blob/master/docs/integrations/sources/facebook-marketing.md) documents revisiting historical reporting windows for late conversion attribution. Source versions and field mappings need pinning and live validation.

New keyword research or a previously unrequested external dataset can still require an on-demand API job. Warehouse-first does not mean every possible answer is already stored.

### 3. Durable, tenant-isolated datasets and metric definitions

Retain relevant normalized records with source object IDs and adequate history, not only final summaries. Record observation window, source update time where available, ingestion time, last successful sync, coverage and schema/metric-definition version.

Define grain, currency, timezone and attribution rules. Meta-attributed revenue and store order revenue are different measures; the agent must not silently merge them.

Keep application state, permissions and execution receipts in the existing application database. Choose the analytical store based on measured data volume, query performance and cost. Postgres may suffice for a bounded pilot; ClickHouse is an option for larger analytical workloads, not a prerequisite merely because Cody uses it.

Use tenant-scoped read tools/views, not unrestricted administrative SQL. Apply explicit ownership policies and avoid views bypassing those policies. These boundaries follow the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security); no database permissions were changed during this review.

### 4. One read contract for chat and routines

Each routine declares required datasets, allowed metrics, maximum acceptable age and action capabilities. The read gateway returns data plus source, coverage and freshness status.

Reports can use explicitly labelled older data when policy allows. Decisions requiring current data must wait or fail safely. A query executed now is not evidence that its underlying data is current. Missing data must never become zero.

All enabled routines reuse the same datasets. Turning a routine off changes execution eligibility, not the identity of the customer's connection. Dataset refresh demand should reflect the remaining enabled routines and retention policy. No separate workflow for every switch combination is needed.

### 5. A separate controlled write path

An action should follow this sequence:

`proposal → valid approval/capability → current credentials → fresh object read → conflict/limit checks → write → provider readback → receipt → dataset reconciliation`

The platform remains authoritative for live budgets, stock, permissions and object state. Record before/after evidence and an action ID. Use provider idempotency or conditional writes where available; otherwise maintain deduplication and explicitly handle uncertainty. A timeout after submitting a write must trigger reconciliation, not a blind retry.

A fresh preflight cannot eliminate every concurrent-edit race when a provider lacks conditional writes. Document that residual risk and keep consequential actions supervised. Publishing, messaging and ad changes remain disabled under the current scope.

## Cadence is a product contract, not “occasionally”

Set freshness budgets per decision. A weekly SEO review can tolerate a different age from ad pacing. An hourly reporting target can be a pilot starting point where quotas and provider availability permit; it is not a guaranteed SLA. Live safety checks occur at action time regardless of the reporting cadence. Provider reporting delays must remain visible even after a successful sync.

Historical data can remain useful during a temporary outage under the customer's retention policy. Revocation and deletion requests require their own access/deletion rules; the warehouse is not permission to retain or use data indefinitely.

## Implementation order and acceptance

1. **Prove one Meta connection end to end, read-only.** Validate the consent/token ownership arrangement and start a small historical plus incremental sync. Preserve the existing shadow routines and replace their read adapter with the shared contract.
2. **Close auth recovery gaps.** Test expiry, concurrent refresh, temporary outage, revoked grant and reconnection. Verify the sync service receives current credentials through its supported mechanism.
3. **Connect warehouse reads to Unc and the n8n bridge.** Require tenant, dataset version, coverage and freshness in every result. Do not just add another unused helper.
4. **Prove reuse and durability.** Run three routines against the same snapshot and show no extra platform analytics reads from those routines. Restart the agent and worker and repeat successfully. Measure ingestion separately.
5. **Exercise failure boundaries.** Cross-tenant reads denied; stale inputs block unsafe decisions; partial sync is visible; late corrections and deletions reconcile; temporary failures recover without unnecessary customer login.
6. **Verify actions separately.** Use fixtures first. A real sandbox/draft action requires separately scoped approval, before/after readback and duplicate/timeout tests. Keep production actions disabled.
7. **Observe multiple sync cycles and token-lifecycle cases before expansion.** Capture job IDs, timestamps, sampled source reconciliation, request counts and recovery receipts. Then extend the adapter pattern to other platforms without cloning combinations of workflows.

Vendor selection still needs platform coverage, embedded OAuth constraints, data ownership/export, quotas and realistic per-customer cost measurements. This review does not authorize procurement or justify stacking several independent token refreshers.

## Scope of this review

Research and local source inspection only. No production code, credentials, database state, deployment or external workflows changed. Shopify remains parked. Unrelated local files were left untouched. The architectural direction is well-supported; production reliability remains unproven until the acceptance checks above pass.

