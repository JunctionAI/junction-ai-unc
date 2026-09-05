# Native client-system audit and integration boundary

## 6 September 09:54–09:57 NZ refresh — continuity-first rollout

**Subsequent owner direction:** Tom says all existing agents are in Hyperagent
but their access/routine behavior is not the desired setup. This audit supplies
reference configuration and channel destinations only. Do not build a Hyperagent
invocation dependency as the default migration path. Junction's verified identity,
permissions, stored data, queue and newly approved structured routines own target
execution; preserve client channels through a controlled listener cutover. Native
OAuth/Ask-first constraints below matter only if optional historical access is
later explicitly selected, not as a prerequisite for replacing execution.

[Machine-readable rollout inventory](existing-client-rollout.v1.json) records the
current observed client roster, exact inspected routine definitions and remaining
identity gaps. It is **not** an import, production registration or complete list
of routines. No native agent, schedule, Slack setting, credential or membership
was changed. DOCUMENT_EXISTING mode preserved existing working systems.

Important correction to the older audit below: **H1 is no longer evidenced as
stopped at the model limit.** Its active daily review's Run History shows success
on 6 September at 07:11, duration 5.2 minutes. The actual saved review
`cmtore7cl0aqr07adv64lv605` returns PASS / NO_NEW_APPROVED_LEARNING, with 86 Klaviyo
campaign rows and source timestamp 5 September 19:08:11.737 UTC. Independent
Mission Control SQL at 21:54:58.597027 UTC confirms 86 rows and that timestamp
(microsecond precision .737281); 13 rows still lack metrics timestamps. The
Shopify 71/71 reconciliation is a saved-run claim, not a new independent provider
reconciliation here. Preserve the September 5 failure as history, not current state.

H1's native `#home-invasion-email` invocation is enabled for all relevant messages.
Default channel access is No permissions; the settings show two same-named rows
(one active/responding, one read/write only). Their underlying IDs/workspaces are
not exposed in that view, so **do not merge or delete by name**. Daily source review
is active and explicitly thread-only/no Slack send; Monday Campaign Brief is off.
The agent remains Ask first. No fresh Slack request or delivery test occurred.

Ribbon Rose's exact existing agent is `cmsy91uaw05g207ad4370roas`. Its
`#ribbon-rose-email` invocation is enabled for all relevant messages under
`@Hyperagent`; Ask first, curated knowledge, no schedule and Live mode off.
Historical audit summaries are not current provider/delivery acceptance. The live
roster also includes NZPH Email/Search, Own Your Energy (explicitly DRAFT),
multiple AVGAR/H1/Unity specialists and shared health pods. These are not covered
by the seven Unc seed records and must not be silently omitted.

### Concrete Codex-owned Slack routing gap

At 21:54:47.921082 UTC the Unc database still has **zero Slack links**, and five
seeded non-AVGAR accounts still have zero members. Existing native routes are not
Unc routes. The real constraint remains `UNIQUE(channel, external_id)`.

Source inspection of `channels/links.ts`, `adapters/slack.ts`, the applied inbox
and control migrations, and `outbox.ts` establishes that Unc currently resolves
a Slack sender to one account, can move that link on reinstall, drops Slack's
`thread_ts`, and sends to the installer's DM. This cannot satisfy a founder
working in several client channels with same-thread replies. Workspace identity
checks do not replace a client-channel binding. **Do not just enable messaging.**

Next coherent implementation: explicit workspace + client channel binding,
separate authorized sender identity, original conversation/thread capture,
immutable account/routine/delivery correlation across enqueue and completion,
and same-thread result delivery without an implicit DM fallback. Reuse the
existing inbox/outbox and command registry. Include two clients sharing the same
Slack user, wrong-room refusal, unlink/rebind, queued-result expiry/recovery and
one real bounded owner-only Slack pilot. Do not duplicate working native bots
or let both systems reply to the same live client request during cutover.

