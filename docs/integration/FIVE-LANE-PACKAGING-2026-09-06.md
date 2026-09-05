# Five-lane packaging brief — Codex → Nguyen and Tom

6 September 2026 NZ. This is the exact mapping and deliverable handoff, **not a claim that later wrappers are registered/callable**. First priority remains the narrowly scoped keyword Ignore Bots correction already sent on Upwork. Preserve Header Auth, pinned origin, authority checks and provider credentials; return the validated new revision. Codex owns compatible database/app repinning and the authorized run. Do not run providers while awaiting that context.

## 1. IDs and deliverables

There are **18 reported-ready capabilities across five areas**, not five single workflows. Six additional routines remain blocked on inputs/access. No workflow for every switch combination.

| Area | Nguyen capability | Unc ID | Required deliverable |
|---|---|---|---|
| Meta | Daily decisioning | D02-W01 | `generic`: ad-set verdict/proposal with actual evidence and policy inputs |
| Meta | Creative testing | D02-W02 | `generic`: inspectable candidate/test plan; distinguish proposed concepts from approved asset IDs |
| Meta | Hook rotation | D02-W03 | `generic`: evidenced tired ad + available variant or an explicit missing-variant ask |
| Meta | Ad fatigue | D02-W04 | `generic`: evidence-based pause/keep proposal, never an executed pause |
| Meta | Creative test planner | D02-W06 | `generic`: ranked hook × format × offer hypotheses, measured evidence separated |
| Meta | Budget pacing | D02-W07 | `generic`: spend/budget/window/currency evidence and proposed response |
| SEO | Keyword opportunity | D03-W01 | `keyword_list`; existing `unc.keyword-shadow.v1` is the only finalized callable contract |
| SEO | Content gap | D03-W02 | `content_gap`: proposed pages/H1s, rationale, page type and source evidence |
| SEO | SERP watch | D03-W05 | `generic`, but **source adaptation required**: current catalog is Search Console; your DataForSEO snapshots are not GSC average position/clicks |
| SEO | Referring-domain/backlink gap | **D03-W07 reserved** | Separate referring-domain gap report. Not D03-W06. Catalog/adapter implementation is still Codex-owned |
| Content | Viral hooks | D01-W02 | `hook_list`: actual hook lines + mechanism/shooting brief; search-derived hypotheses, not claimed native viral performance |
| Content | Customer questions | D01-W03 | `question_list`: question + content idea/format/stage; label search research rather than first-party customer tickets |
| Email | Welcome | D05-W01 | `email`: actual proposed replacement subject, preview and body, with known flow/message identity or explicit missing input |
| Email | Segmentation | D05-W03 | `generic`: proposed definitions and measured sizes only where observed; Klaviyo is not Shopify customer evidence |
| Email | Post-purchase | D05-W05 | `email`: actual proposed subject/preview/education body and timing rationale; product/delivery source explicit |
| Email | Review timing | D05-W06 | `generic`: proposed/current delay, evidence and suppression limitations; do not invent a measured peak |
| Email | Campaign calendar | D05-W07 | `calendar`: six-week dated themes/channels/briefs, not only past campaign titles |
| Google Ads | Keyword → BOFU plan | **D02-W09 reserved** | Separate Paid Ads campaign-plan routine: proposed groups/keywords/negatives and real customer/market/network/currency data; no created campaign |

The two reserved IDs are assigned here by Codex to prevent ambiguous reuse; they are **not present in the executable catalog and cannot be enabled or called yet**. The existing 35 executable routines and frontend counts remain unchanged. No source choice grants provider scope automatically.

## 2. Exact artifact guide and pipeline, without guessing

The regenerated [`unc-routine-manifest.v1.json`](unc-routine-manifest.v1.json) now carries, for every existing routine:

- `outputGuide`: the exact current skill's example JSON, including `kind`, title/body, items, per-item `meta` and evidence fields.
- `outputGuideIsSchema:false`: placeholders/examples are not a strict JSON Schema or permission to manufacture values. Runtime structural validation is `src/lib/artifacts/validate.ts`; semantics remain in the skill's `check`/`prompt` and the lane boundary notes.
- `maxItems` and `effectiveProduceMaxItems`, the actual read descriptors and minimum inputs.
- `preProducerDefinition` and `postProducerDefinition`: complete checks/decisions/gates, not only node names. These expose why swapping a produce webhook alone can still block a supposedly ready lane.
- `packaging.lanes`: all 18 mappings, required evidence and explicit source/adapter limitations; `packaging.blockedInputs`: the six current input-dependent routines.

For supported routines the artifact envelope is `{kind,title,body,items:[{title,body,meta?}],evidence?:[{source,ref}]}`. Use the selected routine's actual kind and limit. A missing deliverable cannot be disguised as a short generic recommendation of another kind. Unknown numerical metrics stay null/unavailable; source labels must identify data actually read. Catalog numeric defaults are implementation defaults, **not approved AVGAR business targets or spend authority**.

Only D03-W01 presently has the full authenticated request, one-use authority, receipt and independent revision-verification path. Later wrappers need Codex's adapter/authority extension before activation. Do not send other IDs to the keyword-only endpoint or relabel them `unc.keyword-shadow.v1`. Returning a valid artifact alone does not prove receipt/provenance acceptance.

