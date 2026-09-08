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

## Implementation checkpoint

Shared review contract implemented with 14 unit tests. Added reviewStore server adapter and staged review_outputs migration with output versions, comments and transactional revision-job creation. Combined focused suite: 19 passing tests, using simulated RPC for storage. Database migration NOT applied or PostgreSQL-verified; no review routes released. Local psql/docker and common Homebrew PostgreSQL paths were unavailable. Next: provision/use an isolated PostgreSQL-compatible test environment, validate migration and permission/race cases, then wire authenticated review APIs and page. Do not interpret passing adapter tests as persistence proof.

Follow-up: `scripts/verify-review-storage.mjs` now passes 19 checks using PGlite 0.5.8 (actual PostgreSQL WASM execution, minimal parent fixtures). Covers migration execution, saved comment/job, duplicate idempotency, conflicting comment, foreign tenant/member/context/revision, invalid anchors, separate preference suggestions, append-only comments and denied anon/authenticated access. Initial fixture lacked UPDATE privileges required for SELECT FOR SHARE; corrected test fixture to model existing service-role privileges. No production grants changed. Full existing-schema compatibility, multiple-session concurrency and Supabase advisors remain required before migration release. Run with REVIEW_PGLITE_MODULE pointing to an installed PGlite dist/index.js; the dependency is isolated outside the repository.

Review HTTP read/comment endpoint implemented at `/api/review/outputs/[outputId]`, disabled unless JUNCTION_REVIEW_ENABLED=true. Uses existing account session and captured-context headers; bounded JSON input, path/tenant match, no-store responses, queued-vs-complete distinction. Added transactional read function locking account/membership/output; returns current version and bounded comments/jobs. Updated tests: 27 focused unit tests, 25 isolated SQL checks and TypeScript pass. Not deployed; no revision executor or reviewer UI yet. Next implementation is the deep-linked reviewer with actual persisted comments; next storage verification remains full-schema/concurrent-session testing.
### Reviewer screen checkpoint

Deep-linked `/app/review/[outputId]` screen now implemented locally behind the same release flag. Uses authenticated account selection, generation-bound requests, validated response identity, format-aware feedback and stable comment IDs for uncertain-save retries. Shows queued jobs explicitly rather than claiming a finished revision. Image pins use proportional coordinates with keyboard activation; video timestamps and section/whole-output feedback are available. Brand-preference suggestions remain separate from output edits. React review corrected asynchronous state handling and keyboard access.

Verification: app TypeScript, changed-file ESLint and 31 focused contract/store/API/presentation unit tests pass. These are not browser or live runtime proofs. No deployment, provider calls, live client actions or approval controls enabled. Media paths are restricted to the planned authenticated proxy, which is not implemented yet; actual asset ingestion, browser interaction testing, version comparison/undo, revision execution and full database release verification remain unfinished.
### Private media checkpoint

Added gated `/api/review/media/[outputId]_[image|video]`. Browser URLs carry account/generation/revision selectors, never credentials; the server verifies session membership and calls the locked output reader before loading media. Only current-version descriptors are accepted. Private bucket name is fixed to `junction-review-private`; keys are derived as `account/generation/output/revision/slot.format`, never supplied by the browser. PNG/JPEG/WebP/MP4 only; descriptor includes byte count (maximum 25 MiB) and SHA-256. Streaming download aborts above the declared byte count, has a 15-second deadline, and verifies hash before responding. Supports single byte ranges for video seeking, with private/no-store and nosniff headers. Reviewer links include the captured account/generation/revision. No bucket provisioned or production upload performed yet.

Producer contract: version content may contain `media.image` and/or `media.video` descriptors `{format, bytes, sha256}`, alongside `imagePath: /api/review/media/<outputId>_image` or the corresponding video path. Upload the immutable object before committing its version; never overwrite that key. The private bucket and its access policies must be verified before release. Larger production videos need a bounded streaming delivery design rather than raising the buffer cap casually.

