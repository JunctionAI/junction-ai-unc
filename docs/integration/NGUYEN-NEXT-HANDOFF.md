# Nguyen: next Unc integration delivery

This brief supersedes the earlier architecture suggestions. Keep the useful workflows and existing authorized credentials; do not rebuild everything or make a workflow for every combination of switches. Codex owns the Unc backend, account data, dispatch, adapters and receipt storage. Tom supplies business choices and unavoidable owner consents, not integration schemas.

**Latest business decision:** Tom confirmed US, NZ and AU, with maximum CPA equal to 50% of the relevant product price. Use `docs/integration/AVGAR-PILOT-POLICY.md`. This does not set a new scaling target or authorize ad changes. Keep each market's search results separate and use verified product/price/currency mappings.

## 1. What to build next

**Handoff received:** your published keyword wrapper `XiXJKuph1fAeH9pe` and denial execution 72 are independently visible. The fixed origin placeholder needs `https://junction-unc.vercel.app`, followed by validation and a newly published/frozen revision. Do not pin the old revision as origin-configured or run the paid pilot yet. Exact findings, ownership and copyable reply: [D03-W01 wrapper handoff](D03-W01-WRAPPER-HANDOFF-2026-09-05.md). This supersedes the instruction below to build a new keyword wrapper: reuse the one delivered.

**Deliver one authenticated, keyword-only callable wrapper for `D03-W01` first**, using the existing DataForSEO credential and proven SEO logic. The full request/response contract is in `docs/KEYWORD-SHADOW-INTEGRATION.md`; contract version is `unc.keyword-shadow.v1`.

- Execute only `keyword_opportunity`, not all SEO lanes followed by filtering the result.
- No external writes. No publishing, messaging, ad changes or enabling production schedules.
- Use a dedicated encrypted n8n Header Auth credential for the receiver. Do not reuse the Klaviyo credential or put secrets in a Code node/export.
- Use a separately pinned Junction origin for `/api/n8n/shadow-authority`; verify the supplied run-scoped token and exact account/run/routine before a paid provider request. Do not trust a caller-supplied `dataBaseUrl` as authority.
- Validate client configuration against the allowed pilot binding. No silent fallback to a hard-coded AVGAR client if another account calls.
- Return `{artifact, executionReceipt}` synchronously within 60 seconds. No HTTP 202/callback mechanism for this pilot.
- Validate DataForSEO top-level and task status codes and record its actual task ID. An HTTP 200 by itself is not successful provider evidence.
- Return an explicit missing-input/error result when blocked, never a generic successful draft. Codex's explicit shadow adapter will not silently fall back to an LLM.

Send back: exact callable URL, workflow ID, tested/published revision/version **in the handoff**, credential *name/reference only*, input example without secrets, real success execution ID, real failure/denial execution IDs, measured runtime, and confirmation of zero provider mutations. If it requires a new wrapper workflow ID, send that actual ID so Codex can bind it deliberately; do not claim the original parent ID ran the wrapper.

**Revision clarification (5 September):** the workflow response must return `executionReceipt.workflowVersion: null` and `revisionEvidence: "pending_unc_verification"`, alongside the actual `workflowId`/`executionId`. Request `shadow.workflowVersion` is only Unc's expected pin. Codex independently reads the named execution's saved revision/trigger identity before enriching/storing a verified receipt; comparing only the latest workflow or echoing the expected pin is not proof. No extra version-discovery API call is needed inside your workflow. Freeze the tested revision after handoff; identify any child executions separately. The concrete independent reader/access and matching deployment are Codex-owned activation gates. Full details and updated JSON are in `../KEYWORD-SHADOW-INTEGRATION.md`.

**Codex-side update:** the independent execution reader is implemented/tested, off by default and not live-proven. It reads only the named saved execution, checks the actual revision and binds the original webhook business payload. There is no new field for your response and no API-key/version lookup work inside your workflow. Codex will resolve the webhook node pin from your final wrapper handoff. Public API access is a separate activation dependency: the workspace currently shows a trial and n8n documents public API access as unavailable during a trial. Do not bypass that with a browser session or echo the requested revision. See `N8N-EXECUTION-READER.md`.

The run-scoped token is not a provider token and not a root signing key. Codex provisions and reconciles backend secrets without sending Tom secret values to relay. Receiver-token metadata is now deployed on the worker; that does not prove a matching value or callable endpoint.

## 2. Routine IDs and an important integration correction

The generated inventory `docs/integration/unc-routine-manifest.v1.json` comes from the actual executable Unc specs. It lists all 35 IDs, input reads/scopes, output-contract source and steps that run before the replaceable n8n step. It is regression-tested against the code.

| Existing Meta lane | Unc routine ID |
|---|---|
| Daily paid decisioning | `D02-W01` |
| Creative testing sprints | `D02-W02` |
| Hook rotation | `D02-W03` |
| Ad fatigue watch | `D02-W04` |
| Creator whitelisting | `D02-W05` |
| Creative test planner | `D02-W06` |
| Budget pacing | `D02-W07` |
| Organic-to-paid promotion | `D02-W08` |

| Existing SEO capability | Unc mapping |
|---|---|
| Keyword opportunity | `D03-W01`, first pilot |
| Content gap | `D03-W02`, validate content-gap semantics |
| AI search visibility | `D03-W03`, blocked until actual probe/data |
| On-page fixes | `D03-W04`, requires proper CMS/Admin rights before any write |
| SERP position watch | `D03-W05` |
| Referring-domain/backlink gap | **Not `D03-W06`.** That ID currently means competitor page/content gap. Codex will add a distinct versioned mapping; don't overwrite the existing meaning. |

