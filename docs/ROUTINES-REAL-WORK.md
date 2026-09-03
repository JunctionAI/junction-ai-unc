# Routines produce real work

Every one of Unc's 35 catalog switches has a built-in skill contract. An eligible run must produce
an inspectable artifact before asking for approval, or stop with an honest explanation of the
source or founder input it needs. A switch is not considered useful merely because it has a name,
schedule, connector row, or model prompt.

```text
TRIGGER -> READ* -> CHECK? -> DECIDE? -> PRODUCE -> GATE -> EXECUTE? -> RECEIPT
```

Some checks and decisions can end a run before production when there is genuinely nothing to do.
Ten launch-wave routines are draft-only. Twelve additional wave-2 routines produce research,
plans, or supervised drafts. Thirteen wave-2 routines produce a proposed destination mutation,
but an artifact is not authority to execute it.

## What each node means

| Node | Contract |
|---|---|
| `trigger` | Declares cadence and deduplication. A schedule is not evidence that the worker ran. |
| `read` | Requests one named platform resource and records provenance. `unavailable` means Unc could not ask; it is never converted into a claim that nothing happened. Optional research reads can enrich profile-grounded hypotheses, while mutation inputs remain strict. |
| `check` | Applies deterministic evidence thresholds. It skips or fails rather than asking a model to invent missing signal. |
| `decide` | Selects a declared option and resolves bounded parameters. The selected option, reasoning, spend, and redacted params become proposal context. |
| `produce` | Runs the routine's pure material check, then creates and validates one artifact through the built-in producer or a registered n8n workflow. Producing is not an outward action. |
| `gate` | Shows the artifact and exact proposed consequence. In dry-run mode this becomes a `Would ask ...` receipt; it creates no live authority. |
| `execute` | Exists only on the thirteen mutation routines. It consumes the typed deterministic mutation, not free-form artifact prose, and may run only after a valid run-level approval. Unsupported actions and disabled risks fail closed. |
| `receipt` | Records what was read, drafted, proposed, blocked, or applied. Configuration, a request shape, or HTTP 2xx is not provider readback. |

## All 35 skill contracts

| Domain | Count | Routines |
|---|---:|---|
| Content | 8 | D01-W01 Founder content engine; D01-W02 Viral hook mining; D01-W03 Customer-question mining; D01-W04 UGC creator pipeline; D01-W05 Social repurposing; D01-W06 Winning elements library; D01-W07 Trend watch; D01-W08 Content performance learning |
| Paid ads | 8 | D02-W01 Daily paid decisioning; D02-W02 Creative testing sprints; D02-W03 Hook rotation engine; D02-W04 Ad fatigue watch; D02-W05 Creator whitelisting; D02-W06 Creative test planner; D02-W07 Budget pacing guard; D02-W08 Organic-to-paid promotion |
| SEO | 6 | D03-W01 Keyword opportunity scan; D03-W02 Content gap analysis; D03-W03 AI search visibility; D03-W04 On-page SEO fixes; D03-W05 SERP position watch; D03-W06 Competitor gap watch |
| Sales | 6 | D04-W01 Lead research & scoring; D04-W02 Supervised outbound drafts; D04-W03 Meeting brief builder; D04-W04 Follow-up cadence; D04-W05 Win/loss capture; D04-W06 Pipeline hygiene |
| Email & SMS | 7 | D05-W01 Welcome flow tuning; D05-W02 Abandoned cart recovery; D05-W03 Segmentation refresh; D05-W04 Winback campaign prep; D05-W05 Post-purchase education; D05-W06 Review request timing; D05-W07 Campaign calendar prep |

Each card declares its purpose, output shape, minimum material, craft rules, apply boundary,
examples, and explicit limits. Its pure pre-model check returns either the material used or exact
`needs`. There is one source file per routine under `src/lib/runtime/skills/`; `skills/index.ts`
exposes every catalog id and `catalog-specs.ts` binds every `ProduceNode` to the matching card.