Verification: production build passed; full unit suite passed 262 files / 3425 tests after fixing three wall-clock-dependent test failures and updating the explicit migration table inventory. Media suite additionally gained an oversized-stream cancellation test. The isolated SQL verifier still passes 25 checks. Unit storage/session dependencies are simulated; these are not Supabase live download, browser visual, Grok execution or provider publication proof. Next: producer registration and real test-asset ingestion, then browser review/revision round trip. Full-schema/concurrency verification and bucket provisioning remain release gates.
### Producer and revision persistence checkpoint

`registerReviewOutput` now validates finished content and derives review links/media paths. Its service-only SQL transaction verifies the originating run/artifact/account generation, creates output plus initial version atomically, and rejects conflicting output-ID retries. A replay after later revisions does not reset the current revision. This is an internal adapter, not a public intake endpoint; uploading verified immutable media remains a prerequisite.

Added service-only revision claim/completion transactions. Claim checks unpaused current context, source ownership and comment-author membership, locks output then job, and permits only one queued-to-running transition. Completion requires the claim token, persists a new immutable version and advances the current pointer atomically; duplicate identical completion returns its original receipt, conflicting completion is refused, and stale-base work becomes superseded. These functions do not invoke a model, approve, send or publish. No claim-expiry takeover or paid retry loop has been introduced; failed/uncertain worker reconciliation must be implemented before worker release.

Evidence: isolated PGlite verifier now passes 50 actual SQL checks, including initial registration/replay, paused/foreign claim denial, duplicate claim denial, wrong claim token, version preservation and completion idempotency. Five producer adapter tests pass with simulated RPC; TypeScript passes. Still not full-schema/multi-session/Supabase verification and not real regeneration. Next bridge work is producer media upload/readback, bounded revision executor and the actual browser/Slack test handoff.
### Revision worker checkpoint

Added `runReviewRevision` orchestration and gated operator entry `runTextReviewJob`. The operator uses existing `routine_produce` routing with account-scoped spend admission and usage logging. Each job is claimed once; context is checked before production and persistence. Text producer caps output at 6,000 tokens and input body at 24,000 characters, requires strict complete title/body JSON, and rejects truncation/refusal. It supports whole-output article/outreach/SMS/brief/decision edits only; section mapping and rendered email/image/video producers remain required. No generation was run against a live account or provider in this checkpoint.

Media revisions must preserve existing slots and prepare/verify all objects at the next immutable revision before commit. Missing preparation is an explicit failure, not a text-only creative success. Producer failures record a failed job without retries; ambiguous completion returns uncertain and does not mark a potentially committed revision failed. Added service-only failure recording, allowed during pause but restricted to the same generation and claim. No queue scheduler or automatic retry enabled.

Evidence: app and worker TypeScript pass, nine simulated revision/producer tests pass, isolated SQL verifier passes 58 checks (including failure while paused, wrong-token refusal and unchanged output after failure). Remaining critical integration: actual private test asset upload/readback, isolated runtime binding, deployed database verification, browser interaction and real bounded generation. All five production lanes remain subject to their original acceptance criteria.
### Live access / schema verification checkpoint

Read-only Supabase discovery confirmed project `junction-ai-unc` (`ycgayfsvcjpsnryrpukv`) is reachable. It has no development branches, and the bounded name query found no account named test/Junction. Native Grok access was rechecked using Computer Use: Mac remains locked, automatic unlock failed. User was asked to unlock; do not repeatedly poll the lock or use a live client bot as a substitute.

Executed the staged review DDL within BEGIN/ROLLBACK against the current full Supabase schema with short lock/statement timeouts. All four tables were visible within the transaction; a separate read returned `to_regclass('public.review_outputs') = null` after rollback. No client records, schedules or persistent schema were changed. This proves DDL compatibility, NOT data-path execution under the full schema, concurrency, migration release or live review readiness.

Security advisor baseline (before any review deployment): informational RLS-without-policy notices on service-only tables; warnings for public vector extension, public/authenticated execution grants on `accept_beta_invites`/`is_account_member`, and disabled leaked-password protection. Inspected both helper bodies: they derive identity from auth.uid(); invite acceptance checks signed-in identity and confirmed email. Public grants still need least-privilege review, not blanket removal of authenticated access. No exposure claim established by this check. References: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . Do not treat baseline advisor results as approval of the uninstalled review migration.