Content hooks and customer questions correspond to `D01-W02` and `D01-W03`. Email is `D05-W01`–`D05-W07` in the manifest; please identify exactly which five were proven. A Google Ads BOFU campaign plan does not yet have an agreed dedicated ID in this handoff; send its output semantics and Codex will map it explicitly.

**A webhook registration currently replaces the produce step, not the whole routine.** Some Meta routines have reads/checks/decisions before that step, using metrics not yet supplied by Unc. Therefore registration alone cannot prove integration. Codex owns preparing explicit shadow adapters so your proven decisioning can actually run while preserving tenant, switch, approval and no-write controls. Tell us which reads/decisions your lane owns; do not work around this by duplicating those decisions or inventing missing metrics.

## 3. Credentials: connect once, use across eligible routines

Two supported arrangements must be explicit:

1. **Unc-owned customer connection:** one encrypted connection and verified provider account/asset binding per customer/platform. n8n receives a short-lived, run-scoped data capability and uses the Unc proxy; it does not receive the customer's access/refresh token. Unc owns refresh and reconnect handling.
2. **Existing n8n-owned pilot connection:** retain the credential already bound to the tested AVGAR workflow. Keep this wrapper explicitly AVGAR-only. For another customer use a deliberately provisioned, isolated credential binding/template instance; never route them through AVGAR's credential. n8n owns that grant's refresh while it remains there.

DataForSEO can be a Junction-owned provider account with explicit per-customer query context and usage attribution. It is not necessarily a customer OAuth connection. That does not authorize a customer to query arbitrary tenants or exhaust the shared provider account.

No raw secrets in workflow JSON, prompts, inputs, receipts or GitHub. No arbitrary incoming credential ID used as a trusted binding. No duplicate OAuth login per routine or second refresh owner for the same grant. Provider revocation, scope changes and non-renewable token expiry can still require customer consent; caching does not eliminate this.

## 4. Shared data and workflows

Target structure:

`verified connection → independent ingestion → account-scoped data → selected routines → artifacts/receipts → Unc response`

Routine selection is data/configuration, not separate code for every combination. Shared ingestion runs once as needed, not once per workflow. A routine may consume a prior output through an explicit account/version/freshness dependency; it may not silently enable another disabled feature.

Codex has implemented an initial Meta reporting-snapshot store and opt-in worker/proxy readers. A live canary on September 5 saved one exact ad-set-level query and reused it without another provider query. Account, connector, external asset, query and source time are checked. Missing/stale data fails closed.

This is **not yet a complete historical warehouse**, and production routing/scheduling remains off. It currently stores exact queries with a UTC reporting-day key, 15-minute reuse and a 60-minute source-age limit. Provider window/timezone/attribution semantics, historical backfill, other providers and retention are further work. Do not assume a generic table contains every dataset you need.

Please supply each lane's required dataset/resource, level (account/campaign/ad set/ad), fields, filters, attribution/window/timezone, maximum acceptable age, and what counts as missing vs zero. Codex then owns the stored-data/query contract. For providers only n8n currently authenticates to, agree the ingestion endpoint/schema with Codex before writing directly to any Unc table.

Meta safety fixes now reject capped/incomplete pagination and missing spend, and mark unknown purchase metrics/budgets as unknown rather than zero. Unsupported fatigue/trend/test-tag metrics still need a proper definition and source. Don't treat these unavailable values as a business recommendation to pause/scale.

## 5. Result and receipt ownership

Unc writes `routine_runs`, `artifacts` and `receipts`. For the keyword pilot, the verified returned execution receipt is stored in `artifacts.meta.executionReceipt` and `receipts.payload.externalExecution`. The receipt must bind the actual account, run, routine, workflow ID/revision, provider task and timestamps; `mode=dry_run` and `executedAction=none` are mandatory.

Do not write directly to runtime tables or add a second scheduler. Do not let the model manufacture execution proof. A success claim is accepted only after Codex independently checks the n8n execution and reads back the correlated Unc artifact/receipt.

## 6. Delivery order and current blockers

1. Nguyen has delivered the keyword wrapper and missing-origin denial. Set the exact canonical origin, validate/test and return the final published revision, as recorded in the wrapper handoff above. The current delivery is not yet a successful provider round trip.
2. Codex has completed the archived AVGAR context repair and matched app/worker release (`d95aaa403217422dc53d655a4ff9b305516577c6`). AVGAR automation remains paused while delayed-work generation fencing and pilot admission are completed. US/NZ/AU, the 50%-of-product-price CPA ceiling and Tom's discovery seed **golf travel bag** are recorded in current AVGAR context. Other unconfirmed business settings remain unknown. Do not overwrite these with the old `travel bag`/location `2840` test values; validate a separate provider location/language binding per market.
3. Codex completes backend configuration, including the missing worker signing root and independent execution API access, binds only the pilot account/final revision and performs the real shadow round trip after admission gates pass. No paid provider call has been made for this handoff.
4. Together, integrate the six proven Meta lanes using explicit adapters and agreed metrics, then other ready lanes. Keep blocked capabilities visibly unavailable.
5. Codex proves phone/web experience, isolated second-client onboarding and ongoing sync/recovery before claiming the full product works.

Please keep Shopify reinstall/OAuth work parked as requested: Codex freshly verified the existing Shopify read connection. Report any separate CMS/Admin write permission needed, but don't reinstall working authorization to solve a different issue.

Tom should not need to carry technical IDs, credentials or schema decisions between us. This packet gives both sides a stable contract; Codex will do the Unc-side binding after your tested endpoint is ready.