## Launch-wave minimums

These ten routines can be tested first because they are draft-only and most can work from the
business profile or a founder answer while connections are still being established.

| Routine | Artifact | Honest minimum | Helpful sources or fallback ask |
|---|---|---|---|
| D01-W01 Founder content engine | `post_set` | substantive site profile or at least three business memories | Gorgias, LinkedIn, Shopify; ask `about_the_business` |
| D01-W03 Customer-question mining | `question_list` | tickets/reviews/comments or grounded site FAQ/product text | Gorgias, Shopify, Instagram; ask `customer_questions` |
| D01-W05 Social repurposing | `post_set` | one recent source post | Instagram, LinkedIn, YouTube; ask `source_post` |
| D03-W01 Keyword opportunity scan | `keyword_list` | site category/products, with hypotheses labelled for validation | Search Console, Shopify; ask `about_the_business` |
| D03-W02 Content gap analysis | `content_gap` | substantive site profile | Search Console and competitor research; ask `about_the_business` |
| D04-W01 Lead research & scoring | `lead_brief` | founder's target description | HubSpot can add provisional real-row scores; ask `target_description` |
| D04-W02 Supervised outbound drafts | `outreach_draft` | an approved lead brief or founder-pasted brief | HubSpot and Gmail; ask `lead_brief` |
| D04-W03 Meeting brief builder | `meeting_brief` | meeting identity/context | HubSpot, Gmail, future calendar reader; ask `meeting` |
| D05-W02 Abandoned cart recovery | `email` | a Shopify store whose abandoned checkouts can be read | Klaviyo is helpful; Shopify remains required |
| D05-W07 Campaign calendar prep | `calendar` | goal, plan, and what the business sells | Shopify and Klaviyo; ask `about_the_business` |

The other cards are not placeholders. A skill either uses certified reads, works from explicitly
labelled founder/profile material, or asks for the exact missing input. Where research is not
measured, its output must say hypothesis. Connecting a platform by name never proves a source read.

## Mutation boundary

The thirteen routines with an `execute` node are:

```text
D02-W01 D02-W02 D02-W03 D02-W04 D02-W07 D02-W08
D03-W04
D04-W05 D04-W06
D05-W01 D05-W03 D05-W05 D05-W06
```

Their current capability is deliberately narrower than the catalog shape:

- All thirteen produce an inspectable proposal before their gate.
- The typed action registry is Meta-only. It shapes exact dry-run previews for supported Meta
  actions; `meta.campaign.create_from_brief` remains dry-run-only and shapes PAUSED objects.
- Shopify, HubSpot, and Klaviyo verbs referenced by catalog routines return an explicit
  `not_implemented` blocker instead of pretending to be actionable.
- `LIVE_MODE_ENABLED` is `false`. The routine API and worker remain dry-run-only.
- Future live graduation still requires fresh destination-state validation when an approval
  resumes, independent provider readback, and an atomic cross-worker action-spend reservation.

Artifact approval is a taste signal. Mutation approval is authority for one exact run-level action.
Neither is permission for future sends, publishes, spend, price changes, or credential work.

## Built-in producer truth rules

- The skill check runs before a model call. Missing material returns `needs` and the run becomes
  `waiting_input`; it does not create a placeholder artifact.
- The prompt receives compact account context, source-labelled reads, founder answers, goals,
  plans, prior artifacts, and the selected deterministic decision. Secret-looking keys and
  token-shaped values are redacted.
- Facts, names, claims, and numbers must come from supplied material. Validation enforces artifact
  kind, title/body, item count, banned phrases, and allowed numbers.
- One invalid model response is retried with the rejection reason. A second invalid response ends
  with an honest request for more detail.
- No configured model or a transport/budget failure fails closed with a receipt. A canned artifact
  is not substituted for a real account.
- Recalled playbooks shape the method, never the facts of the customer's business.