Added immutable media-upload helper: private-bucket prerequisite, fixed tenant/version key, create-only write, mandatory byte/hash readback, safe duplicate reuse, and timeout reconciliation without write retries. Five simulated storage tests and app TypeScript pass. It still needs the concrete private-storage adapter and an actual isolated upload/readback before media ingestion is proven.
### Browser + local database integration checkpoint

Added `scripts/review-harness/`, a loopback-only Vite harness loading the actual ReviewWorkspace component, actual review API/media handlers, actual staged SQL functions in an isolated PGlite database, and the existing `email-carry.png` demo. Identity and storage transport are test adapters; no real customer session, Supabase bucket, Grok call or provider action is involved. The harness explicitly labels these limits. It is outside application routes and must never become a production authentication bypass.

Observed in the browser: full AVGAR email preview loads; keyboard image pin and feedback save persist through SQL; refresh retains the comment. At 390×844, image natural width 600 loaded and document width equals viewport width (390), with no horizontal overflow. Mobile preference suggestion saves separately. API readback confirms two comments (visual pin x=.5/y=.5 and whole-output preference), one queued job, revision still zero. No browser console errors; Next reports an eager-loading performance warning for the hero image. Local servers/tab were closed and viewport reset after verification.

Browser checks found and fixed textarea box-sizing overflow and missing convenient access to the feedback panel on long mobile emails. Added a mobile Add feedback anchor. App TypeScript and changed-component lint pass. This verifies preview/comment persistence in the local harness, not actual regeneration, version comparison, approvals, provider execution, Slack delivery or authenticated deployed access. The initial harness routing error (SPA fallback intercepted API) was fixed before the successful test; existing process on port 4317 was left untouched and an ephemeral port used.
### Real private storage proof

Concrete Supabase storage adapter implemented and tested against the existing project's API using Vercel `env run -e production` (no secrets printed or written to a new file). Initial attempt stopped before network mutation because `.env.local` had no Supabase variables. The successful run reused deployment credentials; 16 sensitive values were unavailable through the CLI but the required storage credential was available.

Created private bucket `junction-review-private` with 25 MiB object limit and PNG/JPEG/WebP/MP4 allowlist. Existing storage.objects policy query returned no public/client policies. Uploaded the approved internal `email-carry.png` example, 1,287,944 bytes, SHA-256 `312e779063139976788146577fd4b4c67dc9bec93dfb8c8d4bc4dc6d95066205`. Provider readback matched; repeat helper call returned duplicate=true without another write. Unauthenticated public object request returned HTTP 400, not asset bytes.

Retained private test object: `55a377a5-c12e-4de6-a085-0d9a50ccd488/0/a85809f3-3874-4447-a7a2-2fabd0f96e8c/0/image.png`. These are storage-fixture IDs, NOT real customer/account registration or Grok execution evidence. No customer record, schedule, provider campaign or send changed. The test asset remains available for later cleanup; no deletion performed. Repro script: `scripts/verify-review-media-live.mjs` with explicit image/bundle paths; do not rerun casually because it generates new fixture IDs.

The adapter distinguishes explicit 404 from auth/network failure and enforces create-only upload. Remaining integration: actual account/output registration referencing verified media, deployed gated reviewer session, real revision execution, runtime/Slack delivery and all five lane acceptance gates.
### Installed schema and registered test account

Full-schema service-role rollback test passed in Supabase: registered output, saved comment, claimed once, completed revision, read new content and preserved original. Separate post-rollback read showed no review tables and zero test accounts retained. Test SQL is in `scripts/verify-review-full-schema.sql`; it is explicitly rollback-only.

Then installed review schema migration `20260908151115_review_outputs` using the migration API. Local filename reconciled to the actual remote migration version; local harness/verifier references updated. Readback confirms all four tables have RLS enabled and neither anon nor authenticated has direct SELECT. Post-install advisors add only the expected four INFO RLS-without-policy entries for service-only review tables; pre-existing warnings unchanged. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). No customer-facing review flag enabled or app deployment performed here.

