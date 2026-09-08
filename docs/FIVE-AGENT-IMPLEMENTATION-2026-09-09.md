# Five-agent delivery plan

Status: implementation in progress; not customer-ready. Scope remains all five lanes.

## Decisions

Junction-only signup; managed underlying runtime subject to verified provider terms/access. Approval required by default, explicit per-agent automation settings. Dedicated test account and Grok bot/channel; a new bot is not credential isolation. No client production actions during testing. Reuse existing account/session/artifact/approval/channel infrastructure. Grok first, replaceable adapter. Direct bounded generation for creative revisions where appropriate. One scheduler owns each job. No LLM idle polling.

## Evidence from current checkout

- `src/lib/agents/server.ts`: switches persist via set_agent_switch; they do not dispatch Grok.
- `src/lib/agents/grokControl.ts` and callback route: authenticated configuration results exist; see GROK-CONTROL-CALLBACK-CONTRACT.md for deployment proof and missing live callback.
- `src/lib/artifacts/handlers.ts`: account/generation-scoped artifact reads, database revision decisions, automatic decision-memory writes. New review must separate explicit brand preference from one-off feedback.
- `src/app/api/artifacts/[id]/route.ts`: captured-context read/edit/approval and channel delivery; not a visual multi-output review service.
- `src/lib/runtime/skills/`: paid, content, email, SEO and sales drafting recipes exist. Files/catalog entries do not prove callable live execution.
- ZIP 11 CLIENT-BUILD-SPEC and client HTML: desired onboarding, agent details, output focus/pins/chat. HTML includes scripted revision replies, not real model jobs.
- Existing email-proof outputs provide two rendered local emails, not a connected production renderer/provider workflow.

## Capability matrix

| Area | Reuse | Missing or unverified acceptance |
|---|---|---|
| Identity | account sessions, memberships, context generation | new-design signup/onboarding and invite path tested end to end |
| Runtime | Grok webhook controller proof, callback transport | isolated test binding, persisted dispatch, returned artifacts, scheduling ownership |
| Review | artifact records, revisions, decisions | immutable per-output versions, pins, actual regeneration, compare, mobile review |
| Messaging | Slack/channel code | test destination, same work/version/thread mapping, real reply-to-revision round trip |
| Paid | decision/creative recipes, Grok/Ryze reported working | isolated verified read, graphics/video brief output, approved scoped execution test |
| Organic | hook/question/repurposing recipes and source imagery | actual attributed inspiration ingestion, video previews, finished graphics/edits, publish test destination |
| Email/SMS | newsletter/flow recipes, local visual proof | renderer integration, hybrid email export, revision, provider draft/test delivery and SMS test |
| SEO | keyword/package code and prior evidence docs | current test-context article production, fixes/diffs, CMS sandbox readback |
| Sales | lead/outreach/follow-up recipes | scoped lead inputs, actual drafted sequence/reply work, suppression and sandbox send |
| Learning | memory and taste events | explicit preference confirmation/undo, version-linked performance with no invented winners |

## Ordered work packages

1. Shared review contract: output identity, immutable version, format-aware comment anchors, distinct preference scope, version/action-bound approvals. Tests before persistence/API.
2. Extend existing artifact storage with transactional review outputs/versions/comments/jobs; reuse account/generation constraints. No parallel replacement account schema. Tenant tests with real local database.
3. Authenticated review route/page matching ZIP 11, mobile and desktop pins, full imagery/text/video, revision progress/errors, compare/undo. No scripted success.
4. Runtime intake/export and narrow asset access; separate test controller/worker, callback, concrete work ingestion and Slack delivery. Exact bindings and one scheduler verified.
5. Five channel producers using shared job/artifact contracts; all lanes included, implement and test each actual output. Reuse originals and provider connectors; do not rebuild integrations gratuitously.
6. Revision workers (text, images, email composition, video), bounded costs, immutable outputs, same-thread updates. Failed job leaves original unchanged. Validate requested edits and preserve unselected content.
7. Provider draft/execution adapters with per-agent policy, version-specific authorization, current-state checks, idempotency and ambiguous-result reconciliation. Test only isolated/sandbox destinations; unsupported sandboxes are explicit blockers, not live-client substitutes.
8. Context/connection onboarding, business/agent settings, source freshness, operational blockers, cost controls and explicit preference learning.
9. Release audit across all five lanes, UI states, client isolation and authorized execution. No all-green based on simulated fixtures.

## Page map

Preserve existing login/auth/account APIs. Add deep-linkable review page under authenticated app routing, not only an unaddressable modal. Home/Taste Gate, Agents/detail, Setup, Business and operations queue bind to real records. Design missing states: revoked link/access, no connection, not configured, scheduled, generating, revision conflict, failed, partially executed, unknown provider outcome, approval expired, reconnect, mobile pins and video timestamps. Disabled is not locked; source-ready is not execution verified.

## Acceptance per lane

Test tenant enables configured agent → exact job executes once → real finished output stored → internal Slack message links correct work → mobile/desktop comment saves against exact version → actual revision returns → old approval cannot authorize new version → permitted test action executes once → provider readback and result shown. Also missing input, disabled agent, foreign tenant, duplicate event, stale version, expired authorization and failed/ambiguous provider response.

## Access/dependency gates

Native Grok access previously blocked by locked Mac; recheck once when needed. Confirm test bot credential isolation before connecting any provider. Need actual Apify workflow/dataset access for sourced video, provider draft/sandbox destinations for all channel executors, and verified managed-runtime arrangement. Ask for new authority only at the point required; continue unrelated implementation while waiting.

Do not claim any checkbox complete without attached evidence. This plan is not a completion receipt.