Native reuse is conditional: the [current official MCP documentation](https://www.hyperagent.com/docs/concepts/agents/invocations/mcp-server)
describes account-wide OAuth and says Ask-first agents cannot be started through
MCP. The live UI instead mentions Ask first over MCP; this discrepancy is not
permission to switch agents to Auto. Keep existing native Slack working while
confirming the supported scoped integration and approval behavior. No native
OAuth client or invocation was created in this refresh. The connected Slack tool
currently exposes Junction AI `T0BMD3LMWUQ`; searches did not return the H1/DBH
channels, so that connector is not proof of access to their native routes.

This refresh changes the next action; it does not close all-client acceptance.
First Unc Slack pilot should use the already verified AVGAR owner/account, while
H1 is the first independently observed existing-operation continuity case.

**PARTIAL — 6 September NZ / 5 September 2026 UTC.** Read-only native Hyperagent inspection and scoped warehouse/schema reads. This advances the all-client reconciliation; it does not establish that the clients are connected to Unc or that their next runs will succeed.

No agent was invoked, retried, edited, duplicated or rescheduled. No connection, subscription, OAuth grant, model, autonomy setting, workflow, membership or customer delivery was changed. Attached writer capabilities are reported as existing native configuration, not permission for Unc to use them. The Hyperagent setup skill's DOCUMENT_EXISTING mode kept this an audit, not a repair or new setup.

## What is now independently observed

The existing Hyperagent session belongs to Tom Hall-Taylor (`halltaylor.tom@gmail.com`). These native identities supersede old packet/registry IDs **for identifying the inspected agents**, not for assigning customer login rights or importing credentials.

| Client | Inspected native agent | Current attachment evidence | Exact limitation |
|---|---|---|---|
| Home1nvasion | [H1 Email](https://hyperagent.com/agents/cmsy916yd05w707adv5m542qh) | Six attachments: H1 Contacts Read, H1 Email Campaigns Read, H1 Email Campaigns Writer, H1 Shopify Read, Klaviyo and Slack. The writer's selected connection is **H1 Email Campaigns Writer7**, not the older packet's Writer6. | Latest scheduled review failed at model usage limit. Native Klaviyo attachment label alone does not identify its business; the prior saved execution supplies the asset evidence below. |
| Aerspan | [Domes Sales](https://hyperagent.com/agents/cmsy90zxz04qy06ad9u5c0mk4) | Nine attachments: Outlook `mike.ht@aerspanairdomes.com` (read/manage), Sales CRM Read/Writer, Mailbox Sync Writer, Attached Outlook Draft Writer, Threaded Reply Writer, Agent Improvement, Slack and native Supabase. | Outlook has a reconnect-by-11-September warning. Latest inspected desk run was incomplete on research capacity. Native Supabase attachment does not disclose a verified project binding here. |
| Unity MMA | [Unity MMA Operations](https://hyperagent.com/agents/cmt1as9sy121i07ads0jn7svr) | Slack Unity MMA Operations, Google Drive `tom@getjunction.ai` with three read-only folders including subfolders, Unity MMA Operations Supervised MCP. | Current customer-owned grant/route and operational database reconciliation remain necessary. A saved September roster error must not be treated as a currently reproduced database defect. |
| Deep Blue Health | [DBH Email](https://hyperagent.com/agents/cmsy91p0d04mw07adgg777f3n) | DBH Contacts Read, DBH Email Campaigns Read, Slack `@Hyperagent`. | No schedule shown. Generic Slack attachment is not a verified client-channel route. Two saved planning threads are not ongoing execution proof. |
| AVGAR | [AVGAR Paid Ads](https://hyperagent.com/agents/cmsy9115104r406adsnogjmcf) | Eight attachments: AVGAR Google Ads Read, Meta Ads Read, Competitor Ads Read, Shopify Read/Writer, Meta Ads Writer, native Meta as Tom Hall-Taylor, Slack `@Hyperagent`. | Scheduled Shopify warehouse refresh failed at model usage limit. Existing native writers are not part of the authorized Unc shadow scope. |
| Rory O'Keefe | No native mapping established | Native roster search for `Rory` returned no matches under the current filters. Earlier scoped registry search also lacked a match. | This limited search does not prove no system exists. Do not create a replacement agent or invent its owner. |

The scoped custom MCP attachments above use `junction-hyperagent-bridge.vercel.app`. Their visible names do not prove current token health or selected-provider freshness.

Additional existing roster entries include Ribbon Rose Email, NZPH Email/Search and Own Your Energy Content Strategist, outside the seven seeded Unc account records. AVGAR also has Content, Email, SEO, Pod Lead and other native agents. This audit is **not an exhaustive acceptance of every agent**. Do not silently omit these customers from the all-client scope or create accounts/invites just from their names.

## Immediate reliability findings

### 1. Model availability is preventing scheduled data work

- [H1 saved scheduled review](https://hyperagent.com/thread/cmtnbxagd01fy07adb1l1h0ly), 5 September 07:10 local, GPT 5.6 Sol: stopped at the ChatGPT usage limit before completing the review.
- [AVGAR saved scheduled Shopify refresh](https://hyperagent.com/thread/cmtnb0owi01ax07admr9n17yx), 5 September 06:45 local, GPT 5.6 Sol: same limit. Its requested work was only the certified Shopify warehouse refresh, not campaign mutation.
- Both native errors display a reset of **8 September, 20:28 GMT+12**. This is the provider's displayed message, not an independent billing-entitlement query or a guarantee about future availability. No retry, subscription or model change was made.

**Codex-owned infrastructure requirement:** deterministic provider synchronization must have a scheduler/credential owner independent of the reasoning model's availability. Preserve source provenance, tenant scope, rate limits, incremental cursors and freshness checks. A model can consume the resulting snapshot; its failure must not be the only means of detecting or refreshing stale data. Reuse existing working sync rails before adding competing schedules. A cheaper model is not a substitute for this separation.

### 2. Aerspan needs distinct auth and research recovery

The workspace banner says Outlook `mike.ht@aerspanairdomes.com` must reconnect by **11 September 2026** to keep agents running. It shows `Reconnect (1 of 2)`; the second connection was not opened or identified. This warning is not proof the mailbox is already disconnected. Reconnection remains an owner Access Gate.

[Saved Aerspan daily desk](https://hyperagent.com/thread/cmtlvkndr02cs07adfnqx6s3h) reports **INCOMPLETE**: one qualified lead/first-touch draft against a target of fifteen, fourteen short; Exa Websets returned a 401 plan-access failure. The saved trace also records mailbox sync, reply-draft reconciliation, CRM receipts and one historical Slack notification, with zero emails sent. Those are prior native actions, not actions performed by this audit or independently fresh provider readbacks.

An improvement request already exists: `35c946c0-30d5-4a36-90a7-161afc888f9d`. Do not duplicate it or bypass the controller-gated improvement queue. Verify entitlement and a bounded approved repair before spending, weakening lead quality or replacing the research service. Outlook recovery alone would not solve this research failure.

### 3. Unity's saved error is not enough to prescribe a live fix

The saved 3 September roster thread `cmtj8yeho042s06ad8h98x6qt` reports a 24-entry roster hitting `UNITY_ROSTER_DELIVERY_REQUIRES_21_APPROVED_ENTRIES`. The recovered local SQL still contains that old fixed count.

However, current Mission Control function definitions in `unity_mma.record_roster_delivery_receipt` and `get_roster_delivery_preflight` use an approved count of 1–40 matched to a current admin approval receipt, not the old fixed 21-entry exception. A scoped read found 28 `unity_mma.run_receipts`; the six newest selected headers are August 31 baseline records, not September delivery receipts. No matching `approved_weekly_roster` or `weekly_roster_slack_delivery` records were returned by the scoped query.

**Do not claim repaired or still broken.** The native September execution's actual database/profile source is not yet reconciled to this schema. Resolve that source and its current receipt before any production repair or replay. No roster, approval, Slack send or database function was changed.

## Stored data: source time is not agent run time

Direct aggregate SQL on Mission Control (`ebcatvidixdjjwmmades`), checked **2026-09-05 12:19:38.577372 UTC**:

| Dataset | Rows | Newest metrics timestamp | Missing metrics timestamps | Latest campaign send |
|---|---:|---|---:|---|
| `h1.email_campaigns` | 85 | 2026-09-03 19:07:12.249693 UTC | 13 | 2026-03-29 15:05:58.174327 UTC |
| `dbh.email_campaigns` | 195 | 2026-09-04 18:42:52.190189 UTC | 0 | 2026-08-29 01:25:53.803889 UTC |

DBH's oldest metrics timestamp in this read is 18:42:40.380063 UTC on September 4; H1's non-null metrics timestamps are all the value above. At the observation time these newest timestamps are about 17.6 and 41.2 hours old respectively. This does not establish an agreed freshness SLA, campaign completeness or source reconciliation. No raw contact, message body, secret or order data was retrieved.

The [prior H1 successful saved review](https://hyperagent.com/thread/cmtlwh8fc02kl08adrxom0thm), 4 September 07:10 local, supplies useful **historical** asset evidence:

- Klaviyo account `SThdQK`, Home1nvasion, US/Eastern; destination `h1.email_campaigns`. Its recorded metrics timestamp matches the direct SQL read above. Reported revenue is Klaviyo attributed, not Shopify-reconciled revenue.
- Shopify shop `50697207962`, `home1nvasionstore.myshopify.com`; destination `h1.v_orders_daily`; reported source time 2026-09-03 19:06:36.469 UTC. The saved report states a 30-day 69/69 order reconciliation. This audit did not repeat that provider reconciliation.
- Slack `C0BRFLSQ9GW`, `#home-invasion-email`; the saved review reports zero new approved learning and no outward writes.

The correct product state has separate fields for **grant/asset identity, last successful source refresh, completeness/metric semantics, last agent execution and delivery receipt**. A recent agent message cannot refresh a database timestamp; a recent database timestamp cannot turn a failed agent execution into a success.

## Supported Unc integration and missing authority

Official Hyperagent documentation describes an OAuth 2.1 MCP server at `https://hyperagent.com/api/mcp`. Its `threads:read` scope supports reading accessible agents and threads; starting agents/messages and approval operations use separate write/approval scopes. Access is to resources available to the authorizing Hyperagent user, **not a provider-enforced per-Unc-client permission**. [Official MCP scopes and tools](https://www.hyperagent.com/docs/concepts/agents/invocations/mcp-server).

An Access Gate question was sent to Tom for a **server-side Unc, `threads:read`-only** connection. It remains unanswered. No new token or connection has been created. If approved:

1. Use the supported server-side OAuth flow and a revocable encrypted server credential; never copy a browser/Codex session token into production or place credentials in an agent prompt.
2. Restrict reads to explicitly verified native agent IDs and exact canonical Unc accounts. Membership/operator authorization still applies. Do not promote candidate name matches into customer-visible bindings.
3. Store external run identity, original timestamps, status, source link and projection provenance separately from Unc-owned runs. Native results must not inflate Unc's current zero-run state or be presented as n8n executions.
4. Read the minimum necessary approved-client history; keep cross-client content out of customer responses and the browser bundle. Test wrong-client, removed-scope, revoked-grant and stale-data refusals.
5. No `threads:write`, approval-write, run start, schedule or native configuration change is covered by this read-only request. Native Ask First/Auto settings remain unchanged.

This is a supported candidate integration, **not a completed adapter**. Webhooks' queue acknowledgements do not provide historical result evidence, and a public invocation URL is not an acceptable tenant authorization shortcut.

## Delivery order and owners

| Priority | Owner | Next work / dependency |
|---|---|---|
| P0, existing operations | Codex; Tom for new model/plan authority only | Separate deterministic data sync from model availability, reuse scoped existing sources and expose failed/stale states. Do not change native models or add another schedule speculatively. |
| P0, Unc connections | Codex; Tom for the pending read-only Access Gate | Finish canonical native-agent/provider/owner mappings and a restricted external-history adapter. Five seeded clients still lack verified login membership; two AVGAR records remain distinct. |
| P0, first n8n result | Codex + credential owner/Tom, then Nguyen | Pending supported n8n API entitlement/key-scope approval and receiver reconciliation; then original-run registration/permit, separate US/NZ/AU tests and independent receipt acceptance. Frozen wrapper unchanged. |
| P0/P1, Aerspan | Codex; mailbox owner/plan owner where required | Handle the dated Outlook reconnect separately from the existing Exa research-capacity improvement. No duplicate request or unsolicited customer message. |
| P1, Unity | Codex | Reconcile actual native bridge/database source and September receipts before classifying or repairing the historical roster mismatch. |
| Per eligible lane | Codex + Nguyen | Complete concrete lane/data contracts and real result acceptance; native Hyperagent agents do not replace Nguyen's five-lane integration. |
| All-client acceptance | Codex + verified owners; Tom for useful-output acceptance | Finish atomic routine settings/manual-run acceptance, auth/fresh-read coverage, sync/scheduling/history/monitoring and sign-in → correct account → chosen job → useful saved result → reload → switch-off. |

This audit is meaningful reconciliation progress, not a release or completion gate. Full B01–B24 and all-screen/all-client acceptance remain active. Reuse this dated evidence; do not keep rereading unchanged blocked runs or run the full test/build/deployment pipeline for a documentation-only update.