Created a real, explicitly labelled test account `Junction TEST — Review sandbox`, ID `55a377a5-c12e-4de6-a085-0d9a50ccd488`, owned by the existing Tom user. Account is automation_paused=true and monthly_llm_cap_usd=0. A dry-run fixture artifact, explicitly labelled existing demo asset only, references the privately verified email image. Registered output ID `a85809f3-3874-4447-a7a2-2fabd0f96e8c`, revision 0. This is now a real database/storage binding, not Grok generation evidence. No existing client account altered; no connectors/schedules added; no sends or ad writes. Next release should be test-account-only before validating authenticated app preview/media and a bounded revision window.

### Isolated deployed review checkpoint

Commit `b6e9edc` pushed to `codex/backend-foundation-20260905`. Clean git-archive deployment excludes unrelated untracked files. Deployment `dpl_8BHwyS1QA9hDMpbgo9Xz7yqHjqyb` is READY at https://junction-hjvbkbxeq-tom-junctionmedis-projects.vercel.app (production target, --skip-domain; no canonical promotion). Deployment-only review enablement allows exactly the test account above; API, media, page and worker independently enforce the release allowlist in addition to membership checks. Test account remains paused with zero AI cap.

Build passed in approximately one minute. Latest verification before release: 268 unit files / 3450 tests passing, app and worker type checks passing. Deployment health returned HTTP 200 with healthy database and fresh worker; health build SHA is stale and must not be used as source-commit evidence. Unauthenticated review API returned HTTP 401. Both in-app browser and Chrome reached sign-in; no authenticated preview/comment or live generation claim is made. User asked to sign in to this deployment and unlock the Mac for native Grok testing. Fifteen-minute error-log query returned no logs, not a proof of monitoring coverage. Canonical domain inspection still resolves older deployment `dpl_64SjUzZPH7FLiLBX55caX2GBPwPn`, not this test release.

Next: authenticated test preview/media/comment, then bounded actual revision; implement version history and exact-version approvals without enabling client actions. Grok/Slack and all five lane end-to-end acceptance criteria remain incomplete. Do not repeat storage fixture creation, migration installation or deployment merely to refresh status.

### Read-only version history implementation

Added staged `20260908152507_review_history` migration and `GET /api/review/outputs/:id?history=1&beforeRevision=N` handling. Ten-version keyset pages reuse the existing transaction-held membership, generation and artifact/source checks. Server validation rejects foreign account/output rows, reordered/future versions and inconsistent continuation cursors before returning content. Reading history has no restore, approval, execution or generation side effect. Existing current-output GET/POST behaviour remains unchanged.

Evidence: 14 focused HTTP/history tests pass (simulated RPC), app type check passes; actual PGlite SQL verifier now passes 69 checks including ordered pages, exclusive cursor, original-content preservation, wrong account/generation/actor and anon/authenticated refusal. This migration is NOT installed remotely and the endpoint addition is NOT deployed. Browser history/compare, historical private-media retrieval and approvals remain to implement. No provider calls or client operations occurred in this slice. Supabase skill informed service-only invoker permissions; relevant function guidance: https://supabase.com/docs/guides/database/functions .

### Visual comparison and historical media

Added read-only desktop/mobile version comparison, loaded on demand, with explicit current-versus-earlier labels. Version-specific private media uses the staged `read_review_version` RPC, reusing current membership/context/source validation while retrieving the selected immutable version. Future/mismatched versions are refused. The still-uninstalled history migration includes this reader; deploy schema before code because media now requires it.

Local browser evidence: retained original and current demo email images both load; desktop comparison is side-by-side. At 390×844 both columns stack at width 324 with document width exactly 390; all three displayed images loaded. Submitted feedback while viewing version 0 and observed persisted comment and queued job explicitly bound to current version 1. No console errors. Fixtures are labelled synthetic (same image, changed title/body), not AI revision evidence. The local harness uses actual handlers and PGlite SQL with simulated session/storage only; stopped and temporary viewport reset after verification.

