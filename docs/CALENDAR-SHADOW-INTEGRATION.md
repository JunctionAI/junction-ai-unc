# D05-W07 calendar shadow: Unc implementation and remaining admission work

6 September 2026 NZ. **Source preparation, not an activated integration.**

This adds the second explicit protocol to Unc's runtime without changing the
frozen `unc.keyword-shadow.v1` request or receipt. The keyword database ledger,
authority endpoint and historical pin cannot authorize a calendar.

## What this contract does

`unc.campaign-calendar-shadow.v1` maps only `D05-W07` / `campaign_calendar` to
an artifact of kind `calendar`: six proposed weeks, not six scheduled campaigns.
It is a Klaviyo campaign-metadata adapter, distinct from the built-in calendar's
optional Shopify orders/products and Klaviyo performance reads. Those native
reads are explicitly absent from this adapter; no performance, launch/event or
seasonality evidence is inferred from their absence.

The source schema is `src/lib/n8n/calendarShadowContract.ts`. Its exact keys are:

```text
contract, accountId, workflowId, workflowVersion, routineId, routineKey
client: primaryDomain, timezone, currency, bindingId, klaviyoAccountId
data:
  provider: mode, queryHash
  stored:   mode, queryHash, snapshotId, fetchedAt, maxAgeSeconds
```

`workflowVersion` is an expected frozen revision, never an assertion from the
executing workflow. `bindingId` is a server-owned, verified account/asset
binding record, not a credential or a user-entered platform ID. The contract does
not establish that such a binding already exists. Native n8n credentials stay in
n8n; secrets do not appear in this JSON. A stored-data allowance must pin the
actual source snapshot, query and fetch time; the current maximum configurable
age is one day, not an automatic freshness policy for every customer.

## Implemented Unc runtime path

1. `calendarShadowSpec` prepares a manual trigger → explicit n8n producer → draft
   review gate → receipt. No registration, switch, schedule or provider call is
   created by preparing the spec. Additional pre-producer reads are rejected.
2. The engine requires **separate** calendar reservation, start-claim and atomic
   completion adapters before any engine node. A claim rejection or uncertain
   reply does not start the run. Original snapshot identity must match exactly.
3. `HttpN8nBridge` requires the account-specific active registration, calendar
   receiver credential, independent execution reader and calendar admission
   adapter. Generic producer calls to the reserved calendar receiver are denied.
   The calendar token has no inherited Shopify/Klaviyo read scopes.
4. POST-only `calendarShadowAuthority` authenticates the stored run and consumes an existing
   allowance through the injected calendar admission adapter. It checks the
   matching protocol, current context, spec fingerprint, registration, receiver
   pin, freshness and original `calendar_shadow` continuation. It returns only
   canonical contract/run fields. Batch 62 adds the separate Next route and
   account/generation/run-bound database adapter; release evidence is recorded
   in [the ledger implementation report](CALENDAR-SHADOW-LEDGER-2026-09-06.md).
5. Before another network wait, the bridge checkpoints the sanitized calendar,
   reported execution receipt and SHA-256 of the original received business
   envelope. Unknown root/item metadata is excluded from the candidate.
6. The independent GET-only reader verifies the saved executing revision and
   exact original trigger request. A separately pinned result-builder node must
   have one successful output containing the actual artifact/receipt envelope.
   Its digest must match the received response; matching execution identity alone
   cannot certify different returned work. No raw saved headers are projected.
7. Only verified results may reach the original post-producer draft continuation.
   The engine delegates permanent artifact/receipt/run persistence to its
   calendar completion adapter. A lost completion response preserves the original
   run for reconciliation. Generic async callbacks and the keyword completion
   planner cannot complete a calendar.

Historical verification is implemented separately: it checks the original
dispatch/authorization/execution window and both digests, and retains the source
timestamp. Batch 62 adds database-backed archive recovery and atomic completion;
it does not automatically poll or redispatch unfinished work. The operator must
name the original account/generation/run/permit. Customer recovery UX and live
failure/restart acceptance remain separate gates.

## Output and receipt semantics

- Six consecutive Monday `week_start` dates, starting with the Monday strictly
  after the run's date **in the client timezone**. Monday runs start next week.
  Date-only arithmetic survives DST and year boundaries.
- Each item has a theme, `email` / `sms` / `email+sms` channel and `timing_basis`:
  `hypothesis` or `observed_campaign_history`. A channel is proposed content,
  not authorization to contact anyone.