## 3. What the existing saved Email tests actually return

Codex independently read the seven named saved executions through the worker's read-only API access. The reads retrieved result structure and metadata, not exported credentials/customer rows. All seven are terminal `success`; this is historical execution evidence, not a fresh provider reconciliation or new Unc run.

| Saved execution | Actual workflow/revision | Current final-output evidence |
|---|---|---|
| Meta #53 | WljLEMABNjfUkbB1 / 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Smoke receipt with six enabled IDs, opportunities, ad decisions, product-price/timing policy fields |
| SEO #59 | OUerIfgAkMnhkuen / cda63062-b8c5-4f3a-a718-a71bd6e1040f | Smoke receipt with four enabled IDs and four opportunities; DataForSEO keyword/SERP/backlink sources |
| Welcome #63 | DV5Wv6wXlzpz4zeN / da8119a0-72b4-4b36-9f44-0ee078065eb8 | `business_output`: recommendation, welcome flow name/status and welcome list name; no separate subject/preview/email-body fields |
| Segmentation #69 | DV5Wv6wXlzpz4zeN / 7ab6a022-f60d-4c50-b7d3-6e80bcd39963 | Recommendation/proposed classification; checkout/placed-order aggregate and segment evidence |
| Post-purchase #70 | DV5Wv6wXlzpz4zeN / 66a43f6d-083f-49cf-842e-0cb54b7d295d | Recommendation/proposed timing plan; fulfilled/delivered/product evidence; no separate subject/preview/email-body fields |
| Review timing #71 | DV5Wv6wXlzpz4zeN / f96c1b82-348a-4711-823f-a9f68498793e | Recommendation/proposed timing plan; Ready to Review event evidence and semantics note |
| Calendar #62 | DV5Wv6wXlzpz4zeN / 5551bb2c-980c-41d5-a8e8-fe7a71a3d03d | Recommendation/recent sent titles; no structured six-week calendar entries |

These are useful upstream recommendations. They are not yet the complete Unc draft deliverables in section 1. When packaging, retain that real evidence and add the actual inspectable copy/definitions/calendar items where required. Do not simply label an audit recommendation as a finished email or calendar. If material is missing, return the need rather than inventing it. Each Email test used a different saved revision; a current shared wrapper must re-establish each selected lane, not infer all five still pass from the last revision alone.

## 4. Credential and client context contract

Keep existing native n8n provider credentials in n8n. They belong to the verified AVGAR pilot binding; never export their plaintext, put them in a Code/Set field, copy OAuth into every routine or use them for another client. Unc's receiver secret and execution-reader API key are different credentials with different jobs.

Codex supplies the server-owned account/generation/routine/run and verified asset/client configuration. The model and incoming chat cannot choose credentials, arbitrary accounts, an arbitrary callback URL or a new provider scope. Another tenant needs its own verified binding and refresh owner. Credentials in each workflow are references to those native records, not customer secrets embedded in exported workflow JSON.

## 5. Shared data, routine selection and metric meaning

Each selected routine is independent. A shared dataset is keyed by tenant, verified asset, query/grain/window/timezone/currency and source freshness. One routine can reuse another's certified dataset only if that identity matches; its enabled switch is not silently changed. A cached result is not a fresh API read just because an agent used it recently. Deterministic sync must not depend on the model being available.

Codex owns Unc storage/sync/read APIs, run/artifact/receipt persistence, idempotency and independent saved-execution verification. Nguyen owns provider extraction through his native credentials and the precise source semantics returned. Until an ingestion contract is live for a provider, keep evidence in the returned authorized result; do not write directly into another client's Unc tables or invent a common warehouse connection.

Meta: preserve ad vs ad-set vs campaign grain, attribution/reporting window, account timezone and currency. Tom approved a maximum CPA equal to **50% of the relevant promoted product's current market price in the same currency**. No store-wide AOV substitution; missing product mapping/FX/current price means hold. That ceiling does not establish a separate scale target or authorize spend. Pacing needs actual daily/lifetime budget semantics and elapsed time.

SEO: DataForSEO rank observations cannot supply Search Console clicks/impressions/average position. Position change needs an earlier observation for the same query/market/language/device/search engine. Content/page gaps are separate from referring-domain gaps. Content: search questions/hooks are not measured ticket frequency or native social performance. Email: sampled events are not a complete customer population, Ready to Review is not necessarily a completed review, and Klaviyo attribution is not automatically reconciled Shopify revenue.

## 6. Blocking inputs and next work

Keep these explicitly unavailable: D02-W05 creator rights/handles; D02-W08 approved organic-performance source; D03-W03 intended AI-search source; D03-W04 separately reopened CMS/Admin access; D05-W02 contact_frequency_cap; D05-W04 margin_floor. Do not infer margin from the CPA ceiling. Shopify Admin/OAuth work stays parked; existing read credentials remain intact.

Nguyen: keyword setting correction first, then package the independently selected deliverables above with exact source evidence. Codex: validate the new pin, complete pilot execution, extend the later-lane authority/adapters and distinct catalog IDs, and prove storage/customer delivery. Tom: genuine missing rights/commercial inputs and usefulness review only. No production campaign, message, ad or spend activation is part of this handoff.