App/worker type checks and changed-file lint pass; 24 focused history/media/presentation tests pass. SQL verifier passes 76 checks including historical content, future-version refusal and role/account/context denial. React/Next skill guidance informed on-demand loading, separate read-only component and mobile layout. Current reviewer now eagerly loads its hero image. No production deployment, generation, approval or provider action in this slice. Existing approval routes were inspected: they resume routine runs, not version-bound review outputs; do not wire the new screen to those directly without binding exact content/action/target and rechecking before execution.

### Exact-version action decisions

Staged `20260908153321_review_action_approvals` adds immutable trusted-producer proposals (output/revision, action, destination, description, exact payload, expiry). Service role may update only decision fields, not scope/payload. Owner-only decision RPC locks account/membership/output/proposal, rejects stale generations/revisions and expired proposals, supports exact retry receipts and withdrawal to terminal held state. Read results derive expired/superseded status without rewriting history. Proposal expiry must be future and at most seven days from creation; it is displayed to the reviewer. No public create-proposal endpoint and no browser-supplied action payload or actor identity.

Reviewer now loads actions on demand and records approve/hold/withdraw for a specific proposal. It explicitly says nothing executed and execution integration is not released. Browser local SQL-backed fixture proved pending → approved → refresh still approved → withdraw → held, with no console errors. No provider call was available in the harness. Action decisions do not create brand preferences or turn on automatic actions.

Verification: 101 actual isolated PGlite checks, including expired/stale/non-owner refusals, immutable payload, retry and withdrawal. Fourteen focused API tests passed. Initial full suite exposed the new table missing from the schema inventory assertion; updated that test to reflect the real migration. App type check and changed-file lint pass. Both new migrations remain UNINSTALLED and code UNDEPLOYED. Next required: trusted producer wiring, claim/reconciliation and pre-execution recheck of current revision, approved action/payload, current owner membership, pause state, permissions, native/provider approval and destination. Do not connect this record-only decision to the old generic resume route or claim authorized execution is complete.

### Real bounded text-revision result — PASS

Verified real test account had zero connectors, routine states, model preferences and prior model calls. Created a synthetic internal brief and comment in the existing test account; no client data or provider destination was involved. The operator script compiled and invoked the actual `runTextReviewJob` → spend admission → OpenAI → immutable revision completion path. One temporary US$0.05 monthly cap and an unpaused window were limited to this test account; finally restored paused=true / cap=0. Independent SQL read confirmed restoration, generation 0, no routine states, job done, two retained versions and exactly one usage row.

- Job: `3e8d9990-9e02-4115-a308-313b5888c99f`; output: `b4e4f38c-94a2-4bd9-88d5-e0c9faedcc11`; revision: 1.
- Provider: OpenAI `gpt-5-mini`, input 205 / output 574 tokens, stop reason end. Ledger `09f90d6b-6a2b-4623-802b-7701b86d895c`; estimated cost US$0.001199 (catalogue estimate, not provider invoice).
- Saved title: “Less busywork for your team”. Saved body: “Our sales and marketing agents help your team get draft work ready for review. You can comment on drafts, leave feedback, and decide the next steps. Nothing in this internal test is sent or published.”
- Original content remained byte-for-JSON identical; revised body meets requested 40-word limit and preserves the no-send/no-publish statement.

Repro/receipt script `scripts/verify-review-text-live.mjs` is deliberately single-job and refuses a repeat after usage or claim state changes. It uses Vercel env injection without printing or writing credentials. Worker build passed; script syntax check passed. Do NOT rerun the paid test merely to refresh evidence. This proves real internal text revision and persistence, not image/email rendering, Grok invocation, Slack delivery, client onboarding or execution. Those remain required.

### Installed history/approval migrations and live privilege correction

Real-schema rollback test passed for history, historical-version retrieval, proposal creation, owner approve and withdraw. Installed `20260908154525_review_history` and `20260908154544_review_action_approvals`; local filenames reconciled to remote history. A live post-install privilege assertion then found service_role retained default ALL grants: narrower GRANT statements had not removed UPDATE/DELETE on versions/comments or UPDATE on approved payloads. The isolated fixture previously omitted Supabase default privileges, so its earlier grant test did not establish this production property.