- An observed-history anchor requires nonempty campaign history, a matching
  `klaviyo_campaign` evidence reference and the pinned account in the reference:
  `klaviyo:<klaviyoAccountId>:campaign:<campaignId>`.
- This initial contract does **not** accept approved-event claims: no approved
  event source is included yet. Empty campaign history can support a clearly
  labelled timing hypothesis, not an invented historical pattern.
- Reported receipt: matching contract/account/run/routine/workflow/client,
  `workflowVersion: null`, `revisionEvidence: pending_unc_verification`, actual
  execution ID, bounded start/finish times, `mode: dry_run`, `status: succeeded`,
  `executedAction: none`.
- Provider evidence: `name: klaviyo`, `dataset: campaign_metadata`, exact
  `accountId`, `bindingId`, `queryHash`, `source`, `complete: true`, nonnegative
  integer `itemsCount` and actual `fetchedAt`. Live reads require HTTP 200 and a
  source timestamp within execution. Stored reads require the exact pinned
  snapshot/time and remaining freshness at completion; no new HTTP-read claim.
- Independent verification adds the actual revision and request/result digests.
  It does not certify subjective copy quality or the truth of every narrative
  claim. Accepted real-input business-output fixtures remain a separate gate.

## Server configuration — names reserved, not configured or live

```text
N8N_CALENDAR_SHADOW_RECEIVER_URL
N8N_CALENDAR_SHADOW_RECEIVER_TOKEN
N8N_CALENDAR_SHADOW_WORKFLOW_ID
N8N_CALENDAR_SHADOW_TRIGGER_NODE_ID
N8N_CALENDAR_SHADOW_RESULT_NODE_ID
```

The reserved receiver URL is
`https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow`.
**No wrapper has been created at that URL by this change.** Do not invoke it.
The existing independently authenticated execution API can serve both protocols,
but workflow/trigger/result pins are distinct; the calendar cannot fall back to
keyword pins or reuse its receiver token.

## Acceptance still required before production dispatch

**Batch 62 implements the durable path:** credential/asset reference bindings,
one-use run/dispatch/authority ledger, immutable checkpoints/results, atomic
completion and GET-only recovery. Real isolated PostgreSQL tests exercise the
actual engine, database adapters, authority and saved-result projection, including
role denial, tenant/source boundaries, concurrency, expiry after locks and
rollback. `runCalendarShadow` explicitly selects an accepted binding and requires
owner authorization plus pinned receiver/reader configuration before issuance.
This is not yet generic customer chat/schedule admission or live acceptance.
Codex still owns handoff acceptance, binding/receiver packaging, customer-facing
selection/recovery and the bounded live run with independent readback.

**Handoff gate:** accept Nguyen's corrected calendar output/examples and exact
inventory. Independently bind the native credential to the intended Klaviyo
account. Package the callable adapter only after his handoff; do not edit or
execute his working workflows in the meantime. This source change does not
reassign our adapter/database work to Nguyen or request a keyword redesign.

**Live gate:** a separately authorized, bounded run window with the intended
routine enabled and account unpaused, followed by real saved-execution,
artifact/receipt and client reload checks. No such window is opened here.

## Original Batch 61 verification boundary

Final local checks at 06:48 NZ: 225 test files / 2,993 tests, including 44 calendar
cases; production Next build and app TypeScript, standalone-worker TypeScript,
focused ESLint and `git diff --check` pass. No production deployment is claimed.

The new tests exercise the actual engine, bridge, token authentication, authority
handler, saved-execution projection and original draft continuation using
synthetic HTTP and a clearly labelled in-memory ledger. They cover timezone/DST,
six-week structure, source freshness, wrong tenant/asset/binding/query, separate
reader/credential/permit pins, exact returned-output digest, failed verification,
checkpoint preservation, forbidden callback/planner paths, no pre-producer reads
and no executor calls. They are **not** live provider, durable SQL, two-process
concurrency, production calendar, scheduling or second-client acceptance.

The B01–B24/all-client launch goal remains intact and incomplete. No production
schema, environment, registration, account pause, routine switch or workflow is
changed by this batch.

## Batch 62 continuation

The database-backed path now has real SQL evidence, not just an in-memory ledger.
See [current implementation and release status](CALENDAR-SHADOW-LEDGER-2026-09-06.md).
The live customer calendar remains unproven until the handoff and run gates above.