## n8n is the replaceable production seam

Any routine can be refined by an account-scoped or global `n8n_workflows` registration. Account
scope wins; a built-in skill is the bounded fallback for a registered workflow failure. An explicit
`n8n` node does not silently fall back.

The bridge signs each request, validates and pins its public destination address, rejects redirects,
bounds response size, and sends a short-lived token bound to account, run, routine, and exact read
scopes. The workflow asks Unc's reader/context proxy for data without receiving platform
credentials, then returns `{artifact}` or `{needs}` under the same validator and gate.

`POST /api/n8n/actions` records a proposal only. It never calls the executor. A saved URL, fixture
success, accepted webhook, or HTTP 2xx is not a customer execution receipt.

## Tenant, approval, and receipt invariants

- Runtime records carry `account_id`; secret, workflow, operational-error, heartbeat, and action
  ledger tables deny browser mutation.
- Members can inspect account state. Owner checks plus service-only or owner-only RLS protect
  connectors, routine controls, model settings, approvals, artifacts, receipts, and customer
  configuration changes.
- Similarity RPCs are callable only by `service_role` after the hardening migration.
- A run approval must belong to the same run, remain unexpired, and cover the typed operation.
- Model spend admission is account-scoped and database-atomic. Unknown or unpriced paid usage
  fails closed or retains its reservation.
- Every future claim of successful destination mutation requires provider response plus a fresh,
  independent readback.

Founder-channel briefs, draft notices, approval prompts, and reminders are a separate notification
lane. They may be delivered to an owner-linked channel without a per-message mutation approval;
they are not customer-facing publishing or sales outreach and must be described that way.

These are repository contracts. They still require migration application and adversarial probes on
the target Supabase project before a customer is connected.

## Founder review loop

1. A run lands an artifact in **What I drafted** with its routine, evidence, and status.
2. Approve, Hold, Edit, and Why update the artifact review state and write a decision receipt;
   taste-bearing actions also update the taste trail. They do not apply a destination mutation.
3. Copy or **Send me this on ...** hands the draft to the founder's verified channel. It does not
   send the content to the founder's customer or publish it.
4. A `waiting_input` run shows one answer box per missing input and resumes the same run only after
   an owner supplies it.

## Main implementation map

| Path | Responsibility |
|---|---|
| `src/lib/runtime/catalog-specs.ts` | all 35 ordered graphs, KPI contracts, cadence, mutation classification, and produce seams |
| `src/lib/runtime/skills/*.ts` | all 35 skill files, pure material checks, craft rules, output contracts, and explicit limits |
| `src/lib/runtime/engine.ts` | reads, production, gates, execution, resume, and receipts |
| `src/lib/artifacts/` | material compaction, validation, rendering, signing, and review handlers |
| `src/lib/runtime/store/` | account-scoped runs, artifacts, approvals, receipts, and n8n registrations |
| `src/lib/actions/` | typed action registry, guards, risks, idempotency, and rollback metadata |
| `src/lib/n8n/` | exact data-token scopes, proxy authority, URL policy, and workflow registry |
| `src/worker/providers/producer.ts` | context-aware built-in producer and validated retry path |
| `src/worker/providers/n8n.ts` | signed n8n orchestration and bounded reply parsing |
| `src/worker/providers/executor.ts` | exact dry-run previews and fail-closed live boundary |
| `src/app/api/routines/` | owner-governed run, input resume, approval resume, params, and callback routes |
| `supabase/migrations/` | tenant persistence, RLS, admission, action ledger, and atomic spend controls |

## Verification

```bash
npm run lint
npx tsc --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npx tsc -p scripts/beta/tsconfig.json --noEmit
npm test
npm run build
CI=1 npm run e2e
```

The tests prove code contracts and fixture behavior. Private-beta readiness additionally requires
fresh customer-scoped receipts for identity, connector reads, model output, tenant isolation, n8n
callbacks when used, and every approved outward action.