Corrected with additive `20260908154740_review_service_grants`: revoke inherited explicit table grants then allow SELECT/INSERT plus only the necessary mutable columns (output revision, job state/claim/result, approval decision fields). Full-schema rollback and installed readback both passed: payload_mutable=false, versions_mutable=false, comments_deletable=false, decision_mutable=true. Local verifier now emulates Supabase default table grants and still passes 101 checks. No existing client tables or operations changed; immutable records were not rewritten or deleted. Review actions remain record-only.

Post-install security advisor adds only the expected service-only review table INFO; pre-existing vector/public helper/leaked-password warnings remain documented above. [RLS-without-policy explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). No client-facing rollout or canonical-domain promotion implied by database installation.

### Combined isolated release — READY

Deployment `dpl_6PV5uQ2GUPpsVs6sc4VcN6qUwNCu`, commit `9d1d81a`, at https://junction-q1rqkzc2q-tom-junctionmedis-projects.vercel.app . Production target with --skip-domain and deployment-only review allowlist restricted to the internal account. Clean archive export excludes unrelated working files. Next 16.3.4 production build passed in 40 seconds. History, historical media and record-only action approvals are now in this test release with installed database functions.

Post-deploy: health HTTP 200, database healthy, worker fresh/no error; unauthenticated history/actions both HTTP 401. Error-log scan for 15 minutes returned no logs. Monitoring/drain configuration not established by this check. Health build SHA remains stale; deployment source metadata identifies the release. Authenticated browser review is still unverified pending sign-in; login return URL allowlisting for this unique deployment has not been independently verified. No provider execution or client rollout enabled.

After migration reconciliation, 18 targeted test files / 125 tests passed; prior complete suite was 270 files / 3464 tests passing. Supabase final advisor warnings are unchanged from the documented baseline. The main canonical domain was not promoted by this release.

### Automatic text-revision queue — implemented, not released

The existing worker loop now has an opt-in review queue, disabled unless `JUNCTION_REVIEW_TEXT_QUEUE_ENABLED=true` and the existing review release flags allow exact account IDs. It discovers at most one eligible job per account, checks the budget, and processes at most one job per tick through the already-tested text revision path. Atomic SQL claim remains the authority; failed or uncertain jobs are not automatically retried. Idle ticks make no model calls. Image/video/email revisions are excluded, not silently converted to text.

Staged migration `20260908155205_review_text_queue.sql` provides service-only discovery with current context, account pause/budget, author membership and content eligibility checks. It is NOT installed remotely. Seven queue unit tests pass, and changed-file lint passes. This is not evidence of an automatic live worker run.

Read-only Fly inspection found the shared `unc-worker` still on build `f7cbcadd0b6bf792a474682f5c6cbf0713b13ee8`, with dry-run/messaging-disabled configuration and existing client-linked source settings. No worker replacement, secret update or queue activation was performed. Before deployment, reconcile the large intervening worker diff or isolate the test consumer so unrelated client scheduling is not changed. The internal test account remains paused with cap zero; the earlier real revision proof was operator-triggered, not daemon-triggered.

### Queue database installation — verified

Installed as `20260908160142_review_text_queue` after a real-schema transactional rollback test successfully executed discovery under service_role. Local filename and verifier reconciled to installed migration history. Readback: anon execute=false, authenticated execute=false, service_role execute=true, eligible test jobs=0. Test account remained paused. No worker deployment or queue enablement occurred.

Security advisors retain the baseline counts: 35 service-only RLS/no-policy INFO, one extension/public warning, two anon and two authenticated security-definer warnings, one leaked-password protection warning. No new warning from this migration. The Supabase skill informed invoker semantics, explicit role grants and real-schema verification; [function security guidance](https://supabase.com/docs/guides/database/functions). The remaining queue gate is a narrowly scoped live consumer test, not more SQL scaffolding.

Follow-up diff corrected the deployment-risk assumption: despite the older build date, changes under worker/runtime/LLM are only four worker files (the queue, its tests, operator revision entry and six loop lines). The broader library diff adds review modules and Grok control, rather than rewriting existing client execution. Deployment/config/package files are unchanged. Before restart, check preservation of heartbeat job markers because the existing loop uses them to avoid repeating scheduled telemetry; do not describe a large client-engine rewrite as the blocker.
